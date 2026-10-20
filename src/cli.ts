#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DEFAULT_SITE, PATHS } from "./config.js";
import { obtainToken, saveCredentials, clearCredentials, loadCredentials, normalizeSite, AuthError } from "./auth/token.js";
import { MoodleClient, MoodleError } from "./moodle/client.js";
import { getSiteInfo, getUserCourses } from "./moodle/api.js";
import { checkFunctions, REQUIRED_FUNCTIONS } from "./moodle/required.js";
import { JsonCache } from "./store/cache.js";
import { serve } from "./index.js";

const HELP = `utn-mcp: servidor MCP para el campus virtual (Moodle) de la UTN FRLP

Uso:
  utn-mcp login [--user USUARIO] [--site URL] [--token TOKEN]   Inicia sesión y guarda el token local
  utn-mcp logout                                                Borra el token local
  utn-mcp whoami                                                Muestra el usuario autenticado
  utn-mcp discover [--out docs/functions.json]                  Lista funciones de la API disponibles y qué tools funcionan
  utn-mcp clear-cache                                           Borra la caché de respuestas
  utn-mcp serve                                                 Arranca el servidor MCP por stdio (default)

Datos locales en: ${PATHS.home}
`;

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function prompt(q: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(q)).trim();
  } finally {
    rl.close();
  }
}

/** Lee una contraseña sin mostrarla en pantalla. */
function promptHidden(q: string): Promise<string> {
  return new Promise((resolvePw, reject) => {
    if (!stdin.isTTY) {
      let data = "";
      stdin.setEncoding("utf8");
      stdin.on("data", (c) => (data += c));
      stdin.on("end", () => resolvePw(data.trim()));
      return;
    }
    stdout.write(q);
    let pw = "";
    const onData = (buf: Buffer) => {
      const s = buf.toString("utf8");
      for (const ch of s) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          stdout.write("\n");
          resolvePw(pw);
          return;
        }
        if (ch === "\u0003") {
          stdin.setRawMode(false);
          reject(new Error("Cancelado"));
          return;
        }
        if (ch === "\u007f" || ch === "\b") pw = pw.slice(0, -1);
        else pw += ch;
      }
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function cmdLogin(): Promise<void> {
  const site = normalizeSite(arg("--site") ?? process.env.UTN_MOODLE_SITE ?? DEFAULT_SITE);
  let token = arg("--token");
  let privatetoken: string | undefined;
  let source: "login" | "manual" = "manual";
  if (!token) {
    const user = arg("--user") ?? (await prompt(`Usuario o email del campus (${site}): `));
    const pass = await promptHidden("Contraseña (no se muestra ni se guarda): ");
    const r = await obtainToken(user, pass, site);
    token = r.token;
    privatetoken = r.privatetoken;
    source = "login";
  }
  const client = new MoodleClient(site, token);
  const info = await getSiteInfo(client);
  await saveCredentials({
    site,
    token,
    privatetoken,
    username: info.username,
    userid: info.userid,
    fullname: info.fullname,
    obtainedAt: new Date().toISOString(),
    source,
  });
  console.log(`✔ Sesión iniciada como ${info.fullname} (${info.username}) en ${info.sitename}.`);
  console.log(`  Token guardado en ${PATHS.credentials}`);
  console.log(`  Funciones de API disponibles: ${info.functions.length}`);
}

async function cmdWhoami(): Promise<void> {
  const creds = await loadCredentials();
  if (!creds) {
    console.log("No hay sesión. Ejecutá: utn-mcp login");
    process.exitCode = 1;
    return;
  }
  const client = new MoodleClient(creds.site, creds.token);
  const info = await getSiteInfo(client);
  console.log(`${info.fullname} (${info.username}, id ${info.userid}) en ${info.sitename} [${info.siteurl}]`);
  console.log(`Moodle ${info.release ?? "?"} · ${info.functions.length} funciones · token desde ${creds.obtainedAt} (${creds.source})`);
}

async function cmdDiscover(): Promise<void> {
  const creds = await loadCredentials();
  if (!creds) {
    console.log("No hay sesión. Ejecutá: utn-mcp login");
    process.exitCode = 1;
    return;
  }
  const client = new MoodleClient(creds.site, creds.token);
  const info = await getSiteInfo(client);
  const available = new Set(info.functions.map((f) => f.name));
  const report = checkFunctions(available);
  console.log(`Sitio: ${info.sitename} · Moodle ${info.release ?? "?"} · usuario ${info.username}`);
  console.log(`Funciones habilitadas en el servicio móvil: ${available.size}\n`);
  for (const r of report) {
    const flag = r.ok ? "✔" : "✘";
    const extra = [
      r.missing.length ? `faltan: ${r.missing.join(", ")}` : "",
      r.missingOptional.length ? `opcionales ausentes: ${r.missingOptional.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    console.log(`${flag} ${r.tool}${extra ? `  (${extra})` : ""}`);
  }
  const courses = await getUserCourses(client, info.userid).catch(() => []);
  console.log(`\nMaterias visibles: ${courses.length}`);
  for (const c of courses.slice(0, 30)) console.log(`  [${c.id}] ${c.fullname}`);

  const out = resolve(arg("--out") ?? "docs/functions.json");
  await mkdir(dirname(out), { recursive: true });
  await writeFile(
    out,
    JSON.stringify(
      {
        site: info.siteurl,
        release: info.release,
        generatedAt: new Date().toISOString(),
        functions: [...available].sort(),
        tools: report,
        required: REQUIRED_FUNCTIONS,
      },
      null,
      2,
    ),
  );
  console.log(`\nDetalle guardado en ${out}`);
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? "serve";
  try {
    switch (cmd) {
      case "login":
        return await cmdLogin();
      case "logout":
        await clearCredentials();
        console.log("Token local eliminado.");
        return;
      case "whoami":
        return await cmdWhoami();
      case "discover":
        return await cmdDiscover();
      case "clear-cache": {
        const n = await new JsonCache().clear();
        console.log(`Caché borrada (${n} entradas).`);
        return;
      }
      case "serve":
        return await serve();
      case "help":
      case "--help":
      case "-h":
        console.log(HELP);
        return;
      default:
        console.error(`Comando desconocido: ${cmd}\n`);
        console.log(HELP);
        process.exitCode = 1;
    }
  } catch (err) {
    if (err instanceof AuthError) console.error(`✘ Autenticación: ${err.message}${err.errorcode ? ` (${err.errorcode})` : ""}`);
    else if (err instanceof MoodleError) console.error(`✘ Moodle: ${err.message} (${err.errorcode})`);
    else console.error("✘", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
}

main();
