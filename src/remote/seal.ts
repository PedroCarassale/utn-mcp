import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Cifrado autenticado (AES-256-GCM) para los tokens del modo remoto.
 * Todo lo que el servidor emite (client_id, códigos, access y refresh tokens) es un
 * JSON sellado con esta clave, así no hace falta base de datos: el servidor no guarda nada.
 */

const PREFIX = "u1.";

export type SealKind = "client" | "pending" | "code" | "access" | "refresh" | "download";

interface Envelope<T> {
  k: SealKind;
  /** Vencimiento en segundos epoch. 0 = no vence. */
  exp: number;
  d: T;
}

export class Sealer {
  private readonly key: Buffer;

  constructor(secret: string) {
    if (!secret || secret.length < 32) {
      throw new Error("UTN_MCP_SECRET debe tener al menos 32 caracteres (generalo con `openssl rand -base64 48`).");
    }
    this.key = createHash("sha256").update(secret).digest();
  }

  seal<T>(kind: SealKind, data: T, ttlSeconds = 0): string {
    const env: Envelope<T> = { k: kind, exp: ttlSeconds ? Math.floor(Date.now() / 1000) + ttlSeconds : 0, d: data };
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(kind));
    const body = Buffer.concat([cipher.update(JSON.stringify(env), "utf8"), cipher.final()]);
    return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
  }

  /** Devuelve los datos si el token es de este tipo, está intacto y no venció; si no, null. */
  open<T>(kind: SealKind, token: string): T | null {
    if (!token.startsWith(PREFIX)) return null;
    try {
      const raw = Buffer.from(token.slice(PREFIX.length), "base64url");
      if (raw.length < 29) return null;
      const decipher = createDecipheriv("aes-256-gcm", this.key, raw.subarray(0, 12));
      decipher.setAAD(Buffer.from(kind));
      decipher.setAuthTag(raw.subarray(12, 28));
      const json = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
      const env = JSON.parse(json) as Envelope<T>;
      if (env.k !== kind) return null;
      if (env.exp && env.exp < Math.floor(Date.now() / 1000)) return null;
      return env.d;
    } catch {
      return null;
    }
  }
}
