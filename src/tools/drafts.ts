import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import { AppContext, ok, fail, wrap } from "../context.js";
import * as api from "../moodle/api.js";
import type { Draft } from "../store/drafts.js";
import { fmtBytes, fmtDate, htmlToText, safeFilename } from "../util/text.js";
import { CONFIRM_DESCRIPTION, needsConfirmation } from "./confirm.js";
import { fileTypeAllowed, findAssignment, saveAndSubmit, submissionRules, type SubmissionFile } from "./assignments.js";

function expandHome(p: string): string {
  return p === "~" || p.startsWith("~/") ? join(homedir(), p.slice(1)) : p;
}

function describeDraft(d: Draft) {
  return {
    assignmentId: d.assignmentId,
    assignment: d.assignment,
    course: d.course,
    files: d.files.map((f) => ({ name: f.name, size: fmtBytes(f.bytes), source: f.source, added: fmtDate(Date.parse(f.addedAt) / 1000) })),
    totalSize: fmtBytes(d.files.reduce((n, f) => n + f.bytes, 0)),
    onlineText: d.onlineText ? `${d.onlineText.slice(0, 200)}${d.onlineText.length > 200 ? "…" : ""}` : undefined,
    updated: fmtDate(Date.parse(d.updatedAt) / 1000),
  };
}

/** Archivos ya entregados en el campus para la tarea. */
function submittedFiles(status: any): { filename: string; fileurl: string; filesize: number }[] {
  return (status?.lastattempt?.submission?.plugins ?? [])
    .filter((p: any) => p.type === "file")
    .flatMap((p: any) => p.fileareas ?? [])
    .flatMap((fa: any) => fa.files ?? []);
}

