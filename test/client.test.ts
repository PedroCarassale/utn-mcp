import { describe, it, expect } from "vitest";
import { flattenArgs, tokenizeFileUrl, MoodleClient, MoodleError } from "../src/moodle/client.js";

function mockFetch(handler: (url: string, init: RequestInit) => { status?: number; body: string; headers?: Record<string, string> }) {
  return (async (input: any, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.url;
    const r = handler(url, init ?? {});
    return new Response(r.body, { status: r.status ?? 200, headers: r.headers ?? { "content-type": "application/json" } });
  }) as typeof fetch;
}

describe("flattenArgs", () => {
  it("aplana arrays y objetos al formato de Moodle", () => {
    const out = flattenArgs({
      courseid: 5,
      courseids: [1, 2],
      options: [{ name: "excludecontents", value: true }],
      nested: { a: { b: "x" } },
      skip: undefined,
      nul: null,
    });
    expect(Object.fromEntries(out)).toEqual({
      courseid: "5",
      "courseids[0]": "1",
      "courseids[1]": "2",
      "options[0][name]": "excludecontents",
      "options[0][value]": "1",
      "nested[a][b]": "x",
    });
  });
});

describe("tokenizeFileUrl", () => {
  it("reescribe a webservice/pluginfile y agrega el token", () => {
    const u = tokenizeFileUrl("https://x.edu/pluginfile.php/1/mod_resource/content/1/a.pdf?forcedownload=1", "abc");
    expect(u).toBe("https://x.edu/webservice/pluginfile.php/1/mod_resource/content/1/a.pdf?forcedownload=1&token=abc");
  });
  it("no duplica el token", () => {
    const u = tokenizeFileUrl("https://x.edu/webservice/pluginfile.php/1/a.pdf?token=zzz", "abc");
    expect(u).toBe("https://x.edu/webservice/pluginfile.php/1/a.pdf?token=zzz");
  });
});

describe("MoodleClient.call", () => {
  it("envía wstoken, wsfunction y formato json, y parsea la respuesta", async () => {
    let captured: URLSearchParams | null = null;
    const client = new MoodleClient("https://x.edu", "tok", {
      minIntervalMs: 0,
      fetchImpl: mockFetch((url, init) => {
        expect(url).toBe("https://x.edu/webservice/rest/server.php");
        captured = init.body as URLSearchParams;
        return { body: JSON.stringify({ userid: 7, fullname: "Ana" }) };
      }),
    });
    const r = await client.call<{ userid: number }>("core_webservice_get_site_info", { a: [1] });
    expect(r.userid).toBe(7);
    expect(captured!.get("wstoken")).toBe("tok");
    expect(captured!.get("wsfunction")).toBe("core_webservice_get_site_info");
    expect(captured!.get("moodlewsrestformat")).toBe("json");
    expect(captured!.get("a[0]")).toBe("1");
  });

  it("convierte excepciones de Moodle en MoodleError", async () => {
    const client = new MoodleClient("https://x.edu", "tok", {
      minIntervalMs: 0,
      fetchImpl: mockFetch(() => ({
        body: JSON.stringify({ exception: "moodle_exception", errorcode: "invalidtoken", message: "Ficha no válida" }),
      })),
    });
    const err = await client.call("x").catch((e) => e);
    expect(err).toBeInstanceOf(MoodleError);
    expect(err.errorcode).toBe("invalidtoken");
    expect(err.isInvalidToken).toBe(true);
  });

  it("reintenta ante 5xx", async () => {
    let calls = 0;
    const client = new MoodleClient("https://x.edu", "tok", {
      minIntervalMs: 0,
      maxRetries: 2,
      fetchImpl: mockFetch(() => {
        calls++;
        return calls < 3 ? { status: 502, body: "bad gateway" } : { body: "[]" };
      }),
    });
    const r = await client.call("x");
    expect(r).toEqual([]);
    expect(calls).toBe(3);
  });

  it("acepta respuesta null (funciones sin retorno)", async () => {
    const client = new MoodleClient("https://x.edu", "tok", { minIntervalMs: 0, fetchImpl: mockFetch(() => ({ body: "null" })) });
    expect(await client.call("x")).toBeNull();
  });
});

describe("MoodleClient.download", () => {
  it("detecta la pantalla de login como token vencido", async () => {
    const client = new MoodleClient("https://x.edu", "tok", {
      minIntervalMs: 0,
      fetchImpl: mockFetch(() => ({ body: '<html><form id="loginform" action="/login/index.php">', headers: { "content-type": "text/html" } })),
    });
    const err = await client.download("https://x.edu/pluginfile.php/1/a.pdf").catch((e) => e);
    expect(err).toBeInstanceOf(MoodleError);
    expect(err.errorcode).toBe("invalidtoken");
  });

  it("rechaza archivos que superan el límite", async () => {
    const client = new MoodleClient("https://x.edu", "tok", {
      minIntervalMs: 0,
      fetchImpl: mockFetch(() => ({ body: "x".repeat(100), headers: { "content-type": "application/pdf", "content-length": "100" } })),
    });
    const err = await client.download("https://x.edu/pluginfile.php/1/a.pdf", 50).catch((e) => e);
    expect(err.errorcode).toBe("toolarge");
  });

  it("no manda el token a URLs fuera del campus", async () => {
    const requested: string[] = [];
    const client = new MoodleClient("https://x.edu", "tok", {
      minIntervalMs: 0,
      fetchImpl: mockFetch((url) => {
        requested.push(url);
        return { body: "pdf", headers: { "content-type": "application/pdf" } };
      }),
    });
    for (const url of [
      "https://atacante.com/pluginfile.php/1/a.pdf",
      "https://x.edu.atacante.com/pluginfile.php/1/a.pdf",
      "https://x.edu@atacante.com/pluginfile.php/1/a.pdf",
      "http://x.edu/pluginfile.php/1/a.pdf",
      "https://x.edu:8443/pluginfile.php/1/a.pdf",
      "no es una url",
    ]) {
      const err = await client.download(url).catch((e) => e);
      expect(err).toBeInstanceOf(MoodleError);
      expect(err.errorcode).toBe("foreignurl");
    }
    expect(requested).toEqual([]);
  });
});
