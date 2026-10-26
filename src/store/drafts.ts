import { readdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ensureDir, readJson, writeJson } from "../util/fs.js";

export interface DraftFile {
  /** Nombre con el que se va a subir al campus. */
  name: string;
  /** Ruta de donde se copió. */
  source: string;
  bytes: number;
  sha1: string;
  addedAt: string;
}

export interface Draft {
  assignmentId: number;
  assignment: string;
  courseId: number;
  course: string;
  files: DraftFile[];
  onlineText?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Borradores locales de entregas, uno por tarea, en <dir>/<assignmentId>/.
 * Los archivos se copian al agregarlos: se sube exactamente lo que el usuario aprobó,
 * aunque el original cambie o se borre después.
 */
export class DraftStore {
  constructor(private readonly dir: string) {}

  private draftDir(assignmentId: number): string {
    return join(this.dir, String(assignmentId));
  }

  /** Ruta de la copia local de un archivo del borrador. */
  filePath(assignmentId: number, name: string): string {
    return join(this.draftDir(assignmentId), "files", name);
  }

  async get(assignmentId: number): Promise<Draft | null> {
    return readJson<Draft>(join(this.draftDir(assignmentId), "draft.json"));
  }

  async list(): Promise<Draft[]> {
    let entries: string[];
    try {
      entries = await readdir(this.dir);
    } catch (err: any) {
      if (err?.code === "ENOENT") return [];
      throw err;
    }
    const drafts = await Promise.all(entries.filter((e) => /^\d+$/.test(e)).map((e) => this.get(Number(e))));
    return drafts.filter((d): d is Draft => d !== null).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async save(draft: Draft): Promise<void> {
    draft.updatedAt = new Date().toISOString();
    await writeJson(join(this.draftDir(draft.assignmentId), "draft.json"), draft);
  }

  /** Copia un archivo al borrador. Si ya había uno con el mismo nombre, lo reemplaza. */
  async addFile(draft: Draft, source: string, name: string): Promise<{ file: DraftFile; replaced: boolean }> {
    const data = await readFile(source);
    const dest = this.filePath(draft.assignmentId, name);
    await ensureDir(join(this.draftDir(draft.assignmentId), "files"));
    await writeFile(dest, data, { mode: 0o600 });
    const file: DraftFile = {
      name,
      source,
      bytes: data.byteLength,
      sha1: createHash("sha1").update(data).digest("hex"),
      addedAt: new Date().toISOString(),
    };
    const replaced = draft.files.some((f) => f.name === name);
    draft.files = [...draft.files.filter((f) => f.name !== name), file];
    return { file, replaced };
  }

  async removeFile(draft: Draft, name: string): Promise<boolean> {
    if (!draft.files.some((f) => f.name === name)) return false;
    draft.files = draft.files.filter((f) => f.name !== name);
    await rm(this.filePath(draft.assignmentId, name), { force: true });
    return true;
  }

  async readFile(assignmentId: number, name: string): Promise<Buffer> {
    return readFile(this.filePath(assignmentId, name));
  }

  async discard(assignmentId: number): Promise<void> {
    await rm(this.draftDir(assignmentId), { recursive: true, force: true });
  }
}
