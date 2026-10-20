import { mkdir, readFile, writeFile, rm, stat, appendFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash } from "node:crypto";

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export async function readJson<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as T;
  } catch (err: any) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}

export async function writeJson(path: string, data: unknown, mode = 0o600): Promise<void> {
  await ensureDir(dirname(path));
  await writeFile(path, JSON.stringify(data, null, 2), { encoding: "utf8", mode });
}

export async function removeFile(path: string): Promise<void> {
  await rm(path, { force: true });
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function fileSize(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size;
  } catch {
    return null;
  }
}

export function sha1(s: string): string {
  return createHash("sha1").update(s).digest("hex");
}

export async function appendLog(path: string, line: string): Promise<void> {
  await ensureDir(dirname(path));
  await appendFile(path, `${new Date().toISOString()} ${line}\n`, "utf8");
}
