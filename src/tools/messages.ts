import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AppContext, ok, fail, wrap } from "../context.js";
import * as api from "../moodle/api.js";
import { fmtDate, htmlToText, truncate } from "../util/text.js";
import { CONFIRM_DESCRIPTION, needsConfirmation } from "./confirm.js";

export function registerMessageTools(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    "campus_messages",
    {
      title: "Conversaciones de mensajería",
      description: "Lista las conversaciones de mensajería del campus (privadas y grupales) con el último mensaje y cuántos hay sin leer. Usá conversationId con campus_conversation para leer el hilo.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional().describe("Cantidad. Default 20"),
        unreadOnly: z.boolean().optional().describe("Solo con mensajes sin leer"),
      },
      annotations: { readOnlyHint: true },
    },
    wrap(async ({ limit, unreadOnly }) => {
      const client = await ctx.getClient();
      const userid = await ctx.getUserId();
      const convs = await api.getConversations(client, userid, limit ?? 20);
      return ok(
        convs
          .filter((c) => !unreadOnly || (c.unreadcount ?? 0) > 0)
          .map((c) => {
            const last = c.messages?.[0];
            return {
              conversationId: c.id,
              name: c.name || c.members.filter((m) => m.id !== userid).map((m) => m.fullname).join(", "),
              type: c.type === 1 ? "individual" : c.type === 2 ? "grupo" : "propia",
              members: c.membercount,
              unread: c.unreadcount ?? 0,
              lastMessage: last ? { from: c.members.find((m) => m.id === last.useridfrom)?.fullname ?? last.useridfrom, date: fmtDate(last.timecreated), text: truncate(htmlToText(last.text), 300) } : null,
            };
          }),
      );
    }),
  );

  server.registerTool(
    "campus_conversation",
    {
      title: "Leer una conversación",
      description: "Devuelve los mensajes de una conversación (más recientes primero).",
      inputSchema: {
        conversationId: z.number().int(),
        limit: z.number().int().min(1).max(200).optional().describe("Default 50"),
      },
      annotations: { readOnlyHint: true },
    },
    wrap(async ({ conversationId, limit }) => {
      const client = await ctx.getClient();
      const userid = await ctx.getUserId();
      const conv = await api.getConversationMessages(client, userid, conversationId, limit ?? 50);
      const names = new Map(conv.members.map((m) => [m.id, m.fullname]));
      return ok({
        conversationId,
        members: conv.members.map((m) => ({ userId: m.id, name: m.fullname })),
        messages: conv.messages.map((m) => ({ id: m.id, from: names.get(m.useridfrom) ?? m.useridfrom, mine: m.useridfrom === userid, date: fmtDate(m.timecreated), text: htmlToText(m.text) })),
      });
    }),
  );

  server.registerTool(
    "campus_notifications",
    {
      title: "Notificaciones",
      description: "Notificaciones del campus (nuevas tareas, notas publicadas, posts de foro, etc.), más recientes primero.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional().describe("Default 20"),
        unreadOnly: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    wrap(async ({ limit, unreadOnly }) => {
      const client = await ctx.getClient();
      const userid = await ctx.getUserId();
      const r = await api.getNotifications(client, userid, limit ?? 20);
      return ok({
        unreadCount: r.unreadcount,
        notifications: r.notifications
          .filter((n) => !unreadOnly || !n.read)
          .map((n) => ({
            id: n.id,
            date: fmtDate(n.timecreated),
            read: n.read,
            subject: n.subject,
            text: truncate(htmlToText(n.fullmessagehtml || n.fullmessage || n.smallmessage || n.text), 600),
            url: n.contexturl || undefined,
            component: n.component,
            eventtype: n.eventtype,
          })),
      });
    }),
  );

  server.registerTool(
    "campus_search_users",
    {
      title: "Buscar personas",
      description: "Busca usuarios del campus por nombre para obtener su userId (p. ej. para enviar un mensaje a un docente o compañero).",
      inputSchema: { query: z.string().min(2) },
      annotations: { readOnlyHint: true },
    },
    wrap(async ({ query }) => {
      const client = await ctx.getClient();
      const userid = await ctx.getUserId();
      const r = await api.searchUsers(client, userid, query, 20);
      const map = (u: any) => ({ userId: u.id, name: u.fullname, contact: Boolean(u.iscontact) });
      return ok({ contacts: r.contacts.map(map), others: r.noncontacts.map(map) });
    }),
  );

  server.registerTool(
    "campus_send_message",
    {
      title: "Enviar un mensaje",
      description:
        "ACCIÓN DE ESCRITURA. Envía un mensaje de la mensajería del campus a un usuario (toUserId) o a una conversación existente (conversationId). " +
        "Mostrale al usuario el destinatario y el texto exacto y pedí confirmación antes de pasar confirm=true.",
      inputSchema: {
        toUserId: z.number().int().optional().describe("Id del destinatario (de campus_search_users o campus_conversation)"),
        conversationId: z.number().int().optional().describe("Alternativa: conversación existente"),
        text: z.string().min(1),
        confirm: z.boolean().optional().describe(CONFIRM_DESCRIPTION),
      },
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    wrap(async ({ toUserId, conversationId, text, confirm }) => {
      if (!toUserId && !conversationId) return fail("Indicá toUserId o conversationId.");
      const pending = needsConfirmation(confirm, { action: "campus_send_message", toUserId, conversationId, text });
      if (pending) return pending;
      const client = await ctx.getClient();
      if (conversationId && (await ctx.hasFunction("core_message_send_messages_to_conversation"))) {
        const r = await api.sendToConversation(client, conversationId, text);
        await ctx.log(`message conversation=${conversationId}`);
        return ok({ ok: true, messageIds: r.map((m) => m.id) });
      }
      if (!toUserId) return fail("Esta instancia no permite enviar a una conversación; indicá toUserId.");
      const r = await api.sendInstantMessage(client, toUserId, text);
      const err = r.find((x) => x.errormessage);
      if (err) return fail(`Moodle rechazó el mensaje: ${err.errormessage}`);
      await ctx.log(`message user=${toUserId}`);
      return ok({ ok: true, messageIds: r.map((m) => m.msgid) });
    }),
  );

  server.registerTool(
    "campus_mark_notifications_read",
    {
      title: "Marcar notificaciones como leídas",
      description: "ACCIÓN DE ESCRITURA. Marca todas las notificaciones del campus como leídas. Pedí confirmación antes de pasar confirm=true.",
      inputSchema: { confirm: z.boolean().optional().describe(CONFIRM_DESCRIPTION) },
      annotations: { destructiveHint: true },
    },
    wrap(async ({ confirm }) => {
      const pending = needsConfirmation(confirm, { action: "campus_mark_notifications_read" });
      if (pending) return pending;
      const client = await ctx.getClient();
      const userid = await ctx.getUserId();
      await api.markAllNotificationsRead(client, userid);
      await ctx.log("notifications marked read");
      return ok({ ok: true });
    }),
  );
}
