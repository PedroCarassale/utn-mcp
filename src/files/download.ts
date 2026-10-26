import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { MAX_DOWNLOAD_BYTES, PATHS } from "../config.js";
import type { MoodleClient } from "../moodle/client.js";
import { ensureDir, fileExists, fileSize, sha1 } from "../util/fs.js";
import { safeFilename } from "../util/text.js";

export interface DownloadedFile {
  path: string;
  bytes: number;
  mimetype: string | null;
  cached: boolean;
}

/**
 * Descarga un archivo del campus a ~/.utn-mcp/files/<curso>/<hash>-<nombre>.
 * Si ya existe con el mismo tamaño declarado, no lo vuelve a bajar.
 */
export async function downloadToCache(
  client: MoodleClient,
  fileurl: string,
  filename: string,
  opts: { courseId?: number | string; expectedSize?: number; mimetype?: string | null; maxBytes?: number; force?: boolean; baseDir?: string } = {},
): Promise<DownloadedFile> {
  const dir = join(opts.baseDir ?? PATHS.files, String(opts.courseId ?? "otros"));
  await ensureDir(dir);
  const cleanUrl = fileurl.replace(/[?&]forcedownload=1/, "").replace(/[?&]token=[^&]*/, "");
  const path = join(dir, `${sha1(cleanUrl).slice(0, 10)}-${safeFilename(filename)}`);

  if (!opts.force && (await fileExists(path))) {
    const size = await fileSize(path);
    if (!opts.expectedSize || size === opts.expectedSize) {
      return { path, bytes: size ?? 0, mimetype: opts.mimetype ?? null, cached: true };
    }
  }

  const { bytes, contentType } = await client.download(fileurl, opts.maxBytes ?? MAX_DOWNLOAD_BYTES);
  await writeFile(path, bytes);
  return { path, bytes: bytes.byteLength, mimetype: opts.mimetype ?? contentType, cached: false };
}
