import { describe, it, expect, beforeAll } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

let client: Client;

beforeAll(async () => {
  // Directorio de datos vacío y sin token en el entorno: no debe haber sesión.
  process.env.UTN_MCP_HOME = await mkdtemp(join(tmpdir(), "utn-mcp-home-"));
  delete process.env.UTN_MOODLE_TOKEN;
  const { createServer } = await import("../src/server.js");
  const server = createServer();
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: "test", version: "0" });
  await client.connect(b);
});

describe("servidor MCP", () => {
  it("expone todas las tools esperadas", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    for (const expected of [
      "campus_login",
      "campus_logout",
      "campus_whoami",
      "campus_functions",
      "campus_list_courses",
      "campus_course_contents",
      "campus_module",
      "campus_get_file",
      "campus_search_files",
      "campus_index_course",
      "campus_search_content",
      "campus_indexed_files",
      "campus_upcoming",
      "campus_assignments",
      "campus_submit_assignment",
      "campus_grades",
      "campus_announcements",
      "campus_forum_discussion",
      "campus_forum_post",
      "campus_messages",
      "campus_conversation",
      "campus_notifications",
      "campus_search_users",
      "campus_send_message",
      "campus_mark_notifications_read",
      "campus_quizzes",
      "campus_scheduler",
    ]) {
      expect(names, `falta ${expected}`).toContain(expected);
    }
  });

  it("sin sesión responde un error legible en vez de romper", async () => {
    const r = await client.callTool({ name: "campus_whoami", arguments: {} });
    expect(r.isError).toBe(true);
    expect((r.content as any)[0].text).toMatch(/utn-mcp login/);
  });

  it("las acciones de escritura sin confirm devuelven vista previa y no ejecutan", async () => {
    const r = await client.callTool({ name: "campus_send_message", arguments: { toUserId: 1, text: "hola" } });
    expect(r.isError).toBeFalsy();
    const body = JSON.parse((r.content as any)[0].text);
    expect(body.executed).toBe(false);
    expect(body.preview.text).toBe("hola");

    const r2 = await client.callTool({ name: "campus_forum_post", arguments: { forumId: 3, subject: "s", message: "m" } });
    expect(JSON.parse((r2.content as any)[0].text).executed).toBe(false);

    const r3 = await client.callTool({ name: "campus_submit_assignment", arguments: { assignmentId: 1, onlineText: "t" } });
    const b3 = JSON.parse((r3.content as any)[0].text);
    expect(b3.executed).toBe(false);
    expect(b3.preview.assignmentId).toBe(1);
  });

  it("campus_login con credenciales incompletas falla con mensaje claro", async () => {
    const r = await client.callTool({ name: "campus_login", arguments: { username: "x" } });
    expect(r.isError).toBe(true);
    expect((r.content as any)[0].text).toMatch(/Falta usuario/);
  });
});