export function registerDraftTools(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    "campus_draft_add",
    {
      title: "Agregar archivos a una entrega",
      description:
        "Arma localmente una entrega para una tarea, sin tocar el campus: copia los archivos indicados por el usuario a un borrador y/o guarda el texto en línea. " +
        "Se puede llamar varias veces para ir sumando archivos; un archivo con el mismo nombre reemplaza al anterior. " +
        "Valida contra la configuración de la tarea (si acepta archivos, cantidad máxima, tamaño y tipos). " +
        "Cuando el usuario diga que está lista, subila con campus_draft_submit.",
      inputSchema: {
        assignmentId: z.number().int().describe("Id de la tarea (assignmentId de campus_assignments, no el cmid)"),
        filePaths: z.array(z.string()).optional().describe("Rutas absolutas de los archivos a agregar (se admite ~)"),
        onlineText: z.string().optional().describe("Texto en línea de la entrega (HTML o texto plano). Reemplaza el que hubiera en el borrador"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    wrap(async ({ assignmentId, filePaths, onlineText }) => {
      if (!filePaths?.length && onlineText === undefined) return fail("Indicá filePaths y/o onlineText.");
      const found = await findAssignment(ctx, assignmentId);
      if (!found) return fail(`No encontré la tarea ${assignmentId} en tus materias. Usá campus_assignments para ver los ids.`);
      const rules = submissionRules(found.assignment);

      // Validar todo antes de copiar nada, para no dejar el borrador a medias.
      const sources: { path: string; name: string; bytes: number }[] = [];
      for (const raw of filePaths ?? []) {
        const path = expandHome(raw);
        if (!isAbsolute(path)) return fail(`"${raw}" no es una ruta absoluta.`);
        const st = await stat(path).catch(() => null);
        if (!st) return fail(`No existe el archivo ${path}.`);
        if (!st.isFile()) return fail(`${path} no es un archivo. Si es una carpeta, comprimila o indicá los archivos uno por uno.`);
        sources.push({ path, name: safeFilename(basename(path)), bytes: st.size });
      }
      if (rules && sources.length && !rules.files) return fail(`La tarea "${found.assignment.name}" no acepta archivos, solo texto en línea.`);
      if (rules && onlineText && !rules.onlineText) return fail(`La tarea "${found.assignment.name}" no acepta texto en línea.`);

      const warnings: string[] = [];
      if (!rules) warnings.push("Moodle no devolvió la configuración de la tarea: no se pudo validar cantidad, tamaño ni tipos de archivo.");
      for (const s of sources) {
        if (rules?.maxBytes && s.bytes > rules.maxBytes) {
          return fail(`${s.name} pesa ${fmtBytes(s.bytes)} y la tarea acepta hasta ${fmtBytes(rules.maxBytes)} por archivo.`);
        }
        const allowed = rules ? fileTypeAllowed(rules, s.name) : "yes";
        if (allowed === "no") return fail(`La tarea no acepta ${s.name}. Tipos permitidos: ${rules!.fileTypes.join(", ")}.`);
        if (allowed === "unknown") warnings.push(`No pude verificar si ${s.name} es de un tipo aceptado (${rules!.fileTypes.join(", ")}).`);
      }

      const existing = await ctx.drafts.get(assignmentId);
      const names = new Set([...(existing?.files.map((f) => f.name) ?? []), ...sources.map((s) => s.name)]);
      if (rules?.maxFiles && names.size > rules.maxFiles) {
        return fail(`La tarea acepta hasta ${rules.maxFiles} archivo(s) y el borrador quedaría con ${names.size}.`);
      }

      const now = new Date().toISOString();
      const draft: Draft = existing ?? {
        assignmentId,
        assignment: found.assignment.name,
        courseId: found.courseId,
        course: found.course,
        files: [],
        createdAt: now,
        updatedAt: now,
      };
      for (const s of sources) {
        const { replaced } = await ctx.drafts.addFile(draft, s.path, s.name);
        if (replaced) warnings.push(`Reemplacé ${s.name}, que ya estaba en el borrador.`);
      }
      if (onlineText !== undefined) draft.onlineText = onlineText || undefined;
      await ctx.drafts.save(draft);
      await ctx.log(`draft add assignment=${assignmentId} files=${sources.length} text=${onlineText !== undefined}`);
      return ok({ draft: describeDraft(draft), warnings: warnings.length ? warnings : undefined });
    }),
  );

  server.registerTool(
    "campus_draft_show",
    {
      title: "Ver entregas en preparación",
      description: "Muestra los borradores locales de entregas: tarea, archivos, tamaños y texto. Sin assignmentId lista todos.",
      inputSchema: {
        assignmentId: z.number().int().optional().describe("Ver solo el borrador de esta tarea"),
      },
      annotations: { readOnlyHint: true },
    },
    wrap(async ({ assignmentId }) => {
      if (assignmentId !== undefined) {
        const d = await ctx.drafts.get(assignmentId);
        return d ? ok(describeDraft(d)) : fail(`No hay un borrador para la tarea ${assignmentId}.`);
      }
      const all = await ctx.drafts.list();
      return ok(all.length ? all.map(describeDraft) : "No hay entregas en preparación.");
    }),
  );

  server.registerTool(
    "campus_draft_remove",
    {
      title: "Quitar archivos de una entrega",
      description:
        "Quita archivos o el texto de un borrador local de entrega, o lo descarta entero si no se indica qué quitar. No toca el campus.",
      inputSchema: {
        assignmentId: z.number().int().describe("Id de la tarea"),
        fileNames: z.array(z.string()).optional().describe("Nombres de archivo a quitar (como aparecen en campus_draft_show)"),
        removeText: z.boolean().optional().describe("Quitar el texto en línea"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    wrap(async ({ assignmentId, fileNames, removeText }) => {
      const d = await ctx.drafts.get(assignmentId);
      if (!d) return fail(`No hay un borrador para la tarea ${assignmentId}.`);
      if (!fileNames?.length && !removeText) {
        await ctx.drafts.discard(assignmentId);
        await ctx.log(`draft discard assignment=${assignmentId}`);
        return ok({ discarded: true, assignmentId });
      }
      const missing = [];
      for (const name of fileNames ?? []) {
        if (!(await ctx.drafts.removeFile(d, name))) missing.push(name);
      }
      if (removeText) d.onlineText = undefined;
      await ctx.drafts.save(d);
      return ok({ draft: describeDraft(d), notFound: missing.length ? missing : undefined });
    }),
  );

  server.registerTool(
    "campus_draft_submit",
    {
      title: "Subir una entrega preparada",
      description:
        "ACCIÓN DE ESCRITURA. Sube al campus el borrador armado con campus_draft_add y opcionalmente lo envía para calificación. " +
        "Moodle reemplaza los archivos ya entregados por los del borrador; con keepExisting=true se conservan los que ya estaban. " +
        "Sin confirm devuelve una vista previa (tarea, archivos, texto, qué se reemplaza, fechas) que tenés que mostrarle al usuario antes de pedir su confirmación explícita. " +
        "Si sale bien, el borrador local se borra.",
      inputSchema: {
        assignmentId: z.number().int().describe("Id de la tarea"),
        keepExisting: z.boolean().optional().describe("Conservar los archivos ya entregados en el campus además de los del borrador. Default false"),
        submitForGrading: z.boolean().optional().describe("Enviar para calificación después de guardar (irreversible si la tarea no permite reabrir). Default false"),
        confirm: z.boolean().optional().describe(CONFIRM_DESCRIPTION),
      },
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    wrap(async ({ assignmentId, keepExisting, submitForGrading, confirm }) => {
      const d = await ctx.drafts.get(assignmentId);
      if (!d) return fail(`No hay un borrador para la tarea ${assignmentId}. Armalo con campus_draft_add.`);
      if (!d.files.length && !d.onlineText) return fail("El borrador está vacío.");

      const client = await ctx.getClient();
      const found = await findAssignment(ctx, assignmentId);
      const status = await api.getSubmissionStatus(client, assignmentId).catch(() => null);
      const draftNames = new Set(d.files.map((f) => f.name));
      const current = submittedFiles(status);
      const kept = keepExisting ? current.filter((f) => !draftNames.has(f.filename)) : [];

      const notes: string[] = [];
      const now = Date.now() / 1000;
      const a = found?.assignment;
      if (a?.cutoffdate && a.cutoffdate < now) notes.push(`La fecha límite (${fmtDate(a.cutoffdate)}) ya pasó: Moodle probablemente rechace la entrega.`);
      else if (a?.duedate && a.duedate < now) notes.push(`La fecha de entrega (${fmtDate(a.duedate)}) ya pasó: se va a registrar como tardía.`);
      if (status?.lastattempt?.canedit === false) notes.push("Moodle indica que la entrega no se puede editar.");
      if (d.files.length && current.length && !keepExisting) {
        notes.push(`Se van a reemplazar los archivos ya entregados: ${current.map((f) => f.filename).join(", ")}.`);
      }
      const rules = a ? submissionRules(a) : null;
      if (rules?.maxFiles && d.files.length + kept.length > rules.maxFiles) {
        return fail(`La tarea acepta hasta ${rules.maxFiles} archivo(s) y se subirían ${d.files.length + kept.length}.`);
      }

      const pending = needsConfirmation(confirm, {
        action: "campus_draft_submit",
        assignmentId,
        assignment: d.assignment,
        course: d.course,
        due: fmtDate(a?.duedate),
        files: d.files.map((f) => `${f.name} (${fmtBytes(f.bytes)})`),
        keptFromCampus: kept.length ? kept.map((f) => f.filename) : undefined,
        onlineText: d.onlineText ? htmlToText(d.onlineText).slice(0, 300) : null,
        currentStatus: status?.lastattempt?.submission?.status ?? "none",
        submitForGrading: Boolean(submitForGrading),
        notes: notes.length ? notes : undefined,
      });
      if (pending) return pending;

      const files: SubmissionFile[] = [];
      for (const f of kept) files.push({ name: f.filename, data: (await client.download(f.fileurl)).bytes });
      for (const f of d.files) files.push({ name: f.name, data: await ctx.drafts.readFile(assignmentId, f.name) });
      const result = await saveAndSubmit(ctx, assignmentId, files, d.onlineText, Boolean(submitForGrading));
      await ctx.drafts.discard(assignmentId);
      return ok({ ...result, draftDiscarded: true });
    }),
  );
}
