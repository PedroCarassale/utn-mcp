import { describe, it, expect } from "vitest";
import { obtainToken, AuthError } from "../src/auth/token.js";
import { DEFAULT_SITE } from "../src/config.js";

/**
 * Pruebas contra el campus real sin credenciales. Se activan con UTN_MCP_LIVE=1
 * para no depender de la red en CI.
 */
const live = process.env.UTN_MCP_LIVE === "1" ? describe : describe.skip;

live("campus real (sin credenciales)", () => {
  it("tiene el servicio móvil habilitado y rechaza credenciales inválidas con invalidlogin", async () => {
    const err = await obtainToken("usuario-inexistente", "x", DEFAULT_SITE).catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect(err.errorcode).toBe("invalidlogin");
  });

  it("expone la configuración pública con web services activos", async () => {
    const res = await fetch(`${DEFAULT_SITE}/lib/ajax/service.php?info=tool_mobile_get_public_config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ index: 0, methodname: "tool_mobile_get_public_config", args: {} }]),
    });
    const [r] = await res.json();
    expect(r.error).toBe(false);
    expect(r.data.enablewebservices).toBe(1);
    expect(r.data.enablemobilewebservice).toBe(1);
    expect(r.data.typeoflogin).toBe(1);
  });
});
