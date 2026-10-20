import { describe, it, expect, beforeAll } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { extractText } from "../src/files/extract.js";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "utn-mcp-extract-"));
});

describe("extractText", () => {
  it("lee texto plano", async () => {
    const p = join(dir, "a.txt");
    await writeFile(p, "hola\nmundo");
    const r = await extractText(p);
    expect(r.kind).toBe("text");
    expect(r.text).toBe("hola\nmundo");
  });

  it("lee html", async () => {
    const p = join(dir, "a.html");
    await writeFile(p, "<h1>Título</h1><p>Cuerpo</p>");
    const r = await extractText(p);
    expect(r.text).toBe("Título\nCuerpo");
  });

  it("lee pptx (slides y notas)", async () => {
    const zip = new JSZip();
    zip.file("ppt/slides/slide2.xml", `<p:sld><p:txBody><a:p><a:r><a:t>Segunda</a:t></a:r></a:p></p:txBody></p:sld>`);
    zip.file("ppt/slides/slide1.xml", `<p:sld><a:p><a:r><a:t>Primera </a:t></a:r><a:r><a:t>diapositiva &amp; m&#225;s</a:t></a:r></a:p><a:p><a:r><a:t>Segundo párrafo</a:t></a:r></a:p></p:sld>`);
    zip.file("ppt/notesSlides/notesSlide1.xml", `<p:notes><a:p><a:r><a:t>Nota del docente</a:t></a:r></a:p></p:notes>`);
    const p = join(dir, "a.pptx");
    await writeFile(p, await zip.generateAsync({ type: "nodebuffer" }));
    const r = await extractText(p);
    expect(r.kind).toBe("pptx");
    expect(r.pages).toBe(2);
    expect(r.text).toContain("--- Diapositiva 1 ---\nPrimera diapositiva & más\nSegundo párrafo\n\n[Notas] Nota del docente");
    expect(r.text).toContain("--- Diapositiva 2 ---\nSegunda");
  });

  it("lee xlsx (shared strings y valores)", async () => {
    const zip = new JSZip();
    zip.file("xl/sharedStrings.xml", `<sst><si><t>Nombre</t></si><si><t>Nota</t></si></sst>`);
    zip.file(
      "xl/worksheets/sheet1.xml",
      `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Ana</t></is></c><c r="B2"><v>8</v></c></row></sheetData></worksheet>`,
    );
    const p = join(dir, "a.xlsx");
    await writeFile(p, await zip.generateAsync({ type: "nodebuffer" }));
    const r = await extractText(p);
    expect(r.kind).toBe("xlsx");
    expect(r.text).toBe("--- Hoja sheet1 ---\nNombre\tNota\nAna\t8");
  });

  it("lee docx", async () => {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    );
    zip.file(
      "word/document.xml",
      `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hola </w:t></w:r><w:r><w:t>docx</w:t></w:r></w:p><w:p><w:r><w:t>Segundo</w:t></w:r></w:p></w:body></w:document>`,
    );
    const p = join(dir, "a.docx");
    await writeFile(p, await zip.generateAsync({ type: "nodebuffer" }));
    const r = await extractText(p);
    expect(r.kind).toBe("docx");
    expect(r.text).toBe("Hola docx\n\nSegundo");
  });

  it("lee pdf", async () => {
    const pdf = minimalPdf("Hola PDF");
    const p = join(dir, "a.pdf");
    await writeFile(p, pdf, "latin1");
    const r = await extractText(p);
    expect(r.kind).toBe("pdf");
    expect(r.pages).toBe(1);
    expect(r.text).toContain("Hola PDF");
  });

  it("avisa cuando el formato no se soporta", async () => {
    const p = join(dir, "a.zip");
    await writeFile(p, "zzz");
    const r = await extractText(p);
    expect(r.text).toBe("");
    expect(r.warning).toMatch(/No sé extraer/);
  });
});

/** PDF mínimo de una página con un texto, con xref calculado. */
function minimalPdf(text: string): string {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    null,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = `BT /F1 24 Tf 20 60 Td (${text}) Tj ET`;
  objects[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}
