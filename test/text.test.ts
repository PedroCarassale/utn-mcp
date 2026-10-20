import { describe, it, expect } from "vitest";
import { htmlToText, safeFilename, tokenize, normalize, fmtBytes } from "../src/util/text.js";

describe("htmlToText", () => {
  it("convierte párrafos, listas, links y entidades", () => {
    const html = `<p>Hola <b>mundo</b>&nbsp;&aacute;</p><ul><li>uno</li><li>dos</li></ul><a href="https://x.edu/a">Apunte</a><script>alert(1)</script>`;
    expect(htmlToText(html)).toBe("Hola mundo á\n• uno\n• dos\nApunte (https://x.edu/a)");
  });
  it("tolera null", () => {
    expect(htmlToText(null)).toBe("");
  });
});

describe("safeFilename", () => {
  it("quita caracteres inválidos y acentos", () => {
    expect(safeFilename('Práctica 3: "derivadas"/<parte 1>.pdf')).toBe("Practica 3_ _derivadas___parte 1_.pdf");
  });
});

describe("tokenize/normalize", () => {
  it("normaliza acentos y separa términos", () => {
    expect(normalize("Análisis Matemático")).toBe("analisis matematico");
    expect(tokenize("Unidad 3: Análisis, derivadas!")).toEqual(["unidad", "analisis", "derivadas"]);
  });
});

describe("fmtBytes", () => {
  it("formatea", () => {
    expect(fmtBytes(512)).toBe("512 B");
    expect(fmtBytes(2048)).toBe("2.0 KB");
    expect(fmtBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});
