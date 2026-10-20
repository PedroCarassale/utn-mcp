import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AppContext, ok, wrap } from "../context.js";
import * as api from "../moodle/api.js";
import { TTL } from "../config.js";
import { fmtDate, isoDate, htmlToText, truncate } from "../util/text.js";

export function registerCalendarTools(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    "campus_upcoming",
    {
      title: "Próximas fechas",
      description:
        "Fechas próximas del campus: entregas de tareas, cierres de cuestionarios, parciales y eventos de calendario de todas las materias (o de una). " +
        "Combina los eventos accionables (con link a la actividad) y el calendario general. Con pastDays también muestra vencidos recientes.",
      inputSchema: {
        days: z.number().int().min(1).max(365).optional().describe("Cuántos días hacia adelante. Default 30"),
        pastDays: z.number().int().min(0).max(365).optional().describe("Cuántos días hacia atrás incluir (vencidos). Default 0"),
        courseId: z.number().int().optional().describe("Limitar a una materia"),
        refresh: z.boolean().optional().describe("Ignorar caché"),
      },
      annotations: { readOnlyHint: true },
    },
    wrap(async ({ days, pastDays, courseId, refresh }) => {
      const client = await ctx.getClient();
      const now = Math.floor(Date.now() / 1000);
      const from = now - (pastDays ?? 0) * 86400;
      const to = now + (days ?? 30) * 86400;
      const courseIds = courseId ? [courseId] : (await ctx.getCourses()).map((c) => c.id);

      const [action, calendar] = await Promise.all([
        ctx.cache.getOrFetch(`action:${from}:${to}`, TTL.calendar, () => api.getActionEvents(client, from, to, 100), Boolean(refresh)).catch(() => []),
        ctx.cache.getOrFetch(`calendar:${courseIds.join(",")}:${from}:${to}`, TTL.calendar, () => api.getCalendarEvents(client, courseIds, from, to), Boolean(refresh)).catch(() => []),
      ]);

      const seen = new Set<number>();
      const events: any[] = [];
      for (const e of action) {
        if (courseId && e.course?.id !== courseId) continue;
        seen.add(e.id);
        events.push({
          id: e.id,
          when: fmtDate(e.timesort || e.timestart),
          whenIso: isoDate(e.timesort || e.timestart),
          ts: e.timesort || e.timestart,
          name: e.name,
          activity: e.activityname,
          type: e.modulename ?? e.eventtype,
          courseId: e.course?.id,
          course: e.course?.fullname,
          action: e.action?.name,
          url: e.action?.url ?? e.url,
          overdue: (e.timesort || e.timestart) < now,
          description: truncate(htmlToText(e.description), 200) || undefined,
        });
      }
      for (const e of calendar) {
        if (seen.has(e.id)) continue;
        events.push({
          id: e.id,
          when: fmtDate(e.timestart),
          whenIso: isoDate(e.timestart),
          ts: e.timestart,
          name: e.name,
          type: e.modulename || e.eventtype,
          courseId: e.courseid || undefined,
          course: e.courseid ? await ctx.courseName(e.courseid) : undefined,
          durationMin: e.timeduration ? Math.round(e.timeduration / 60) : undefined,
          overdue: e.timestart < now,
          description: truncate(htmlToText(e.description), 200) || undefined,
        });
      }
      events.sort((a, b) => a.ts - b.ts);
      for (const e of events) delete e.ts;
      return ok({ from: fmtDate(from), to: fmtDate(to), count: events.length, events });
    }),
  );
}
