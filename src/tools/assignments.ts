import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Assignment } from "../moodle/types.js";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { AppContext, ok, fail, wrap } from "../context.js";
import * as api from "../moodle/api.js";
import { describeAssignment } from "./courses.js";
import { fmtDate } from "../util/text.js";
import { TTL } from "../config.js";
import { CONFIRM_DESCRIPTION, needsConfirmation } from "./confirm.js";

export function registerAssignmentTools(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    "campus_assignments",
    {
      title: "Tareas y entregas",
      description:
        "Lista las tareas (assign) de todas las materias o de una, con fecha de entrega, consigna y, si withStatus=true, el estado de entrega y la nota de cada una. " +
        "onlyPending=true deja solo las no entregadas con fecha futura o sin fecha.",
      inputSchema: {
        courseId: z.number().int().optional().describe("Limitar a una materia"),
        withStatus: z.boolean().optional().describe("Consultar estado de entrega y nota (una llamada extra por tarea)"),
        onlyPending: z.boolean().optional().describe("Solo tareas pendientes (implica withStatus)"),
      },
      annotations: { readOnlyHint: true },
    },
    wrap(async ({ courseId, withStatus, onlyPending }) => {
      const client = await ctx.getClient();
      const courseIds = courseId ? [courseId] : [];
      const courses = await api.getAssignments(client, courseIds);
      const wantStatus = Boolean(withStatus || onlyPending) && (await ctx.hasFunction("mod_assign_get_submission_status"));
      const now = Date.now() / 1000;
      const out = [];
      for (const c of courses) {
        const items = [];
        for (const a of c.assignments) {
          const status = wantStatus ? await api.getSubmissionStatus(client, a.id).catch(() => null) : null;
          const d = describeAssignment(a, status);
          if (onlyPending) {
            const submitted = d.submission?.status === "submitted";
            const closed = a.cutoffdate && a.cutoffdate < now;
            if (submitted || closed) continue;
          }
          items.push(d);
        }
        if (items.length) out.push({ courseId: c.id, course: c.fullname, assignments: items });
      }
      return ok(out);
    }),
  );

  server.registerTool(
    "campus_submit_assignment",
    {
      title: "Entregar una tarea",
      description:
        "ACCIÓN DE ESCRITURA. Sube archivos y/o texto en línea a una tarea y opcionalmente la envía para calificación. " +
        "Antes de llamar con confirm=true tenés que mostrarle al usuario qué tarea, qué archivos y qué texto se van a entregar, y obtener su confirmación explícita. " +
        "Sin confirm devuelve una vista previa sin ejecutar nada.",
      inputSchema: {
        assignmentId: z.number().int().describe("Id de la tarea (assignmentId de campus_assignments, no el cmid)"),
        filePaths: z.array(z.string()).optional().describe("Rutas locales de los archivos a subir"),
        onlineText: z.string().optional().describe("Texto en línea (HTML o texto plano)"),
        submitForGrading: z.boolean().optional().describe("Enviar para calificación después de guardar (irreversible si la tarea no permite reabrir). Default false"),
        confirm: z.boolean().optional().describe(CONFIRM_DESCRIPTION),
      },
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    wrap(async ({ assignmentId, filePaths, onlineText, submitForGrading, confirm }) => {
      if (!filePaths?.length && !onlineText) return fail("Indicá filePaths y/o onlineText.");
      const preview = {
        action: "campus_submit_assignment",
        assignmentId,
        files: filePaths ?? [],
        onlineText: onlineText ? `${onlineText.slice(0, 200)}${onlineText.length > 200 ? "…" : ""}` : null,
        submitForGrading: Boolean(submitForGrading),
      };
      const pending = needsConfirmation(confirm, preview);
      if (pending) return pending;
      const files = [];
      for (const p of filePaths ?? []) files.push({ name: basename(p), data: await readFile(p) });
      return ok(await saveAndSubmit(ctx, assignmentId, files, onlineText, Boolean(submitForGrading)));
    }),
  );
}

export interface SubmissionFile {
  name: string;
  data: Uint8Array;
}

