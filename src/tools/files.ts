import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AppContext, ok, fail, wrap } from "../context.js";
import { getContentsCached } from "./courses.js";
import { downloadToCache } from "../files/download.js";
import { extractText } from "../files/extract.js";
import { DEFAULT_TEXT_CHARS } from "../config.js";
import { fmtBytes, fmtDate, normalize, tokenize } from "../util/text.js";
import type { CourseModule, ModuleContent, CourseSection } from "../moodle/types.js";

interface FileRef {
  courseId: number;
  courseName: string;
  sectionName: string;
  module: CourseModule;
  file: ModuleContent;
}

function filesInSections(courseId: number, courseName: string, sections: CourseSection[]): FileRef[] {
  const out: FileRef[] = [];
  for (const s of sections) {
    for (const m of s.modules) {
      for (const f of m.contents ?? []) {
        if (f.type === "file" && f.fileurl) out.push({ courseId, courseName, sectionName: s.name, module: m, file: f });
      }
    }
  }
  return out;
}

async function findFileByUrl(ctx: AppContext, fileurl: string, courseIdHint?: number): Promise<FileRef | null> {
  const clean = (u: string) => u.replace(/[?&]forcedownload=1/, "");
  const target = clean(fileurl);
  const courseIds = courseIdHint ? [courseIdHint] : (await ctx.getCourses()).map((c) => c.id);
  for (const id of courseIds) {
    const sections = await getContentsCached(ctx, id).catch(() => [] as CourseSection[]);
    const hit = filesInSections(id, "", sections).find((r) => clean(r.file.fileurl!) === target);
    if (hit) return { ...hit, courseName: await ctx.courseName(id) };
    if (courseIdHint) break;
  }
  return null;
}

/** Descarga, extrae texto, indexa y devuelve un resumen del archivo. */
export async function ingestFile(ctx: AppContext, ref: Partial<FileRef> & { fileurl: string; filename: string }, opts: { force?: boolean; maxBytes?: number } = {}) {
  const client = await ctx.getClient();
  const dl = await downloadToCache(client, ref.fileurl, ref.filename, {
    courseId: ref.courseId ?? "otros",
    expectedSize: ref.file?.filesize,
    mimetype: ref.file?.mimetype,
    force: opts.force,
    maxBytes: opts.maxBytes,
  });
  const extracted = await extractText(dl.path, dl.mimetype);
  const id = ctx.index.entryIdFor(ref.fileurl);
  const entry = await ctx.index.upsert(
    {
      id,
      courseId: ref.courseId ?? 0,
      courseName: ref.courseName ?? "",
      sectionName: ref.sectionName ?? "",
      moduleId: ref.module?.id ?? 0,
      moduleName: ref.module?.name ?? "",
      modname: ref.module?.modname ?? "",
      filename: ref.filename,
      fileurl: ref.fileurl,
      localPath: dl.path,
      chars: extracted.text.length,
      kind: extracted.kind,
      pages: extracted.pages,
      warning: extracted.warning,
    },
    extracted.text,
  );
  return { dl, extracted, entry };
}

