import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ok } from "../context.js";

export const CONFIRM_DESCRIPTION =
  "Debe ser true para ejecutar. Solo pasá true después de que el usuario haya confirmado explícitamente ESTA acción en la conversación. Sin confirm se devuelve una vista previa.";

/** Si falta confirmación, devuelve una vista previa en vez de ejecutar. */
export function needsConfirmation(confirm: boolean | undefined, preview: Record<string, unknown>): CallToolResult | null {
  if (confirm === true) return null;
  return ok({
    executed: false,
    message: "Acción NO ejecutada: falta confirmación del usuario. Mostrale esta vista previa, pedile confirmación y volvé a llamar con confirm=true.",
    preview,
  });
}
