import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer as createNetServer, type Server } from "node:net";
import type { Server as HttpServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createRemoteApp } from "../src/remote/app.js";
import { Sealer } from "../src/remote/seal.js";
import { WRITE_TOOLS } from "../src/server.js";

const SECRET = "x".repeat(40);
const REDIRECT = "http://localhost:9999/callback";
let base: string;
let http: HttpServer;

async function freePort(): Promise<number> {
  const srv: Server = createNetServer();
  await new Promise<void>((r) => srv.listen(0, r));
  const port = (srv.address() as { port: number }).port;
  await new Promise<void>((r) => srv.close(() => r()));
  return port;
}

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

async function register(): Promise<string> {
  const r = await fetch(`${base}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ redirect_uris: [REDIRECT], token_endpoint_auth_method: "none", client_name: "Test" }),
  });
  expect(r.status).toBe(201);
  return (await r.json()).client_id;
}

/** Recorre authorize → login → callback y devuelve el código. */
async function authorize(clientId: string, challenge: string, password = "bien"): Promise<Response> {
  const q = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", state: "xyz" });
  const page = await (await fetch(`${base}/authorize?${q}`)).text();
  const pending = /name="pending" value="([^"]+)"/.exec(page)![1];
  return fetch(`${base}/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ pending, username: "alumno", password }),
  });
}

async function token(body: Record<string, string>): Promise<Response> {
  return fetch(`${base}/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) });
}

beforeAll(async () => {
  const port = await freePort();
  base = `http://localhost:${port}`;
  const app = createRemoteApp({
    publicUrl: base,
    secret: SECRET,
    site: "https://campus.example",
    dataDir: await mkdtemp(join(tmpdir(), "utn-mcp-remote-")),
    authenticate: async (username, password, site) => {
      if (password !== "bien") throw new (await import("../src/auth/token.js")).AuthError("Datos de acceso inválidos");
      return { site, token: "moodle-token", userid: 42, username };
    },
  });
  http = await new Promise((r) => {
    const s = app.listen(port, () => r(s));
  });
});

afterAll(() => {
  http?.close();
});

describe("Sealer", () => {
  it("abre lo que sella y rechaza otro tipo, otra clave o datos alterados", () => {
    const s = new Sealer(SECRET);
    const t = s.seal("access", { a: 1 }, 60);
    expect(s.open("access", t)).toEqual({ a: 1 });
    expect(s.open("refresh", t)).toBeNull();
    expect(new Sealer("y".repeat(40)).open("access", t)).toBeNull();
    expect(s.open("access", t.slice(0, -2) + (t.endsWith("A") ? "BB" : "AA"))).toBeNull();
  });

  it("rechaza tokens vencidos", () => {
    const s = new Sealer(SECRET);
    const t = s.seal("code", { a: 1 }, -1);
    expect(s.open("code", t)).toBeNull();
  });

  it("exige una clave larga", () => {
    expect(() => new Sealer("corta")).toThrow(/UTN_MCP_SECRET/);
  });
});

describe("modo remoto", () => {
  it("publica los metadatos OAuth y pide auth en /mcp", async () => {
    const prm = await (await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)).json();
    expect(prm.resource).toBe(`${base}/mcp`);
    const as = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
    expect(as.registration_endpoint).toBe(`${base}/register`);

    const r = await fetch(`${base}/mcp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toMatch(/resource_metadata=/);
  });

  it("con contraseña incorrecta vuelve a mostrar el formulario con el error", async () => {
    const clientId = await register();
    const r = await authorize(clientId, pkce().challenge, "mal");
    expect(r.status).toBe(200);
    expect(await r.text()).toMatch(/rechazó el inicio de sesión/);
  });

  it("completa el flujo OAuth y sirve solo tools de lectura", async () => {
    const clientId = await register();
    const { verifier, challenge } = pkce();
    const login = await authorize(clientId, challenge);
    expect(login.status).toBe(302);
    const cb = new URL(login.headers.get("location")!);
    expect(`${cb.origin}${cb.pathname}`).toBe(REDIRECT);
    expect(cb.searchParams.get("state")).toBe("xyz");
    const code = cb.searchParams.get("code")!;

    const bad = await token({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: "x".repeat(43), redirect_uri: REDIRECT });
    expect(bad.status).toBe(400);

    const ok = await token({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: verifier, redirect_uri: REDIRECT });
    expect(ok.status).toBe(200);
    const tokens = await ok.json();
    expect(tokens.access_token).toMatch(/^u1\./);
    expect(tokens.refresh_token).toMatch(/^u1\./);
    // El token de Moodle no viaja en claro.
    expect(JSON.stringify(tokens)).not.toContain("moodle-token");

    const refreshed = await token({ grant_type: "refresh_token", client_id: clientId, refresh_token: tokens.refresh_token });
    expect(refreshed.status).toBe(200);

    // Un código emitido para otro cliente no sirve.
    const other = await register();
    const stolen = await token({ grant_type: "authorization_code", client_id: other, code, code_verifier: verifier, redirect_uri: REDIRECT });
    expect(stolen.status).toBe(400);

    const client = new Client({ name: "test", version: "0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } } }),
    );
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("campus_whoami");
    expect(names).toContain("campus_get_file");
    for (const w of WRITE_TOOLS) expect(names).not.toContain(w);
    await client.close();
  });
});