/**
 * Sube los archivos al área borrador del usuario, guarda la entrega y opcionalmente la envía para calificación.
 * Moodle reemplaza con estos archivos los que ya estaban entregados.
 */
export async function saveAndSubmit(
  ctx: AppContext,
  assignmentId: number,
  files: SubmissionFile[],
  onlineText: string | undefined,
  submitForGrading: boolean,
) {
  const client = await ctx.getClient();
  const userid = await ctx.getUserId();

  const plugindata: Record<string, unknown> = {};
  const uploaded: string[] = [];
  if (files.length) {
    let itemid = 0;
    for (const f of files) {
      const r = await api.uploadDraftFile(client, userid, f.name, Buffer.from(f.data).toString("base64"), itemid);
      itemid = r.itemid;
      uploaded.push(r.filename);
    }
    plugindata.files_filemanager = itemid;
  }
  if (onlineText) {
    plugindata.onlinetext_editor = { text: onlineText, format: 1, itemid: 0 };
  }
  const warnings = await api.saveSubmission(client, assignmentId, plugindata);
  let submitted = false;
  if (submitForGrading) {
    await api.submitForGrading(client, assignmentId);
    submitted = true;
  }
  await ctx.log(`submit assignment=${assignmentId} files=${uploaded.length} text=${Boolean(onlineText)} graded=${submitted}`);
  const status = await api.getSubmissionStatus(client, assignmentId).catch(() => null);
  return {
    ok: true,
    uploaded,
    submittedForGrading: submitted,
    warnings: warnings?.length ? warnings : undefined,
    status: status?.lastattempt?.submission?.status,
    modified: fmtDate(status?.lastattempt?.submission?.timemodified),
  };
}

/** Busca una tarea por id entre todas las materias del usuario. */
export async function findAssignment(ctx: AppContext, assignmentId: number) {
  const client = await ctx.getClient();
  const courses = await ctx.cache.getOrFetch("assignments:all", TTL.contents, () => api.getAssignments(client, []));
  for (const c of courses) {
    const a = c.assignments.find((x) => x.id === assignmentId);
    if (a) return { assignment: a, courseId: c.id, course: c.fullname };
  }
  return null;
}

export interface SubmissionRules {
  files: boolean;
  maxFiles: number | null;
  maxBytes: number | null;
  fileTypes: string[];
  onlineText: boolean;
  wordLimit: number | null;
}

/** Qué acepta la tarea, según los plugins de entrega configurados. null si Moodle no devolvió la configuración. */
export function submissionRules(a: Assignment): SubmissionRules | null {
  if (!a.configs?.length) return null;
  const cfg = (plugin: string, name: string) =>
    a.configs?.find((c) => c.subtype === "assignsubmission" && c.plugin === plugin && c.name === name)?.value;
  return {
    files: cfg("file", "enabled") === "1",
    maxFiles: Number(cfg("file", "maxfilesubmissions") ?? 0) || null,
    maxBytes: Number(cfg("file", "maxsubmissionsizebytes") ?? 0) || null,
    fileTypes: (cfg("file", "filetypeslist") ?? "").split(/[\s,;]+/).filter(Boolean),
    onlineText: cfg("onlinetext", "enabled") === "1",
    wordLimit: cfg("onlinetext", "wordlimitenabled") === "1" ? Number(cfg("onlinetext", "wordlimit")) || null : null,
  };
}

/**
 * Verifica la extensión contra la lista de tipos aceptados.
 * La lista puede traer grupos ("document") o tipos MIME que no se pueden resolver acá: en ese caso devuelve "unknown".
 */
export function fileTypeAllowed(rules: SubmissionRules, filename: string): "yes" | "no" | "unknown" {
  if (!rules.fileTypes.length || rules.fileTypes.includes("*")) return "yes";
  const ext = filename.includes(".") ? `.${filename.split(".").pop()!.toLowerCase()}` : "";
  const exts = rules.fileTypes.filter((t) => t.startsWith(".")).map((t) => t.toLowerCase());
  if (ext && exts.includes(ext)) return "yes";
  return exts.length === rules.fileTypes.length ? "no" : "unknown";
}
