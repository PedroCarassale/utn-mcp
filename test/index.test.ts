import { describe, it, expect, beforeAll } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TextIndex } from "../src/store/index.js";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "utn-mcp-index-"));
});

const base = {
  courseId: 1,
  courseName: "Análisis Matemático I",
  sectionName: "Unidad 3",
  moduleId: 10,
  modname: "resource",
  localPath: "/tmp/x.pdf",
  kind: "pdf",
};

describe("TextIndex", () => {
  it("indexa, busca sin acentos y devuelve snippets", async () => {
    const idx = new TextIndex(join(dir, "index.json"), join(dir, "text"));
    await idx.upsert(
      { ...base, id: "a", moduleName: "Apunte derivadas", filename: "derivadas.pdf", fileurl: "https://x/derivadas.pdf", chars: 100 },
      "La derivada de una función mide la tasa de cambio. El teorema de Bolzano habla de continuidad.",
    );
    await idx.upsert(
      { ...base, id: "b", moduleName: "Práctica 1", filename: "practica1.pdf", fileurl: "https://x/p1.pdf", chars: 50 },
      "Ejercicios de límites y continuidad.",
    );
    const hits = await idx.search("teorema bolzano");
    expect(hits).toHaveLength(1);
    expect(hits[0].entry.filename).toBe("derivadas.pdf");
    expect(hits[0].snippets[0]).toContain("Bolzano");

    const cont = await idx.search("continuidad");
    expect(cont.map((h) => h.entry.filename).sort()).toEqual(["derivadas.pdf", "practica1.pdf"]);

    const byName = await idx.search("practica");
    expect(byName[0].entry.filename).toBe("practica1.pdf");
  });

  it("filtra por curso y reemplaza entradas existentes", async () => {
    const idx = new TextIndex(join(dir, "index2.json"), join(dir, "text2"));
    await idx.upsert({ ...base, id: "a", courseId: 1, moduleName: "m", filename: "a.pdf", fileurl: "u1", chars: 1 }, "gato");
    await idx.upsert({ ...base, id: "b", courseId: 2, moduleName: "m", filename: "b.pdf", fileurl: "u2", chars: 1 }, "gato perro");
    await idx.upsert({ ...base, id: "a", courseId: 1, moduleName: "m", filename: "a.pdf", fileurl: "u1", chars: 1 }, "solo perro");
    expect((await idx.list()).length).toBe(2);
    expect((await idx.search("gato", { courseId: 1 })).length).toBe(0);
    expect((await idx.search("perro", { courseId: 1 })).length).toBe(1);
    expect(await idx.readText("a")).toBe("solo perro");
  });
});
