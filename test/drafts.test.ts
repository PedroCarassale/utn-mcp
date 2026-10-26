import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const SITE = "https://campus.test";
const ASSIGN_ID = 42;

/** Llamadas a web services que recibió el Moodle falso: [wsfunction, params]. */
const calls: [string, URLSearchParams][] = [];

function moodle(fn: string, p: URLSearchParams): unknown {
  switch (fn) {
    case "core_webservice_get_site_info":
      return { userid: 7, functions: [] };
    case "mod_assign_get_assignments":
      return {
        courses: [
          {
            id: 3,
            fullname: "Física II",
            shortname: "FII",
            assignments: [
              {
                id: ASSIGN_ID,
                cmid: 100,
                course: 3,
                name: "TP 1",
                duedate: Date.now() / 1000 + 86400,
                allowsubmissionsfromdate: 0,
                cutoffdate: 0,
                configs: [
                  { plugin: "file", subtype: "assignsubmission", name: "enabled", value: "1" },
                  { plugin: "file", subtype: "assignsubmission", name: "maxfilesubmissions", value: "2" },
                  { plugin: "file", subtype: "assignsubmission", name: "maxsubmissionsizebytes", value: "1000" },
                  { plugin: "file", subtype: "assignsubmission", name: "filetypeslist", value: ".pdf,.zip" },
                  { plugin: "onlinetext", subtype: "assignsubmission", name: "enabled", value: "0" },
                ],
              },
            ],
          },
        ],
      };
    case "mod_assign_get_submission_status":
      return {
        lastattempt: {
          canedit: true,
          submission: {
            status: "draft",
            plugins: [{ type: "file", fileareas: [{ files: [{ filename: "viejo.pdf", fileurl: `${SITE}/pluginfile.php/1/viejo.pdf`, filesize: 3 }] }] }],
          },
        },
      };
    case "core_files_upload":
      return { itemid: 555, filename: p.get("filename"), url: "" };
    case "mod_assign_save_submission":
      return [];
    default:
      throw new Error(`wsfunction inesperada: ${fn}`);
  }
}

let client: Client;
let dir: string;

beforeAll(async () => {
  process.env.UTN_MCP_MIN_INTERVAL = "0";
  vi.stubGlobal("fetch", async (input: any, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.includes("pluginfile.php")) return new Response("old", { headers: { "content-type": "application/pdf" } });
    const p = new URLSearchParams(String(init?.body));
    const fn = p.get("wsfunction")!;
    calls.push([fn, p]);
    return new Response(JSON.stringify(moodle(fn, p)), { headers: { "content-type": "application/json" } });
  });
  dir = await mkdtemp(join(tmpdir(), "utn-mcp-drafts-"));
  await writeFile(join(dir, "informe.pdf"), "pdf!");
  await writeFile(join(dir, "anexo.zip"), "zip!");
  await writeFile(join(dir, "notas.txt"), "txt");
  await writeFile(join(dir, "grande.pdf"), "x".repeat(2000));

  const { AppContext } = await import("../src/context.js");
  const { createServer } = await import("../src/server.js");
  const ctx = new AppContext({
    home: join(dir, "home"),
    credentials: { site: SITE, token: "tok", userid: 7, obtainedAt: "", source: "manual" },
  });
  const server = createServer(ctx);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: "test", version: "0" });
  await client.connect(b);
});

afterAll(() => vi.unstubAllGlobals());

async function call(name: string, args: Record<string, unknown>) {
  const r = await client.callTool({ name, arguments: args });
  const text = (r.content as any)[0].text as string;
  return { isError: Boolean(r.isError), text, body: text.startsWith("{") ? JSON.parse(text) : null };
}

