import { createHash } from "node:crypto";
import type { Request, Response } from "express";
import type { AuthorizationParams, OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { InvalidGrantError, InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { OAuthClientInformationFull, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { AuthError, obtainToken } from "../auth/token.js";
import { MoodleClient } from "../moodle/client.js";
import { getSiteInfo } from "../moodle/api.js";
import { Sealer } from "./seal.js";
import { loginPage, messagePage } from "./pages.js";

const PENDING_TTL = 15 * 60;
const CODE_TTL = 5 * 60;
const ACCESS_TTL = 7 * 24 * 60 * 60;
const REFRESH_TTL = 180 * 24 * 60 * 60;

/** Lo que viaja dentro de los tokens: el token de Moodle y a quién pertenece. */
export interface MoodleGrant {
  site: string;
  token: string;
  userid: number;
  username: string;
}

/** Cambia usuario y contraseña por un token de Moodle. Inyectable para los tests. */
export type Authenticate = (username: string, password: string, site: string) => Promise<MoodleGrant>;

export const moodleAuthenticate: Authenticate = async (username, password, site) => {
  const { token } = await obtainToken(username, password, site);
  const info = await getSiteInfo(new MoodleClient(site, token));
  return { site, token, userid: info.userid, username: info.username };
};

interface Pending {
  cid: string;
  ru: string;
  cc: string;
  st?: string;
  client?: string;
}

interface CodeData extends MoodleGrant {
  cid: string;
  ru: string;
  cc: string;
}

interface TokenData extends MoodleGrant {
  cid: string;
  iat: number;
}

/** Hash corto del client_id, que como es un blob sellado puede ser largo. */
function clientKey(clientId: string): string {
  return createHash("sha256").update(clientId).digest("base64url").slice(0, 22);
}

/** Campos del registro dinámico que hace falta conservar dentro del client_id sellado. */
const CLIENT_FIELDS = [
  "redirect_uris",
  "token_endpoint_auth_method",
  "grant_types",
  "response_types",
  "client_name",
  "client_secret",
  "client_secret_expires_at",
  "client_id_issued_at",
] as const;

/**
 * Proveedor OAuth sin estado. El usuario inicia sesión con su cuenta del campus,
 * el servidor obtiene un token de Moodle y lo entrega cifrado como access token.
 * La contraseña solo se usa para pedir el token y no se guarda.
 */
export class StatelessOAuthProvider implements OAuthServerProvider {
  readonly clientsStore: OAuthRegisteredClientsStore;

  constructor(
    private readonly sealer: Sealer,
    private readonly site: string,
    private readonly loginPath: string,
    private readonly authenticate: Authenticate = moodleAuthenticate,
  ) {
    this.clientsStore = {
      getClient: (clientId) => {
        const data = sealer.open<Omit<OAuthClientInformationFull, "client_id">>("client", clientId);
        return data ? { ...data, client_id: clientId } : undefined;
      },
      registerClient: (client) => {
        const kept: Record<string, unknown> = {};
        for (const f of CLIENT_FIELDS) if ((client as Record<string, unknown>)[f] !== undefined) kept[f] = (client as Record<string, unknown>)[f];
        return { ...client, client_id: sealer.seal("client", kept) };
      },
    };
  }

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    const pending = this.sealer.seal<Pending>(
      "pending",
      { cid: clientKey(client.client_id), ru: params.redirectUri, cc: params.codeChallenge, st: params.state, client: client.client_name },
      PENDING_TTL,
    );
    sendHtml(res, 200, loginPage({ action: this.loginPath, pending, clientName: client.client_name, site: this.site }));
  }

  /** POST del formulario de login: pide el token a Moodle y redirige al cliente con el código. */
  async handleLogin(req: Request, res: Response): Promise<void> {
    const { pending: sealed, username, password } = (req.body ?? {}) as Record<string, string | undefined>;
    const pending = sealed ? this.sealer.open<Pending>("pending", sealed) : null;
    if (!pending) {
      sendHtml(res, 400, messagePage("El pedido de inicio de sesión venció", "Volvé a conectar el servidor desde tu cliente (Claude, Cursor, etc.) para empezar de nuevo."));
      return;
    }
    const retry = (error: string) =>
      sendHtml(res, 200, loginPage({ action: this.loginPath, pending: sealed!, clientName: pending.client, site: this.site, username, error }));
    if (!username?.trim() || !password) return retry("Completá usuario y contraseña.");

    let grant: MoodleGrant;
    try {
      grant = await this.authenticate(username.trim(), password, this.site);
    } catch (err) {
      if (err instanceof AuthError) return retry(`El campus rechazó el inicio de sesión: ${err.message}`);
      console.error("[utn-mcp] error en login:", err);
      return retry("No se pudo contactar al campus. Probá de nuevo en un rato.");
    }

    const code = this.sealer.seal<CodeData>("code", { ...grant, cid: pending.cid, ru: pending.ru, cc: pending.cc }, CODE_TTL);
    const target = new URL(pending.ru);
    target.searchParams.set("code", code);
    if (pending.st) target.searchParams.set("state", pending.st);
    res.redirect(302, target.href);
  }

  private openCode(client: OAuthClientInformationFull, code: string): CodeData {
    const data = this.sealer.open<CodeData>("code", code);
    if (!data || data.cid !== clientKey(client.client_id)) throw new InvalidGrantError("Código de autorización inválido o vencido");
    return data;
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, code: string): Promise<string> {
    return this.openCode(client, code).cc;
  }

  async exchangeAuthorizationCode(client: OAuthClientInformationFull, code: string, _verifier?: string, redirectUri?: string): Promise<OAuthTokens> {
    const data = this.openCode(client, code);
    if (redirectUri && redirectUri !== data.ru) throw new InvalidGrantError("redirect_uri no coincide");
    return this.issue(data, data.cid);
  }

  async exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string): Promise<OAuthTokens> {
    const data = this.sealer.open<TokenData>("refresh", refreshToken);
    if (!data || data.cid !== clientKey(client.client_id)) throw new InvalidGrantError("Refresh token inválido o vencido");
    return this.issue(data, data.cid);
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const data = this.sealer.open<TokenData>("access", token);
    if (!data) throw new InvalidTokenError("Token inválido o vencido");
    const grant: MoodleGrant = { site: data.site, token: data.token, userid: data.userid, username: data.username };
    return { token, clientId: data.cid, scopes: [], expiresAt: data.iat + ACCESS_TTL, extra: { grant } };
  }

  private issue(grant: MoodleGrant, cid: string): OAuthTokens {
    const base: TokenData = { site: grant.site, token: grant.token, userid: grant.userid, username: grant.username, cid, iat: Math.floor(Date.now() / 1000) };
    return {
      access_token: this.sealer.seal("access", base, ACCESS_TTL),
      token_type: "bearer",
      expires_in: ACCESS_TTL,
      refresh_token: this.sealer.seal("refresh", base, REFRESH_TTL),
    };
  }
}

function sendHtml(res: Response, status: number, html: string): void {
  res.status(status);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Frame-Options", "DENY");
  // Sin form-action: el POST del login termina en un redirect al cliente, y Chrome lo bloquearía.
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
  res.send(html);
}
