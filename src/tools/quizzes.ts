import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AppContext, ok, wrap } from "../context.js";
import * as api from "../moodle/api.js";
import { fmtDate, htmlToText, truncate } from "../util/text.js";
import { getContentsCached } from "./courses.js";

export function registerQuizTools(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    "campus_quizzes",
    {
      title: "Cuestionarios",
      description: "Lista los cuestionarios (quiz) de todas las materias o de una, con fechas de apertura/cierre, límite de tiempo y, si withAttempts=true, los intentos del usuario y su mejor nota.",
      inputSchema: {
        courseId: z.number().int().optional(),
        withAttempts: z.boolean().optional().describe("Consultar intentos y mejor nota (llamadas extra por cuestionario)"),
      },
      annotations: { readOnlyHint: true },
    },
    wrap(async ({ courseId, withAttempts }) => {
      const client = await ctx.getClient();
      const courses = courseId ? [{ id: courseId, fullname: await ctx.courseName(courseId) }] : await ctx.getCourses();
      const quizzes = await api.getQuizzes(client, courses.map((c) => c.id));
      const out = [];
      for (const q of quizzes) {
        let attempts: any[] | undefined;
        let best: any;
        if (withAttempts) {
          attempts = (await api.getQuizAttempts(client, q.id).catch(() => [])).map((a) => ({ attempt: a.attempt, state: a.state, started: fmtDate(a.timestart), finished: fmtDate(a.timefinish), sumgrades: a.sumgrades }));
          if (await ctx.hasFunction("mod_quiz_get_user_best_grade")) best = await api.getQuizBestGrade(client, q.id).catch(() => undefined);
        }
        out.push({
          quizId: q.id,
          cmid: q.coursemodule,
          courseId: q.course,
          course: courses.find((c) => c.id === q.course)?.fullname,
          name: q.name,
          intro: truncate(htmlToText(q.intro), 300) || undefined,
          opens: fmtDate(q.timeopen),
          closes: fmtDate(q.timeclose),
          timeLimitMin: q.timelimit ? Math.round(q.timelimit / 60) : null,
          attemptsAllowed: q.attempts === 0 ? "ilimitados" : q.attempts,
          maxGrade: q.grade,
          url: `${client.site}/mod/quiz/view.php?id=${q.coursemodule}`,
          ...(attempts ? { attempts } : {}),
          ...(best?.hasgrade ? { bestGrade: best.grade } : {}),
        });
      }
      return ok(out);
    }),
  );

  server.registerTool(
    "campus_scheduler",
    {
      title: "Turnos de consulta (scheduler)",
      description:
        "Lista las actividades de turnos (mod_scheduler) de las materias con su link. La API móvil de Moodle normalmente no expone este plugin; si está disponible devuelve los turnos reservados, si no, devuelve los links para que el usuario entre desde el navegador.",
      inputSchema: { courseId: z.number().int().optional() },
      annotations: { readOnlyHint: true },
    },
    wrap(async ({ courseId }) => {
      const client = await ctx.getClient();
      const courses = courseId ? [{ id: courseId, fullname: await ctx.courseName(courseId) }] : await ctx.getCourses();
      const modules = [];
      for (const c of courses) {
        const sections = await getContentsCached(ctx, c.id).catch(() => []);
        for (const s of sections) for (const m of s.modules) if (m.modname === "scheduler") modules.push({ courseId: c.id, course: c.fullname, cmid: m.id, name: m.name, url: m.url, description: truncate(htmlToText(m.description), 300) || undefined });
      }
      const info = await ctx.getSiteInfo();
      const schedFns = info.functions.map((f) => f.name).filter((n) => n.startsWith("mod_scheduler_"));
      let appointments: unknown;
      if (schedFns.includes("mod_scheduler_get_my_appointments")) {
        appointments = await client.call("mod_scheduler_get_my_appointments").catch((e) => ({ error: e.message }));
      }
      return ok({
        schedulers: modules,
        apiFunctions: schedFns,
        appointments: appointments ?? "La API no expone los turnos; usar los links en el navegador. (Fallback HTML pendiente, Fase 3.)",
      });
    }),
  );
}
