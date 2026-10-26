// Punto de entrada de Vercel: todas las rutas se reescriben acá (ver vercel.json).
// Usa el build de TypeScript (`npm run build`), que Vercel corre antes de empaquetar la función.
import { createRemoteApp, remoteConfigFromEnv } from "../dist/remote/app.js";

let handler;
try {
  handler = createRemoteApp(remoteConfigFromEnv());
} catch (err) {
  // Error de configuración (p. ej. falta UTN_MCP_SECRET): mostrarlo en vez de un 500 genérico.
  console.error("[utn-mcp] no pudo arrancar:", err);
  const message = `utn-mcp no pudo arrancar: ${err instanceof Error ? err.message : String(err)}`;
  handler = (_req, res) => {
    res.statusCode = 500;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(message);
  };
}

export default handler;
