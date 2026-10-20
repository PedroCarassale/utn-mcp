import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { PATHS } from "../config.js";
import { ensureDir, readJson, writeJson, sha1 } from "../util/fs.js";
import { normalize, tokenize } from "../util/text.js";

/** Entrada del índice local de materiales con texto extraído. */
export interface IndexEntry {
  id: string;
  courseId: number;
  courseName: string;
  sectionName: string;
  moduleId: number;
  moduleName: string;
  modname: string;
  filename: string;
  fileurl: string;
  localPath: string;
  textPath: string | null;
  chars: number;
  kind: string;
  pages?: number;
  indexedAt: string;
  warning?: string;
}

export interface SearchHit {
  entry: Omit<IndexEntry, "textPath">;
  score: number;
  snippets: string[];
}

export class TextIndex {
  private entries: IndexEntry[] | null = null;

  constructor(
    private readonly indexPath: string = PATHS.index,
    private readonly textDir: string = PATHS.text,
  ) {}

  async load(): Promise<IndexEntry[]> {
    if (!this.entries) this.entries = (await readJson<IndexEntry[]>(this.indexPath)) ?? [];
    return this.entries;
  }

  private async save(): Promise<void> {
    await writeJson(this.indexPath, this.entries ?? []);
  }

  entryIdFor(fileurl: string): string {
    return sha1(fileurl.replace(/[?&]forcedownload=1/, "").replace(/[?&]token=[^&]*/, ""));
  }

  async get(id: string): Promise<IndexEntry | undefined> {
    return (await this.load()).find((e) => e.id === id);
  }

  async upsert(entry: Omit<IndexEntry, "textPath" | "indexedAt">, text: string | null): Promise<IndexEntry> {
    const all = await this.load();
    let textPath: string | null = null;
    if (text && text.trim()) {
      await ensureDir(this.textDir);
      textPath = join(this.textDir, `${entry.id}.txt`);
      await writeFile(textPath, text, "utf8");
    }
    const full: IndexEntry = { ...entry, textPath, indexedAt: new Date().toISOString() };
    const i = all.findIndex((e) => e.id === entry.id);
    if (i >= 0) all[i] = full;
    else all.push(full);
    await this.save();
    return full;
  }

  async readText(id: string): Promise<string | null> {
    const e = await this.get(id);
    if (!e?.textPath) return null;
    try {
      return await readFile(e.textPath, "utf8");
    } catch {
      return null;
    }
  }

  async list(courseId?: number): Promise<IndexEntry[]> {
    const all = await this.load();
    return courseId ? all.filter((e) => e.courseId === courseId) : all;
  }

  /** Búsqueda full-text simple: puntúa por ocurrencias de cada término y arma snippets. */
  async search(query: string, opts: { courseId?: number; limit?: number; snippetChars?: number } = {}): Promise<SearchHit[]> {
    const terms = tokenize(query);
    if (terms.length === 0) return [];
    const candidates = await this.list(opts.courseId);
    const hits: SearchHit[] = [];
    for (const e of candidates) {
      let score = 0;
      const snippets: string[] = [];
      const nameNorm = normalize(`${e.filename} ${e.moduleName} ${e.sectionName}`);
      for (const t of terms) if (nameNorm.includes(t)) score += 5;

      if (e.textPath) {
        let text: string;
        try {
          text = await readFile(e.textPath, "utf8");
        } catch {
          continue;
        }
        const norm = normalize(text);
        for (const t of terms) {
          let idx = norm.indexOf(t);
          let count = 0;
          while (idx !== -1 && count < 50) {
            count++;
            if (snippets.length < 3) {
              const half = Math.floor((opts.snippetChars ?? 160) / 2);
              const start = Math.max(0, idx - half);
              const end = Math.min(text.length, idx + t.length + half);
              snippets.push(text.slice(start, end).replace(/\s+/g, " ").trim());
            }
            idx = norm.indexOf(t, idx + t.length);
          }
          score += Math.min(count, 20);
        }
      }
      if (score > 0) {
        const { textPath: _omit, ...rest } = e;
        hits.push({ entry: rest, score, snippets });
      }
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, opts.limit ?? 15);
  }
}
