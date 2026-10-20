import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AppContext, ok, wrap } from "../context.js";
import * as api from "../moodle/api.js";
import { TTL } from "../config.js";
import { fmtDate, htmlToText } from "../util/text.js";

export function registerGradeTools(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    "campus_grades",
    {
      title: "Notas",
      description:
        "Sin courseId: nota final/total de cada materia. Con courseId: todos los ítems de calificación de esa materia (tareas, cuestionarios, parciales cargados) con nota, rango, porcentaje y feedback.",
      inputSchema: {
        courseId: z.number().int().optional().describe("Id de la materia para ver el detalle"),
        refresh: z.boolean().optional().describe("Ignorar caché"),
      },
      annotations: { readOnlyHint: true },
    },
    wrap(async ({ courseId, refresh }) => {
      const client = await ctx.getClient();
      const userid = await ctx.getUserId();
      if (courseId) {
        const items = await ctx.cache.getOrFetch(`grades:${courseId}:${userid}`, TTL.grades, () => api.getUserGradeItems(client, courseId, userid), Boolean(refresh));
        return ok({
          courseId,
          course: await ctx.courseName(courseId),
          items: items.map((g) => ({
            item: g.itemname ?? (g.itemtype === "course" ? "TOTAL DEL CURSO" : g.itemtype),
            type: g.itemmodule ?? g.itemtype,
            cmid: g.cmid,
            grade: g.gradeformatted,
            raw: g.graderaw,
            range: g.rangeformatted,
            percentage: g.percentageformatted,
            weight: g.weightformatted,
            gradedAt: fmtDate(g.gradedategraded),
            feedback: htmlToText(g.feedback) || undefined,
          })),
        });
      }
      const grades = await ctx.cache.getOrFetch(`grades:overview:${userid}`, TTL.grades, () => api.getOverviewGrades(client, userid), Boolean(refresh));
      const courses = await ctx.getCourses();
      return ok(
        grades.map((g) => ({
          courseId: g.courseid,
          course: courses.find((c) => c.id === g.courseid)?.fullname ?? `Curso ${g.courseid}`,
          grade: g.grade,
          raw: g.rawgrade,
        })),
      );
    }),
  );
}
