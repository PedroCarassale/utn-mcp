import { DEFAULT_SITE, MOBILE_SERVICE, PATHS } from "../config.js";
import { readJson, writeJson, removeFile } from "../util/fs.js";

export interface Credentials {
  site: string;
  token: string;
  privatetoken?: string;
  username?: string;
  userid?: number;
  fullname?: string;
  obtainedAt: string;
  source: "login" | "manual" | "env";
}

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly errorcode?: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/** Devuelve credenciales desde variables de entorno o del archivo local. */
export async function loadCredentials(): Promise<Credentials | null> {
  const envToken = process.env.UTN_MOODLE_TOKEN;
  if (envToken) {
    return {
      site: normalizeSite(process.env.UTN_MOODLE_SITE ?? DEFAULT_SITE),
      token: envToken,
      obtainedAt: new Date().toISOString(),
      source: "env",
    };
  }
  const stored = await readJson<Credentials>(PATHS.credentials);
  if (!stored?.token) return null;
  return { ...stored, site: normalizeSite(stored.site ?? DEFAULT_SITE) };
}

export async function saveCredentials(creds: Credentials): Promise<void> {
  await writeJson(PATHS.credentials, creds, 0o600);
}

export async function clearCredentials(): Promise<void> {
  await removeFile(PATHS.credentials);
}

export function normalizeSite(site: string): string {
  let s = site.trim();
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  return s.replace(/\/+$/, "");
}

/**
 * Obtiene un token de web services igual que la app oficial Moodle Mobile:
 * POST /login/token.php con usuario, contraseña y service=moodle_mobile_app.
 * La contraseña no se guarda en ningún lado.
 */
export async function obtainToken(
  username: string,
  password: string,
  site: string = DEFAULT_SITE,
  service: string = MOBILE_SERVICE,
  fetchImpl: typeof fetch = fetch,
): Promise<{ token: string; privatetoken?: string }> {
  const base = normalizeSite(site);
  const body = new URLSearchParams({ username, password, service });
  const res = await fetchImpl(`${base}/login/token.php`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new AuthError(`Respuesta inesperada del campus (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  if (data.error) {
    throw new AuthError(data.error, data.errorcode);
  }
  if (!data.token) {
    throw new AuthError("El campus no devolvió un token.");
  }
  return { token: data.token, privatetoken: data.privatetoken };
}
