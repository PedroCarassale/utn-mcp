import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AppContext, ok, fail, wrap } from "../context.js";
import { obtainToken, saveCredentials, clearCredentials, normalizeSite } from "../auth/token.js";
import { DEFAULT_SITE } from "../config.js";
import { MoodleClient } from "../moodle/client.js";
import { getSiteInfo } from "../moodle/api.js";
import { checkFunctions } from "../moodle/required.js";

export function registerAuthTools(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    "campus_login",
    {
      title: "Iniciar sesión en el campus",
      description:
        "Obtiene un token del campus virtual con usuario y contraseña (igual que la app Moodle Mobile) y lo guarda localmente. " +
        "La contraseña NO se guarda. Preferí que el usuario corra `utn-mcp login` en su terminal para no pegar la contraseña en el chat; " +
        "usá esta tool solo si el usuario lo pide explícitamente. También acepta un token ya generado (Preferencias → Claves de seguridad).",
      inputSchema: {
        username: z.string().optional().describe("Usuario o email del campus"),
        password: z.string().optional().describe("Contraseña del campus. No se persiste."),
        token: z.string().optional().describe("Alternativa: token de web services ya generado por el usuario"),
        site: z.string().optional().describe(`URL del campus. Por defecto ${DEFAULT_SITE}`),
      },
      annotations: { destructiveHint: false, openWorldHint: true },
    },
    wrap(async ({ username, password, token, site }) => {
      const base = normalizeSite(site ?? DEFAULT_SITE);
      let finalToken = token;
      let privatetoken: string | undefined;
      let source: "login" | "manual" = "manual";
      if (!finalToken) {
        if (!username || !password) return fail("Falta usuario y contraseña, o un token.");
        const r = await obtainToken(username, password, base);
        finalToken = r.token;
        privatetoken = r.privatetoken;
        source = "login";
      }
      const client = new MoodleClient(base, finalToken);
      const info = await getSiteInfo(client);
      await saveCredentials({
        site: base,
        token: finalToken,
        privatetoken,
        username: info.username,
        userid: info.userid,
        fullname: info.fullname,
        obtainedAt: new Date().toISOString(),
        source,
      });
      ctx.reset();
      await ctx.log(`login userid=${info.userid} source=${source}`);
      return ok({
        ok: true,
        message: `Sesión iniciada como ${info.fullname} (${info.username}) en ${info.sitename}.`,
        userid: info.userid,
        functionsAvailable: info.functions.length,
      });
    }),
  );

  server.registerTool(
    "campus_logout",
    {
      title: "Cerrar sesión local",
      description: "Borra el token guardado localmente. El token sigue existiendo en Moodle hasta que el usuario lo revoque desde Preferencias → Claves de seguridad.",
      inputSchema: {},
      annotations: { destructiveHint: true },
    },
    wrap(async () => {
      await clearCredentials();
      ctx.reset();
      return ok({ ok: true, message: "Token local eliminado." });
    }),
  );

  server.registerTool(
    "campus_whoami",
    {
      title: "Quién soy en el campus",
      description: "Devuelve el usuario autenticado, el sitio, la versión de Moodle y cuántas funciones de la API están disponibles. Útil para verificar que la sesión funciona.",
      inputSchema: { refresh: z.boolean().optional().describe("Ignorar caché") },
      annotations: { readOnlyHint: true },
    },
    wrap(async ({ refresh }) => {
      const info = await ctx.getSiteInfo(Boolean(refresh));
      const creds = await ctx.getCredentials();
      return ok({
        fullname: info.fullname,
        username: info.username,
        userid: info.userid,
        site: info.siteurl,
        sitename: info.sitename,
        release: info.release,
        lang: info.lang,
        functionsAvailable: info.functions.length,
        tokenSource: creds.source,
        tokenObtainedAt: creds.obtainedAt,
      });
    }),
  );

  server.registerTool(
    "campus_functions",
    {
      title: "Funciones de la API disponibles",
      description: "Lista qué tools de este servidor van a funcionar según las wsfunctions que la facultad tiene habilitadas. Opcionalmente filtra la lista completa de funciones por texto.",
      inputSchema: {
        filter: z.string().optional().describe("Texto a buscar en los nombres de funciones, p. ej. 'scheduler' o 'assign'"),
        listAll: z.boolean().optional().describe("Incluir la lista completa de funciones (puede ser larga)"),
      },
      annotations: { readOnlyHint: true },
    },
    wrap(async ({ filter, listAll }) => {
      const info = await ctx.getSiteInfo();
      const available = new Set(info.functions.map((f) => f.name));
      const report = checkFunctions(available);
      const names = info.functions.map((f) => f.name).sort();
      const filtered = filter ? names.filter((n) => n.includes(filter.toLowerCase())) : [];
      return ok({
        total: names.length,
        tools: report,
        ...(filter ? { matching: filtered } : {}),
        ...(listAll ? { all: names } : {}),
      });
    }),
  );
}
