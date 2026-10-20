import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AppContext, ok, fail, wrap } from "../context.js";
import * as api from "../moodle/api.js";
import { fmtDate, fmtBytes, htmlToText, truncate } from "../util/text.js";
import { CONFIRM_DESCRIPTION, needsConfirmation } from "./confirm.js";

export function registerForumTools(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    "campus_announcements",
    {
      title: "Novedades y foros",
      description:
        "Últimas publicaciones del foro de Avisos/Novedades de cada materia (lo que la cátedra anuncia). Con allForums=true incluye todos los foros, no solo el de novedades. " +
        "Devuelve discussionId para leer el hilo completo con campus_forum_discussion.",
      inputSchema: {
        courseId: z.number().int().optional().describe("Limitar a una materia"),
        limit: z.number().int().min(1).max(50).optional().describe("Discusiones por foro. Default 5"),
        allForums: z.boolean().optional().describe("Incluir foros que no son de novedades"),
        sinceDays: z.number().int().min(1).optional().describe("Solo publicaciones de los últimos N días"),
      },
      annotations: { readOnlyHint: true },
    },
    wrap(async ({ courseId, limit, allForums, sinceDays }) => {
      const client = await ctx.getClient();
      const courses = courseId ? [{ id: courseId, fullname: await ctx.courseName(courseId) }] : await ctx.getCourses();
      const forums = await api.getForums(client, courses.map((c) => c.id));
      const since = sinceDays ? Date.now() / 1000 - sinceDays * 86400 : 0;
      const out = [];
      for (const f of forums) {
        if (!allForums && f.type !== "news") continue;
        const discussions = await api.getForumDiscussions(client, f.id, 0, limit ?? 5).catch(() => []);
        const rows = discussions
          .filter((d) => d.timemodified >= since)
          .map((d) => ({
            discussionId: d.discussion,
            subject: d.subject,
            author: d.userfullname,
            date: fmtDate(d.created),
            replies: d.numreplies,
            pinned: d.pinned || undefined,
            message: truncate(htmlToText(d.message), 800),
            attachments: d.attachments?.map((a) => ({ filename: a.filename, fileurl: a.fileurl, size: fmtBytes(a.filesize) })),
          }));
        if (rows.length === 0 && since) continue;
        out.push({
          courseId: f.course,
          course: courses.find((c) => c.id === f.course)?.fullname,
          forumId: f.id,
          forum: f.name,
          type: f.type,
          cmid: f.cmid,
          discussions: rows,
        });
      }
      return ok(out);
    }),
  );

  server.registerTool(
    "campus_forum_discussion",
    {
      title: "Leer un hilo de foro",
      description: "Devuelve todos los mensajes de una discusión de foro (discussionId) en orden cronológico, con autor, fecha y adjuntos.",
      inputSchema: { discussionId: z.number().int().describe("Id de la discusión") },
      annotations: { readOnlyHint: true },
    },
    wrap(async ({ discussionId }) => {
      const client = await ctx.getClient();
      const posts = await api.getDiscussionPosts(client, discussionId);
      return ok(
        posts.map((p) => ({
          postId: p.id,
          subject: p.subject,
          author: p.author?.fullname,
          date: fmtDate(p.timecreated),
          replyTo: p.parentid ?? null,
          message: htmlToText(p.message),
          attachments: p.attachments?.map((a) => ({ filename: a.filename, fileurl: a.fileurl, size: fmtBytes(a.filesize) })),
        })),
      );
    }),
  );

  server.registerTool(
    "campus_forum_post",
    {
      title: "Publicar en un foro",
      description:
        "ACCIÓN DE ESCRITURA. Responde a un post existente (replyToPostId) o abre una discusión nueva en un foro (forumId + subject). " +
        "Mostrale al usuario el texto exacto que se va a publicar y pedí confirmación antes de pasar confirm=true. Lo publicado queda visible para toda la cátedra y los compañeros.",
      inputSchema: {
        replyToPostId: z.number().int().optional().describe("postId al que responder (de campus_forum_discussion)"),
        forumId: z.number().int().optional().describe("Alternativa: id del foro para abrir una discusión nueva"),
        subject: z.string().min(1).describe("Asunto"),
        message: z.string().min(1).describe("Mensaje (texto plano o HTML simple)"),
        confirm: z.boolean().optional().describe(CONFIRM_DESCRIPTION),
      },
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    wrap(async ({ replyToPostId, forumId, subject, message, confirm }) => {
      if (!replyToPostId && !forumId) return fail("Indicá replyToPostId o forumId.");
      const pending = needsConfirmation(confirm, { action: "campus_forum_post", replyToPostId, forumId, subject, message });
      if (pending) return pending;
      const client = await ctx.getClient();
      const html = /<[a-z][\s\S]*>/i.test(message) ? message : `<p>${message.replace(/\n/g, "<br>")}</p>`;
      if (replyToPostId) {
        const r = await api.addDiscussionPost(client, replyToPostId, subject, html);
        await ctx.log(`forum reply post=${replyToPostId} new=${r.postid}`);
        return ok({ ok: true, postId: r.postid });
      }
      const r = await api.addDiscussion(client, forumId!, subject, html);
      await ctx.log(`forum new discussion forum=${forumId} id=${r.discussionid}`);
      return ok({ ok: true, discussionId: r.discussionid });
    }),
  );
}
