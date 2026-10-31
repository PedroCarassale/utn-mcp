import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import express, { type Express, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { track } from "@vercel/analytics/server";
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { DEFAULT_SITE } from "../config.js";
import { normalizeSite } from "../auth/token.js";
import { AppContext, describeError, setLoginHint } from "../context.js";
import { MoodleClient } from "../moodle/client.js";
import { safeFilename } from "../util/text.js";
import { createServer } from "../server.js";
import { Sealer } from "./seal.js";
import { StatelessOAuthProvider, type Authenticate, type MoodleGrant } from "./oauth.js";
import { homePage } from "./pages.js";

export interface RemoteConfig {
  /** URL pública del servidor, sin barra final. Es el issuer de OAuth. */
  publicUrl: string;
  /** Clave para sellar los tokens. Cambiarla invalida todas las sesiones. */
  secret: string;
  /** Campus Moodle al que se conecta. */
  site: string;
  /** Directorio para la caché de cada usuario. En Vercel solo /tmp es escribible. */
  dataDir: string;
  /** Registra cada llamada a una tool como evento de Vercel Web Analytics. */
  analytics?: boolean;
  /** Reemplaza el login contra Moodle (tests). */
  authenticate?: Authenticate;
  /** Reemplaza el fetch con el que se bajan los archivos de /files (tests). */
  fetchImpl?: typeof fetch;
}

/** Cuánto dura un link de descarga de /files. */
const DOWNLOAD_TTL = 60 * 60;

/** Lo que va sellado en un link de descarga: alcanza para bajar ese archivo y ningún otro. */
interface DownloadTicket {
  site: string;
  token: string;
  fileurl: string;
  filename: string;
}

/** Content-Disposition con nombre ASCII de respaldo y el original en UTF-8 (RFC 6266). */
function attachment(filename: string): string {
  const ascii = safeFilename(filename).replace(/[^ -~]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** Arma la configuración desde variables de entorno (Vercel o local). */
export function remoteConfigFromEnv(port = Number(process.env.PORT ?? 3000)): RemoteConfig {
  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  const publicUrl = process.env.PUBLIC_URL ?? (vercelHost ? `https://${vercelHost}` : `http://localhost:${port}`);
  return {
    publicUrl: publicUrl.replace(/\/+$/, ""),
    secret: process.env.UTN_MCP_SECRET ?? "",
    site: normalizeSite(process.env.UTN_MOODLE_SITE ?? DEFAULT_SITE),
    dataDir: process.env.UTN_MCP_DATA_DIR ?? join(tmpdir(), "utn-mcp"),
    analytics: process.env.VERCEL === "1",
  };
}

/** Errores JSON-RPC para métodos que el modo sin estado no soporta. */
function methodNotAllowed(_req: Request, res: Response): void {
  res.status(405).set("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Método no permitido: este servidor no usa sesiones." }, id: null });
}

/**
 * App HTTP del modo remoto: OAuth propio (login con la cuenta del campus) y MCP
 * por Streamable HTTP sin sesiones. Cada pedido arma su propio servidor con las
 * credenciales del usuario y solo registra las tools de lectura.
 */
export function createRemoteApp(cfg: RemoteConfig): Express {
  const sealer = new Sealer(cfg.secret);
  const mcpUrl = new URL("/mcp", cfg.publicUrl);
  const provider = new StatelessOAuthProvider(sealer, cfg.site, "/login", cfg.authenticate);
  setLoginHint("Pedile al usuario que desconecte y vuelva a conectar el servidor MCP para iniciar sesión otra vez.");

  const app = express();
  app.disable("x-powered-by");
  // Detrás del proxy de Vercel: usar X-Forwarded-For para el rate limit.
  app.set("trust proxy", 1);

  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl: new URL(cfg.publicUrl),
      resourceServerUrl: mcpUrl,
      resourceName: "Campus UTN FRLP",
    }),
  );

  app.post(
    "/login",
    rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false }),
    express.urlencoded({ extended: false, limit: "16kb" }),
    (req, res) => provider.handleLogin(req, res),
  );

  const bearer = requireBearerAuth({ verifier: provider, resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl) });

  app.post("/mcp", bearer, express.json({ limit: "1mb" }), async (req, res) => {
    const grant = req.auth!.extra!.grant as MoodleGrant;
    const userKey = createHash("sha256").update(`${grant.site}:${grant.userid}`).digest("hex").slice(0, 16);
    const ctx = new AppContext({
      credentials: {
        site: grant.site,
        token: grant.token,
        userid: grant.userid,
        username: grant.username,
        obtainedAt: new Date().toISOString(),
        source: "login",
      },
      home: join(cfg.dataDir, userKey),
      downloadLink: (fileurl, filename) => {
        const ticket = sealer.seal<DownloadTicket>("download", { site: grant.site, token: grant.token, fileurl, filename }, DOWNLOAD_TTL);
        return `${cfg.publicUrl}/files/${ticket}/${encodeURIComponent(safeFilename(filename))}`;
      },
    });
    const onToolCall = cfg.analytics ? (tool: string) => track("tool_call", { tool }, { headers: req.headers }) : undefined;
    const server = createServer(ctx, { readOnly: true, onToolCall });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("[utn-mcp] error atendiendo /mcp:", err);
      if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Error interno" }, id: null });
    }
  });
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  // Links de campus_get_file: el servidor baja el archivo del campus y se lo pasa al usuario.
  // El nombre al final de la ruta es solo para que curl -O y los navegadores lo guarden bien.
  app.get(
    "/files/:ticket/:name",
    rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false }),
    async (req, res) => {
      const t = sealer.open<DownloadTicket>("download", String(req.params.ticket));
      if (!t) {
        res.status(410).type("text").send("El link de descarga venció o no es válido. Volvé a pedir el archivo con campus_get_file.");
        return;
      }
      try {
        const client = new MoodleClient(t.site, t.token, { fetchImpl: cfg.fetchImpl });
        const { res: file, contentType, html } = await client.fetchFile(t.fileurl);
        res.set({
          "Content-Type": contentType ?? "application/octet-stream",
          "Content-Disposition": attachment(t.filename),
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        });
        if (html !== undefined || !file.body) {
          res.send(html ?? "");
          return;
        }
        await pipeline(Readable.fromWeb(file.body as WebReadableStream), res);
      } catch (err) {
        if (res.headersSent) res.destroy();
        else res.status(502).type("text").send(describeError(err));
      }
    },
  );

  app.get("/", (_req, res) => {
    res.type("html").send(homePage(mcpUrl.href));
  });

  return app;
}

/** Levanta el modo remoto en un puerto local (para probar o para una VPS). */
export async function serveHttp(port = Number(process.env.PORT ?? 3000)): Promise<void> {
  const cfg = remoteConfigFromEnv(port);
  const app = createRemoteApp(cfg);
  await new Promise<void>((resolve, reject) => app.listen(port, (err) => (err ? reject(err) : resolve())));
  console.error(`[utn-mcp] modo remoto escuchando en ${cfg.publicUrl} (MCP en ${cfg.publicUrl}/mcp)`);
}
