import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AppContext, ok, fail, wrap } from "../context.js";
import * as api from "../moodle/api.js";
import type { CourseModule, CourseSection } from "../moodle/types.js";
import { TTL } from "../config.js";
import { fmtDate, isoDate, fmtBytes, htmlToText, truncate } from "../util/text.js";

export function summarizeModule(m: CourseModule, verbose = false) {
  const files = (m.contents ?? [])
    .filter((c) => c.type === "file")
    .map((c) => ({
      filename: c.filename,
      size: fmtBytes(c.filesize),
      bytes: c.filesize,
      mimetype: c.mimetype,
      modified: fmtDate(c.timemodified),
      fileurl: c.fileurl,
    }));
  const urls = (m.contents ?? []).filter((c) => c.type === "url").map((c) => c.fileurl);
  const desc = htmlToText(m.description);
  return {
    cmid: m.id,
    name: m.name,
    type: m.modname,
    url: m.url,
    ...(m.uservisible === false ? { restricted: true, availability: htmlToText(m.availabilityinfo) } : {}),
    ...(m.visible === 0 ? { hidden: true } : {}),
    ...(desc ? { description: verbose ? desc : truncate(desc, 300) } : {}),
    ...(m.dates?.length ? { dates: m.dates.map((d) => ({ label: d.label.trim(), date: fmtDate(d.timestamp), iso: isoDate(d.timestamp) })) } : {}),
    ...(files.length ? { files } : {}),
    ...(urls.length ? { links: urls } : {}),
  };
}

export async function getContentsCached(ctx: AppContext, courseId: number, force = false): Promise<CourseSection[]> {
  const client = await ctx.getClient();
  return ctx.cache.getOrFetch(`contents:${courseId}`, TTL.contents, () => api.getCourseContents(client, courseId), force);
}

export function registerCourseTools(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    "campus_list_courses",
    {
      title: "Listar materias",
      description:
        "Lista las materias/cursos en los que el usuario está inscripto en el campus. Devuelve id, nombre, nombre corto, fechas, progreso y último acceso. " +
        "Usá el `id` para el resto de las tools. Por defecto trae todas; con classification podés filtrar las en curso.",
      inputSchema: {
        classification: z.enum(["all", "inprogress", "past", "future"]).optional().describe("Filtro por línea de tiempo. Default: all"),
        refresh: z.boolean().optional().describe("Ignorar caché"),
      },
      annotations: { readOnlyHint: true },
    },
    wrap(async ({ classification, refresh }) => {
      const client = await ctx.getClient();
      let courses;
      if (classification && classification !== "all" && (await ctx.hasFunction("core_course_get_enrolled_courses_by_timeline_classification"))) {
        courses = await ctx.cache.getOrFetch(`courses:${classification}`, TTL.courses, () => api.getCoursesByClassification(client, classification), Boolean(refresh));
      } else {
        courses = await ctx.getCourses(Boolean(refresh));
      }
      return ok(
        courses.map((c) => ({
          id: c.id,
          name: c.fullname,
          shortname: c.shortname,
          category: c.coursecategory,
          start: fmtDate(c.startdate),
          end: fmtDate(c.enddate),
          lastAccess: fmtDate(c.lastaccess),
          progress: c.progress ?? null,
          hidden: c.hidden ?? c.visible === 0,
          url: `${client.site}/course/view.php?id=${c.id}`,
        })),
      );
    }),
  );

  server.registerTool(
    "campus_course_contents",
    {
      title: "Contenido de una materia",
      description:
        "Devuelve las secciones (unidades) de una materia con sus módulos: apuntes (resource/folder), tareas (assign), foros, cuestionarios, páginas, URLs, etc. " +
        "Cada archivo trae `fileurl`, que se pasa a campus_get_file para leerlo. Cada módulo trae `cmid`, que se pasa a campus_module para ver detalles.",
      inputSchema: {
        courseId: z.number().int().describe("Id de la materia (de campus_list_courses)"),
        types: z.array(z.string()).optional().describe("Filtrar por tipo de módulo, p. ej. ['resource','folder','assign']"),
        search: z.string().optional().describe("Filtrar módulos cuyo nombre contenga este texto"),
        verbose: z.boolean().optional().describe("Incluir descripciones completas"),
        refresh: z.boolean().optional().describe("Ignorar caché"),
      },
      annotations: { readOnlyHint: true },
    },
    wrap(async ({ courseId, types, search, verbose, refresh }) => {
      const sections = await getContentsCached(ctx, courseId, Boolean(refresh));
      const q = search?.toLowerCase();
      const out = sections
        .map((s) => {
          let modules = s.modules;
          if (types?.length) modules = modules.filter((m) => types.includes(m.modname));
          if (q) modules = modules.filter((m) => m.name.toLowerCase().includes(q));
          const summary = htmlToText(s.summary);
          return {
            sectionId: s.id,
            section: s.name,
            ...(s.visible === 0 ? { hidden: true } : {}),
            ...(summary ? { summary: verbose ? summary : truncate(summary, 300) } : {}),
            modules: modules.map((m) => summarizeModule(m, Boolean(verbose))),
          };
        })
        .filter((s) => s.modules.length > 0 || (!types && !q));
      return ok({ courseId, course: await ctx.courseName(courseId), sections: out });
    }),
  );

  server.registerTool(
    "campus_module",
    {
      title: "Detalle de un módulo",
      description:
        "Detalle de un módulo por `cmid`: para una página devuelve su contenido en texto, para una tarea su consigna, fechas y estado de entrega, " +
        "para un recurso/carpeta sus archivos, para un foro sus últimas discusiones, para un cuestionario sus intentos, para una URL el link externo.",
      inputSchema: { cmid: z.number().int().describe("Id del módulo (course module id)") },
      annotations: { readOnlyHint: true },
    },
    wrap(async ({ cmid }) => {
      const client = await ctx.getClient();
      const cm = await api.getCourseModule(client, cmid);
      const sections = await getContentsCached(ctx, cm.course);
      const raw = sections.flatMap((s) => s.modules.map((m) => ({ m, section: s.name }))).find((x) => x.m.id === cmid);
      const base = {
        ...(raw ? summarizeModule(raw.m, true) : { cmid, name: cm.name, type: cm.modname }),
        courseId: cm.course,
        course: await ctx.courseName(cm.course),
        section: raw?.section,
      };

      switch (cm.modname) {
        case "page": {
          const pages = await api.getPages(client, [cm.course]);
          const page = pages.find((p) => p.coursemodule === cmid);
          return ok({
            ...base,
            content: htmlToText(page?.content),
            files: page?.contentfiles?.map((f) => ({ filename: f.filename, fileurl: f.fileurl, size: fmtBytes(f.filesize) })),
          });
        }
        case "url": {
          if (await ctx.hasFunction("mod_url_get_urls_by_courses")) {
            const urls = await api.getUrls(client, [cm.course]);
            const u = urls.find((x) => x.coursemodule === cmid);
            return ok({ ...base, externalUrl: u?.externalurl, intro: htmlToText(u?.intro) });
          }
          return ok(base);
        }
        case "assign": {
          const courses = await api.getAssignments(client, [cm.course]);
          const a = courses[0]?.assignments.find((x) => x.cmid === cmid);
          if (!a) return ok(base);
          let status: any = null;
          if (await ctx.hasFunction("mod_assign_get_submission_status")) {
            status = await api.getSubmissionStatus(client, a.id).catch(() => null);
          }
          return ok({ ...base, assignment: describeAssignment(a, status) });
        }
        case "forum": {
          const forums = await api.getForums(client, [cm.course]);
          const f = forums.find((x) => x.cmid === cmid);
          if (!f) return ok(base);
          const discussions = await api.getForumDiscussions(client, f.id, 0, 10);
          return ok({
            ...base,
            forumId: f.id,
            forumType: f.type,
            discussions: discussions.map((d) => ({
              discussionId: d.discussion,
              subject: d.subject,
              author: d.userfullname,
              date: fmtDate(d.created),
              replies: d.numreplies,
              preview: truncate(htmlToText(d.message), 300),
            })),
          });
        }
        case "quiz": {
          const quizzes = await api.getQuizzes(client, [cm.course]);
          const qz = quizzes.find((x) => x.coursemodule === cmid);
          if (!qz) return ok(base);
          const attempts = await api.getQuizAttempts(client, qz.id).catch(() => []);
          return ok({
            ...base,
            quizId: qz.id,
            opens: fmtDate(qz.timeopen),
            closes: fmtDate(qz.timeclose),
            timeLimitMin: qz.timelimit ? Math.round(qz.timelimit / 60) : null,
            maxGrade: qz.grade,
            attempts: attempts.map((at) => ({ attempt: at.attempt, state: at.state, started: fmtDate(at.timestart), finished: fmtDate(at.timefinish), sumgrades: at.sumgrades })),
          });
        }
        default:
          return raw ? ok(base) : fail(`No encontré el módulo ${cmid} en el contenido del curso ${cm.course}.`);
      }
    }),
  );
}

