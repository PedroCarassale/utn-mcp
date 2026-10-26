import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express, { type Express, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { DEFAULT_SITE } from "../config.js";
import { normalizeSite } from "../auth/token.js";
import { AppContext, setLoginHint } from "../context.js";
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
  /** Reemplaza el login contra Moodle (tests). */
  authenticate?: Authenticate;
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
    });
    const server = createServer(ctx, { readOnly: true });
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