describe("borradores de entrega", () => {
  it("valida tipo, tamaño, texto y rutas antes de agregar", async () => {
    expect((await call("campus_draft_add", { assignmentId: ASSIGN_ID, filePaths: [join(dir, "notas.txt")] })).text).toMatch(/no acepta notas\.txt/);
    expect((await call("campus_draft_add", { assignmentId: ASSIGN_ID, filePaths: [join(dir, "grande.pdf")] })).text).toMatch(/pesa/);
    expect((await call("campus_draft_add", { assignmentId: ASSIGN_ID, onlineText: "hola" })).text).toMatch(/no acepta texto/);
    expect((await call("campus_draft_add", { assignmentId: ASSIGN_ID, filePaths: ["informe.pdf"] })).text).toMatch(/ruta absoluta/);
    expect((await call("campus_draft_add", { assignmentId: 999, filePaths: [join(dir, "informe.pdf")] })).text).toMatch(/No encontré la tarea/);
    expect((await call("campus_draft_show", {})).text).toMatch(/No hay entregas/);
  });

  it("agrega archivos de a uno, respeta el máximo y permite quitarlos", async () => {
    const r1 = await call("campus_draft_add", { assignmentId: ASSIGN_ID, filePaths: [join(dir, "informe.pdf")] });
    expect(r1.body.draft.files.map((f: any) => f.name)).toEqual(["informe.pdf"]);
    expect(r1.body.draft.course).toBe("Física II");

    const r2 = await call("campus_draft_add", { assignmentId: ASSIGN_ID, filePaths: [join(dir, "anexo.zip"), join(dir, "informe.pdf")] });
    expect(r2.body.draft.files.map((f: any) => f.name).sort()).toEqual(["anexo.zip", "informe.pdf"]);
    expect(r2.body.warnings.join(" ")).toMatch(/Reemplacé informe\.pdf/);

    await writeFile(join(dir, "extra.pdf"), "e");
    expect((await call("campus_draft_add", { assignmentId: ASSIGN_ID, filePaths: [join(dir, "extra.pdf")] })).text).toMatch(/hasta 2 archivo/);

    const r3 = await call("campus_draft_remove", { assignmentId: ASSIGN_ID, fileNames: ["anexo.zip", "nada.pdf"] });
    expect(r3.body.draft.files.map((f: any) => f.name)).toEqual(["informe.pdf"]);
    expect(r3.body.notFound).toEqual(["nada.pdf"]);
  });

  it("sin confirm muestra la vista previa y avisa qué reemplaza", async () => {
    calls.length = 0;
    const r = await call("campus_draft_submit", { assignmentId: ASSIGN_ID });
    expect(r.body.executed).toBe(false);
    expect(r.body.preview.files).toEqual(["informe.pdf (4 B)"]);
    expect(r.body.preview.notes.join(" ")).toMatch(/reemplazar.*viejo\.pdf/);
    expect(calls.map(([fn]) => fn)).not.toContain("mod_assign_save_submission");
  });

  it("con confirm sube los archivos (conservando los existentes si se pide) y borra el borrador", async () => {
    // El original cambia después de agregarlo: se sube la copia del borrador.
    await writeFile(join(dir, "informe.pdf"), "cambiado");
    calls.length = 0;
    const r = await call("campus_draft_submit", { assignmentId: ASSIGN_ID, keepExisting: true, confirm: true });
    expect(r.body.ok).toBe(true);
    expect(r.body.draftDiscarded).toBe(true);

    const uploads = calls.filter(([fn]) => fn === "core_files_upload").map(([, p]) => p);
    expect(uploads.map((p) => p.get("filename"))).toEqual(["viejo.pdf", "informe.pdf"]);
    expect(Buffer.from(uploads[1].get("filecontent")!, "base64").toString()).toBe("pdf!");
    expect(uploads[1].get("itemid")).toBe("555");

    const save = calls.find(([fn]) => fn === "mod_assign_save_submission")![1];
    expect(save.get("plugindata[files_filemanager]")).toBe("555");
    expect(calls.map(([fn]) => fn)).not.toContain("mod_assign_submit_for_grading");

    expect((await call("campus_draft_show", { assignmentId: ASSIGN_ID })).isError).toBe(true);
  });
});
