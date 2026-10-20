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

export const PATHS = {
  home: HOME_DIR,
  credentials: join(HOME_DIR, "credentials.json"),
  cache: join(HOME_DIR, "cache"),
  files: join(HOME_DIR, "files"),
  text: join(HOME_DIR, "text"),
  index: join(HOME_DIR, "index.json"),
  snapshots: join(HOME_DIR, "snapshots"),
  log: join(HOME_DIR, "actions.log"),
};

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