export function describeAssignment(a: import("../moodle/types.js").Assignment, status: any) {
  const now = Date.now() / 1000;
  const last = status?.lastattempt;
  const sub = last?.submission;
  const grade = status?.feedback?.grade;
  return {
    assignmentId: a.id,
    cmid: a.cmid,
    name: a.name,
    intro: htmlToText(a.intro),
    attachments: a.introattachments?.map((f) => ({ filename: f.filename, fileurl: f.fileurl, size: fmtBytes(f.filesize) })),
    opens: fmtDate(a.allowsubmissionsfromdate),
    due: fmtDate(a.duedate),
    dueIso: isoDate(a.duedate),
    cutoff: fmtDate(a.cutoffdate),
    overdue: Boolean(a.duedate && a.duedate < now && sub?.status !== "submitted"),
    maxGrade: a.grade,
    teamSubmission: Boolean(a.teamsubmission),
    ...(status
      ? {
          submission: {
            status: sub?.status ?? "none",
            gradingStatus: last?.gradingstatus,
            submittedAt: fmtDate(sub?.timemodified),
            canSubmit: last?.cansubmit,
            canEdit: last?.canedit,
            extensionDue: fmtDate(last?.extensionduedate),
            files: (sub?.plugins ?? [])
              .flatMap((p: any) => p.fileareas ?? [])
              .flatMap((fa: any) => fa.files ?? [])
              .map((f: any) => ({ filename: f.filename, fileurl: f.fileurl, size: fmtBytes(f.filesize) })),
            onlineText: htmlToText((sub?.plugins ?? []).flatMap((p: any) => p.editorfields ?? []).map((e: any) => e.text).join("\n")) || undefined,
          },
          grade: grade
            ? {
                grade: status.feedback?.gradefordisplay ? htmlToText(status.feedback.gradefordisplay) : grade.grade,
                gradedAt: fmtDate(grade.timemodified),
                feedback: htmlToText((status.feedback?.plugins ?? []).flatMap((p: any) => p.editorfields ?? []).map((e: any) => e.text).join("\n")) || undefined,
              }
            : null,
        }
      : {}),
  };
}