export function registerFileTools(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    "campus_get_file",
    {
      title: "Leer o descargar un apunte",
      description:
        "Descarga un archivo del campus (por `fileurl` de campus_course_contents, o por `cmid` si el módulo tiene un solo archivo) y devuelve su texto extraído (PDF, DOCX, PPTX, XLSX, TXT, HTML) " +
        "más la ruta local. El texto se devuelve por partes: usá `offset` para seguir leyendo si `hasMore` es true. Con mode='path' solo descarga.",
      inputSchema: {
        fileurl: z.string().url().optional().describe("URL del archivo (campo fileurl)"),
        cmid: z.number().int().optional().describe("Alternativa: id del módulo. Si tiene varios archivos, los lista para elegir."),
        courseId: z.number().int().optional().describe("Id de la materia (acelera la búsqueda y ordena la caché)"),
        mode: z.enum(["text", "path", "both"]).optional().describe("Qué devolver. Default: both"),
        offset: z.number().int().min(0).optional().describe("Desde qué carácter devolver el texto"),
        maxChars: z.number().int().min(500).max(100000).optional().describe(`Cuántos caracteres devolver. Default ${DEFAULT_TEXT_CHARS}`),
        refresh: z.boolean().optional().describe("Volver a descargar aunque esté en caché"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    wrap(async ({ fileurl, cmid, courseId, mode, offset, maxChars, refresh }) => {
      let ref: FileRef | null = null;
      if (cmid) {
        const client = await ctx.getClient();
        const cm = await (await import("../moodle/api.js")).getCourseModule(client, cmid);
        const sections = await getContentsCached(ctx, cm.course);
        const files = filesInSections(cm.course, await ctx.courseName(cm.course), sections).filter((r) => r.module.id === cmid);
        if (files.length === 0) return fail(`El módulo ${cmid} (${cm.name}) no tiene archivos descargables.`);
        if (files.length > 1 && !fileurl) {
          return ok({
            message: "El módulo tiene varios archivos; volvé a llamar con `fileurl` del que querés.",
            files: files.map((r) => ({ filename: r.file.filename, size: fmtBytes(r.file.filesize), fileurl: r.file.fileurl, modified: fmtDate(r.file.timemodified) })),
          });
        }
        ref = fileurl ? files.find((r) => r.file.fileurl === fileurl) ?? null : files[0];
      } else if (fileurl) {
        ref = await findFileByUrl(ctx, fileurl, courseId);
      } else {
        return fail("Indicá `fileurl` o `cmid`.");
      }

      const url = ref?.file.fileurl ?? fileurl!;
      const filename = ref?.file.filename ?? decodeURIComponent(url.split("/").pop()?.split("?")[0] ?? "archivo");
      const { dl, extracted, entry } = await ingestFile(ctx, { ...(ref ?? {}), courseId: ref?.courseId ?? courseId, fileurl: url, filename }, { force: refresh });

      const m = mode ?? "both";
      const start = offset ?? 0;
      const len = maxChars ?? DEFAULT_TEXT_CHARS;
      const slice = extracted.text.slice(start, start + len);
      return ok({
        filename,
        course: entry.courseName || undefined,
        section: entry.sectionName || undefined,
        module: entry.moduleName || undefined,
        path: dl.path,
        bytes: dl.bytes,
        size: fmtBytes(dl.bytes),
        kind: extracted.kind,
        pages: extracted.pages,
        cached: dl.cached,
        ...(extracted.warning ? { warning: extracted.warning } : {}),
        ...(m !== "path"
          ? {
              totalChars: extracted.text.length,
              offset: start,
              returnedChars: slice.length,
              hasMore: start + slice.length < extracted.text.length,
              nextOffset: start + slice.length < extracted.text.length ? start + slice.length : null,
              text: slice,
            }
          : {}),
      });
    }),
  );

  server.registerTool(
    "campus_search_files",
    {
      title: "Buscar apuntes por nombre",
      description:
        "Busca archivos en todas las materias (o en una) por nombre de archivo, módulo o sección. No lee el contenido; para eso usá campus_search_content después de campus_index_course. " +
        "Ejemplo: 'unidad 3 analisis' o 'practica derivadas'.",
      inputSchema: {
        query: z.string().min(2).describe("Palabras a buscar"),
        courseId: z.number().int().optional().describe("Limitar a una materia"),
        limit: z.number().int().min(1).max(100).optional().describe("Máximo de resultados. Default 25"),
      },
      annotations: { readOnlyHint: true },
    },
    wrap(async ({ query, courseId, limit }) => {
      const terms = tokenize(query);
      const courses = courseId ? [{ id: courseId, fullname: await ctx.courseName(courseId) }] : await ctx.getCourses();
      const hits: { score: number; row: any }[] = [];
      for (const c of courses) {
        const sections = await getContentsCached(ctx, c.id).catch(() => [] as CourseSection[]);
        const courseNorm = normalize(c.fullname);
        for (const r of filesInSections(c.id, c.fullname, sections)) {
          const hay = normalize(`${r.file.filename} ${r.module.name} ${r.sectionName}`);
          let score = 0;
          for (const t of terms) {
            if (hay.includes(t)) score += 3;
            else if (courseNorm.includes(t)) score += 1;
          }
          if (score === 0) continue;
          hits.push({
            score,
            row: {
              courseId: c.id,
              course: c.fullname,
              section: r.sectionName,
              module: r.module.name,
              cmid: r.module.id,
              filename: r.file.filename,
              size: fmtBytes(r.file.filesize),
              modified: fmtDate(r.file.timemodified),
              fileurl: r.file.fileurl,
            },
          });
        }
      }
      hits.sort((a, b) => b.score - a.score);
      return ok({ query, results: hits.slice(0, limit ?? 25).map((h) => h.row) });
    }),
  );

  server.registerTool(
    "campus_index_course",
    {
      title: "Indexar los apuntes de una materia",
      description:
        "Descarga todos los archivos de una materia (PDF, DOCX, PPTX, etc.), extrae su texto y arma un índice local para buscar dentro del contenido con campus_search_content. " +
        "Puede tardar si hay muchos archivos. Omite archivos mayores a maxFileMB y multimedia.",
      inputSchema: {
        courseId: z.number().int().describe("Id de la materia"),
        maxFileMB: z.number().min(0.1).max(200).optional().describe("Tamaño máximo por archivo en MB. Default 20"),
        refresh: z.boolean().optional().describe("Reprocesar archivos ya indexados"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    wrap(async ({ courseId, maxFileMB, refresh }) => {
      const sections = await getContentsCached(ctx, courseId, true);
      const courseName = await ctx.courseName(courseId);
      const refs = filesInSections(courseId, courseName, sections);
      const maxBytes = (maxFileMB ?? 20) * 1024 * 1024;
      const indexed: any[] = [];
      const skipped: any[] = [];
      const errors: any[] = [];
      for (const r of refs) {
        const mt = r.file.mimetype ?? "";
        if (/^(video|audio|image)\//.test(mt)) {
          skipped.push({ filename: r.file.filename, reason: "multimedia" });
          continue;
        }
        if (r.file.filesize > maxBytes) {
          skipped.push({ filename: r.file.filename, reason: `supera ${maxFileMB ?? 20} MB` });
          continue;
        }
        const id = ctx.index.entryIdFor(r.file.fileurl!);
        if (!refresh && (await ctx.index.get(id))) {
          skipped.push({ filename: r.file.filename, reason: "ya indexado" });
          continue;
        }
        try {
          const { entry } = await ingestFile(ctx, { ...r, fileurl: r.file.fileurl!, filename: r.file.filename }, { maxBytes });
          indexed.push({ filename: r.file.filename, section: r.sectionName, chars: entry.chars, kind: entry.kind, warning: entry.warning });
        } catch (err: any) {
          errors.push({ filename: r.file.filename, error: err?.message ?? String(err) });
        }
      }
      await ctx.log(`index course=${courseId} indexed=${indexed.length} skipped=${skipped.length} errors=${errors.length}`);
      return ok({ courseId, course: courseName, totalFiles: refs.length, indexed, skipped, errors });
    }),
  );

  server.registerTool(
    "campus_search_content",
    {
      title: "Buscar dentro de los apuntes",
      description:
        "Búsqueda full-text en el texto de los archivos ya indexados con campus_index_course (o leídos con campus_get_file). Devuelve fragmentos con contexto y el archivo de origen. " +
        "Si no hay resultados, probablemente falte indexar la materia.",
      inputSchema: {
        query: z.string().min(2).describe("Términos a buscar, p. ej. 'teorema de Bolzano'"),
        courseId: z.number().int().optional().describe("Limitar a una materia"),
        limit: z.number().int().min(1).max(50).optional().describe("Máximo de archivos. Default 15"),
      },
      annotations: { readOnlyHint: true },
    },
    wrap(async ({ query, courseId, limit }) => {
      const hits = await ctx.index.search(query, { courseId, limit });
      const indexedCount = (await ctx.index.list(courseId)).length;
      return ok({
        query,
        indexedFiles: indexedCount,
        results: hits.map((h) => ({
          score: h.score,
          courseId: h.entry.courseId,
          course: h.entry.courseName,
          section: h.entry.sectionName,
          module: h.entry.moduleName,
          filename: h.entry.filename,
          fileurl: h.entry.fileurl,
          path: h.entry.localPath,
          snippets: h.snippets,
        })),
        ...(indexedCount === 0 ? { hint: "No hay archivos indexados. Corré campus_index_course con el courseId de la materia." } : {}),
      });
    }),
  );

  server.registerTool(
    "campus_indexed_files",
    {
      title: "Listar archivos indexados",
      description: "Lista qué archivos ya están descargados e indexados localmente, con su ruta y cantidad de texto extraído.",
      inputSchema: { courseId: z.number().int().optional().describe("Limitar a una materia") },
      annotations: { readOnlyHint: true },
    },
    wrap(async ({ courseId }) => {
      const entries = await ctx.index.list(courseId);
      return ok(entries.map((e) => ({ courseId: e.courseId, course: e.courseName, section: e.sectionName, filename: e.filename, kind: e.kind, pages: e.pages, chars: e.chars, path: e.localPath, indexedAt: e.indexedAt, warning: e.warning })));
    }),
  );
}
