import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import JSZip from "jszip";
import { htmlToText, decodeEntities } from "../util/text.js";

export interface ExtractResult {
  text: string;
  kind: string;
  pages?: number;
  warning?: string;
}

const TEXT_EXTS = new Set([".txt", ".md", ".csv", ".tsv", ".json", ".xml", ".log", ".tex", ".py", ".js", ".ts", ".c", ".cpp", ".h", ".java", ".sql", ".m", ".r", ".ini", ".yml", ".yaml"]);

/** Extrae texto legible de un archivo según su extensión/mimetype. */
export async function extractText(path: string, mimetype?: string | null): Promise<ExtractResult> {
  const ext = extname(path).toLowerCase();
  const mt = (mimetype ?? "").toLowerCase();

  if (ext === ".pdf" || mt.includes("pdf")) return extractPdf(path);
  if (ext === ".docx" || mt.includes("wordprocessingml")) return extractDocx(path);
  if (ext === ".pptx" || mt.includes("presentationml")) return extractPptx(path);
  if (ext === ".xlsx" || mt.includes("spreadsheetml")) return extractXlsx(path);
  if (ext === ".odt" || ext === ".odp" || ext === ".ods") return extractOdf(path, ext);
  if (ext === ".html" || ext === ".htm" || mt.includes("text/html")) {
    const raw = await readFile(path, "utf8");
    return { text: htmlToText(raw), kind: "html" };
  }
  if (TEXT_EXTS.has(ext) || mt.startsWith("text/")) {
    const raw = await readFile(path, "utf8");
    return { text: raw, kind: "text" };
  }
  if (ext === ".doc" || ext === ".ppt" || ext === ".xls") {
    return {
      text: "",
      kind: ext.slice(1),
      warning: `Formato binario antiguo (${ext}) no soportado. Pedile al usuario que lo convierta o abrilo con la ruta local.`,
    };
  }
  return {
    text: "",
    kind: ext.slice(1) || mt || "desconocido",
    warning: `No sé extraer texto de este tipo de archivo (${ext || mt}). Devuelvo solo la ruta local.`,
  };
}

async function extractPdf(path: string): Promise<ExtractResult> {
  const { extractText: unpdfExtract, getDocumentProxy } = await import("unpdf");
  const data = new Uint8Array(await readFile(path));
  const pdf = await getDocumentProxy(data);
  const { totalPages, text } = await unpdfExtract(pdf, { mergePages: true });
  const cleaned = (text as string).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const warning = cleaned.length < 50 && totalPages > 0
    ? "El PDF casi no tiene texto extraíble: probablemente sea escaneado (imágenes). Haría falta OCR."
    : undefined;
  return { text: cleaned, kind: "pdf", pages: totalPages, warning };
}

async function extractDocx(path: string): Promise<ExtractResult> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ path });
  return { text: result.value.trim(), kind: "docx" };
}

/** Extrae texto de los <a:t> de cada slide, en orden. */
async function extractPptx(path: string): Promise<ExtractResult> {
  const zip = await JSZip.loadAsync(await readFile(path));
  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => slideNum(a) - slideNum(b));
  const parts: string[] = [];
  for (const name of slideNames) {
    const xml = await zip.files[name].async("string");
    const paragraphs = xmlParagraphs(xml, /<a:p\b[\s\S]*?<\/a:p>/g, /<a:t>([\s\S]*?)<\/a:t>/g);
    parts.push(`--- Diapositiva ${slideNum(name)} ---\n${paragraphs.join("\n")}`);
    const notesName = `ppt/notesSlides/notesSlide${slideNum(name)}.xml`;
    if (zip.files[notesName]) {
      const nxml = await zip.files[notesName].async("string");
      const notes = xmlParagraphs(nxml, /<a:p\b[\s\S]*?<\/a:p>/g, /<a:t>([\s\S]*?)<\/a:t>/g).join("\n").trim();
      if (notes) parts.push(`[Notas] ${notes}`);
    }
  }
  return { text: parts.join("\n\n").trim(), kind: "pptx", pages: slideNames.length };
}

async function extractXlsx(path: string): Promise<ExtractResult> {
  const zip = await JSZip.loadAsync(await readFile(path));
  const shared: string[] = [];
  const ss = zip.files["xl/sharedStrings.xml"];
  if (ss) {
    const xml = await ss.async("string");
    for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      shared.push(decodeEntities(Array.from(m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g), (x) => x[1]).join("")));
    }
  }
  const sheets = Object.keys(zip.files)
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort();
  const parts: string[] = [];
  for (const name of sheets) {
    const xml = await zip.files[name].async("string");
    const rows: string[] = [];
    for (const row of xml.matchAll(/<row\b[\s\S]*?<\/row>/g)) {
      const cells: string[] = [];
      for (const cell of row[0].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
        const attrs = cell[1];
        const v = /<v>([\s\S]*?)<\/v>/.exec(cell[2])?.[1] ?? "";
        const inline = /<t[^>]*>([\s\S]*?)<\/t>/.exec(cell[2])?.[1];
        if (/t="s"/.test(attrs)) cells.push(shared[Number(v)] ?? "");
        else if (inline !== undefined) cells.push(decodeEntities(inline));
        else cells.push(v);
      }
      if (cells.some((c) => c !== "")) rows.push(cells.join("\t"));
    }
    parts.push(`--- Hoja ${name.replace(/^xl\/worksheets\/|\.xml$/g, "")} ---\n${rows.join("\n")}`);
  }
  return { text: parts.join("\n\n").trim(), kind: "xlsx", pages: sheets.length };
}

async function extractOdf(path: string, ext: string): Promise<ExtractResult> {
  const zip = await JSZip.loadAsync(await readFile(path));
  const content = zip.files["content.xml"];
  if (!content) return { text: "", kind: ext.slice(1), warning: "ODF sin content.xml" };
  const xml = await content.async("string");
  const text = htmlToText(xml.replace(/<text:(p|h)\b/g, "<p").replace(/<\/text:(p|h)>/g, "</p>").replace(/<text:tab\/>/g, "\t").replace(/<text:line-break\/>/g, "\n"));
  return { text, kind: ext.slice(1) };
}

function slideNum(name: string): number {
  return Number(/(\d+)\.xml$/.exec(name)?.[1] ?? 0);
}

function xmlParagraphs(xml: string, paraRe: RegExp, runRe: RegExp): string[] {
  const out: string[] = [];
  for (const p of xml.matchAll(paraRe)) {
    const runs = Array.from(p[0].matchAll(runRe), (m) => decodeEntities(m[1]));
    const line = runs.join("").trim();
    if (line) out.push(line);
  }
  return out;
}
