import { join } from "node:path";
import { PATHS } from "../config.js";
import { readJson, writeJson, sha1, ensureDir } from "../util/fs.js";
import { readdir, rm } from "node:fs/promises";

interface Envelope<T> {
  key: string;
  savedAt: number;
  data: T;
}

/** Caché JSON en disco con TTL. Una entrada por archivo. */
export class JsonCache {
  constructor(private readonly dir: string = PATHS.cache) {}

  private pathFor(key: string): string {
    return join(this.dir, `${sha1(key)}.json`);
  }

  async get<T>(key: string, ttlMs: number): Promise<T | null> {
    const env = await readJson<Envelope<T>>(this.pathFor(key));
    if (!env) return null;
    if (Date.now() - env.savedAt > ttlMs) return null;
    return env.data;
  }

  async set<T>(key: string, data: T): Promise<void> {
    await writeJson(this.pathFor(key), { key, savedAt: Date.now(), data } satisfies Envelope<T>);
  }

  /** Devuelve el valor cacheado o lo calcula y guarda. `force` ignora la caché. */
  async getOrFetch<T>(key: string, ttlMs: number, fetcher: () => Promise<T>, force = false): Promise<T> {
    if (!force) {
      const hit = await this.get<T>(key, ttlMs);
      if (hit !== null) return hit;
    }
    const data = await fetcher();
    await this.set(key, data);
    return data;
  }

  async clear(): Promise<number> {
    await ensureDir(this.dir);
    const files = await readdir(this.dir);
    await Promise.all(files.map((f) => rm(join(this.dir, f), { force: true })));
    return files.length;
  }
}
