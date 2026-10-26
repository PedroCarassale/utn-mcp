import { homedir } from "node:os";
import { join } from "node:path";

/** URL base del campus. Se puede sobreescribir con UTN_MOODLE_SITE. */
export const DEFAULT_SITE = "https://frlp.cvg.utn.edu.ar";

/** Servicio de web services que usa la app oficial de Moodle. */
export const MOBILE_SERVICE = "moodle_mobile_app";

/** Zona horaria para formatear fechas. */
export const TIMEZONE = process.env.UTN_MCP_TZ ?? "America/Argentina/Buenos_Aires";

/** Directorio raíz de datos locales (token, caché, archivos). */
export const HOME_DIR = process.env.UTN_MCP_HOME ?? join(homedir(), ".utn-mcp");

export type Paths = ReturnType<typeof pathsFor>;

/** Rutas de datos bajo un directorio raíz. En modo remoto hay uno por usuario. */
export function pathsFor(home: string) {
  return {
    home,
    credentials: join(home, "credentials.json"),
    cache: join(home, "cache"),
    files: join(home, "files"),
    text: join(home, "text"),
    index: join(home, "index.json"),
    snapshots: join(home, "snapshots"),
    drafts: join(home, "drafts"),
    log: join(home, "actions.log"),
  };
}

export const PATHS = pathsFor(HOME_DIR);

/** Límite por defecto de tamaño de archivo a descargar (25 MB). */
export const MAX_DOWNLOAD_BYTES = Number(process.env.UTN_MCP_MAX_DOWNLOAD ?? 25 * 1024 * 1024);

/** Intervalo mínimo entre llamadas al servidor de la facultad (ms). */
export const MIN_REQUEST_INTERVAL_MS = Number(process.env.UTN_MCP_MIN_INTERVAL ?? 300);

/** TTLs de caché. */
export const TTL = {
  courses: 10 * 60 * 1000,
  contents: 10 * 60 * 1000,
  calendar: 5 * 60 * 1000,
  grades: 5 * 60 * 1000,
  siteInfo: 60 * 60 * 1000,
};

/** Cuántos caracteres de texto devolver por defecto al leer un archivo. */
export const DEFAULT_TEXT_CHARS = 12000;
