import { MAX_DOWNLOAD_BYTES, MIN_REQUEST_INTERVAL_MS } from "../config.js";

export class MoodleError extends Error {
  constructor(
    message: string,
    public readonly errorcode: string,
    public readonly debuginfo?: string,
    public readonly wsfunction?: string,
  ) {
    super(message);
    this.name = "MoodleError";
  }

  get isInvalidToken(): boolean {
    return this.errorcode === "invalidtoken" || this.errorcode === "accessexception";
  }
}

export interface MoodleClientOptions {
  fetchImpl?: typeof fetch;
  minIntervalMs?: number;
  maxRetries?: number;
}

/**
 * Convierte argumentos anidados al formato que espera Moodle:
 * { courseids: [1,2], options: [{name:"x", value:"y"}] }
 * → courseids[0]=1, courseids[1]=2, options[0][name]=x, options[0][value]=y
 */
export function flattenArgs(value: unknown, prefix = "", out: [string, string][] = []): [string, string][] {
  if (value === undefined || value === null) return out;
  if (Array.isArray(value)) {
    value.forEach((v, i) => flattenArgs(v, `${prefix}[${i}]`, out));
    return out;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      flattenArgs(v, prefix ? `${prefix}[${k}]` : k, out);
    }
    return out;
  }
  out.push([prefix, typeof value === "boolean" ? (value ? "1" : "0") : String(value)]);
  return out;
}

/** Reescribe una URL de pluginfile para que acepte autenticación por token. */
export function tokenizeFileUrl(fileurl: string, token: string): string {
  let url = fileurl.replace(/\/(?:webservice\/)?pluginfile\.php\//, "/webservice/pluginfile.php/");
  if (/[?&]token=/.test(url)) return url;
  url += (url.includes("?") ? "&" : "?") + `token=${encodeURIComponent(token)}`;
  return url;
}

export class MoodleClient {
  private readonly fetchImpl: typeof fetch;
  private readonly minInterval: number;
  private readonly maxRetries: number;
  private lastRequestAt = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    public readonly site: string,
    private readonly token: string,
    opts: MoodleClientOptions = {},
  ) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.minInterval = opts.minIntervalMs ?? MIN_REQUEST_INTERVAL_MS;
    this.maxRetries = opts.maxRetries ?? 2;
  }

  /** Serializa y espacia las llamadas para no castigar el servidor de la facultad. */
  private async throttle(): Promise<void> {
    const run = this.queue.then(async () => {
      const wait = this.lastRequestAt + this.minInterval - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastRequestAt = Date.now();
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Llama a una wsfunction REST y devuelve el JSON parseado. */
  async call<T = any>(wsfunction: string, args: Record<string, unknown> = {}): Promise<T> {
    const params = new URLSearchParams();
    params.set("wstoken", this.token);
    params.set("wsfunction", wsfunction);
    params.set("moodlewsrestformat", "json");
    for (const [k, v] of flattenArgs(args)) params.append(k, v);

    let attempt = 0;
    for (;;) {
      await this.throttle();
      let res: Response;
      try {
        res = await this.fetchImpl(`${this.site}/webservice/rest/server.php`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params,
        });
      } catch (err: any) {
        if (attempt++ < this.maxRetries) continue;
        throw new MoodleError(`Error de red llamando a ${wsfunction}: ${err?.message ?? err}`, "network", undefined, wsfunction);
      }
      const text = await res.text();
      if (res.status >= 500 && attempt++ < this.maxRetries) continue;
      let data: any;
      try {
        data = text === "" || text === "null" ? null : JSON.parse(text);
      } catch {
        throw new MoodleError(
          `Respuesta no JSON de ${wsfunction} (HTTP ${res.status}): ${text.slice(0, 300)}`,
          "badresponse",
          undefined,
          wsfunction,
        );
      }
      if (data && typeof data === "object" && "exception" in data) {
        throw new MoodleError(
          data.message ?? data.exception,
          data.errorcode ?? "unknown",
          data.debuginfo,
          wsfunction,
        );
      }
      return data as T;
    }
  }

  /** True si la URL apunta al mismo origen (esquema, host y puerto) que el campus. */
  isSiteUrl(url: string): boolean {
    try {
      return new URL(url).origin === new URL(this.site).origin;
    } catch {
      return false;
    }
  }

  /** Descarga un archivo de Moodle (pluginfile) usando el token. */
  async download(
    fileurl: string,
    maxBytes: number = MAX_DOWNLOAD_BYTES,
  ): Promise<{ bytes: Uint8Array; contentType: string | null; finalUrl: string }> {
    // El token va en la URL: nunca mandarlo a otro servidor que no sea el campus.
    if (!this.isSiteUrl(fileurl)) {
      throw new MoodleError(`Solo se pueden descargar archivos de ${this.site}.`, "foreignurl");
    }
    await this.throttle();
    const url = tokenizeFileUrl(fileurl, this.token);
    const res = await this.fetchImpl(url, { method: "GET", redirect: "follow" });
    if (!res.ok) {
      throw new MoodleError(`No se pudo descargar el archivo (HTTP ${res.status})`, "downloadfailed");
    }
    const contentType = res.headers.get("content-type");
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared && declared > maxBytes) {
      throw new MoodleError(
        `El archivo pesa ${declared} bytes y supera el límite de ${maxBytes}.`,
        "toolarge",
      );
    }
    if (contentType && /text\/html/i.test(contentType)) {
      const sample = await res.text();
      if (/login\/index\.php|loginform|invalidtoken/i.test(sample)) {
        throw new MoodleError("Moodle devolvió la pantalla de login al descargar: el token puede estar vencido.", "invalidtoken");
      }
      return { bytes: new TextEncoder().encode(sample), contentType, finalUrl: res.url || url };
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) {
      throw new MoodleError(`El archivo supera el límite de ${maxBytes} bytes.`, "toolarge");
    }
    return { bytes: buf, contentType, finalUrl: res.url || url };
  }
}
