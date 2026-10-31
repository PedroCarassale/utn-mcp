import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { loadCredentials, type Credentials, AuthError } from "./auth/token.js";
import { MoodleClient, MoodleError } from "./moodle/client.js";
import { getSiteInfo, getUserCourses } from "./moodle/api.js";
import type { Course, SiteInfo } from "./moodle/types.js";
import { JsonCache } from "./store/cache.js";
import { TextIndex } from "./store/index.js";
import { DraftStore } from "./store/drafts.js";
import { PATHS, TTL, pathsFor, type Paths } from "./config.js";
import { appendLog } from "./util/fs.js";

/** Qué decirle al usuario cuando falta la sesión o el token venció. El modo remoto lo reemplaza. */
let loginHint = "Pedile al usuario que ejecute `utn-mcp login` en una terminal (recomendado) o usá la tool campus_login.";

export function setLoginHint(hint: string): void {
  loginHint = hint;
}

export class NotLoggedInError extends Error {
  constructor() {
    super(`No hay sesión del campus. ${loginHint}`);
    this.name = "NotLoggedInError";
  }
}

export interface AppContextOptions {
  /** Credenciales fijas (modo remoto). Si faltan, se leen del entorno o del disco. */
  credentials?: Credentials;
  /** Directorio de datos (caché, archivos, índice). Default: ~/.utn-mcp */
  home?: string;
  /**
   * Arma un link para que el usuario baje un archivo del campus a su computadora (modo remoto,
   * donde la ruta local es del servidor y no le sirve).
   */
  downloadLink?: (fileurl: string, filename: string) => string;
}

/** Estado compartido entre tools: cliente autenticado, caché, índice y borradores de entregas. */
export class AppContext {
  readonly paths: Paths;
  readonly cache: JsonCache;
  readonly index: TextIndex;
  readonly drafts: DraftStore;
  readonly downloadLink?: (fileurl: string, filename: string) => string;
  private readonly fixedCreds: Credentials | null;
  private client: MoodleClient | null = null;
  private creds: Credentials | null = null;
  private siteInfo: SiteInfo | null = null;

  constructor(opts: AppContextOptions = {}) {
    this.paths = opts.home ? pathsFor(opts.home) : PATHS;
    this.cache = new JsonCache(this.paths.cache);
    this.index = new TextIndex(this.paths.index, this.paths.text);
    this.drafts = new DraftStore(this.paths.drafts);
    this.fixedCreds = opts.credentials ?? null;
    this.downloadLink = opts.downloadLink;
  }

  reset(): void {
    this.client = null;
    this.creds = null;
    this.siteInfo = null;
  }

  async getCredentials(): Promise<Credentials> {
    if (!this.creds) this.creds = this.fixedCreds ?? (await loadCredentials());
    if (!this.creds) throw new NotLoggedInError();
    return this.creds;
  }

  async getClient(): Promise<MoodleClient> {
    if (this.client) return this.client;
    const creds = await this.getCredentials();
    this.client = new MoodleClient(creds.site, creds.token);
    return this.client;
  }

  async getSiteInfo(force = false): Promise<SiteInfo> {
    if (this.siteInfo && !force) return this.siteInfo;
    const client = await this.getClient();
    const creds = await this.getCredentials();
    this.siteInfo = await this.cache.getOrFetch(`siteinfo:${creds.site}:${creds.token.slice(0, 8)}`, TTL.siteInfo, () => getSiteInfo(client), force);
    return this.siteInfo;
  }

  async getUserId(): Promise<number> {
    const creds = await this.getCredentials();
    if (creds.userid) return creds.userid;
    return (await this.getSiteInfo()).userid;
  }

  async hasFunction(name: string): Promise<boolean> {
    const info = await this.getSiteInfo();
    return info.functions.some((f) => f.name === name);
  }

  async getCourses(force = false): Promise<Course[]> {
    const client = await this.getClient();
    const userid = await this.getUserId();
    return this.cache.getOrFetch(`courses:${userid}`, TTL.courses, () => getUserCourses(client, userid), force);
  }

  async courseName(courseId: number): Promise<string> {
    const courses = await this.getCourses().catch(() => [] as Course[]);
    return courses.find((c) => c.id === courseId)?.fullname ?? `Curso ${courseId}`;
  }

  async log(line: string): Promise<void> {
    await appendLog(this.paths.log, line).catch(() => undefined);
  }
}

/* ------------------------- helpers de respuesta ------------------------- */

export function ok(data: unknown): CallToolResult {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: "text", text }] };
}

export function fail(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

export function describeError(err: unknown): string {
  if (err instanceof NotLoggedInError) return err.message;
  if (err instanceof AuthError) return `Error de autenticación: ${err.message}`;
  if (err instanceof MoodleError) {
    if (err.isInvalidToken) {
      return `El token del campus es inválido o venció. ${loginHint}`;
    }
    const fn = err.wsfunction ? ` [${err.wsfunction}]` : "";
    const dbg = err.debuginfo ? ` (${err.debuginfo})` : "";
    return `Moodle respondió un error${fn}: ${err.message} (${err.errorcode})${dbg}`;
  }
  if (err instanceof Error) return `Error: ${err.message}`;
  return `Error: ${String(err)}`;
}

/** Envuelve un handler para convertir excepciones en resultados de error legibles. */
export function wrap<A>(fn: (args: A) => Promise<CallToolResult>): (args: A) => Promise<CallToolResult> {
  return async (args: A) => {
    try {
      return await fn(args);
    } catch (err) {
      return fail(describeError(err));
    }
  };
}
