/** Páginas HTML mínimas del modo remoto: login del campus, mensajes y portada. */

function esc(s: string | undefined): string {
  return (s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const STYLE = `
:root { color-scheme: light dark; --bg:#f6f7f9; --card:#fff; --fg:#1b1f24; --muted:#5b6470; --accent:#0b5cad; --err:#b42318; --border:#d9dee5; }
@media (prefers-color-scheme: dark) { :root { --bg:#111418; --card:#1a1f25; --fg:#e8ebef; --muted:#9aa4b0; --accent:#5aa3f0; --err:#f97066; --border:#2c333b; } }
* { box-sizing: border-box; }
body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--fg); font:16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; padding:16px; }
main { width:100%; max-width:420px; background:var(--card); border:1px solid var(--border); border-radius:12px; padding:28px; }
h1 { font-size:1.3rem; margin:0 0 4px; }
p { margin:8px 0; }
.muted { color:var(--muted); font-size:.9rem; }
label { display:block; margin-top:16px; font-weight:600; font-size:.95rem; }
input { width:100%; margin-top:6px; padding:10px 12px; font:inherit; color:inherit; background:transparent; border:1px solid var(--border); border-radius:8px; }
button { width:100%; margin-top:20px; padding:11px; font:inherit; font-weight:600; color:#fff; background:var(--accent); border:0; border-radius:8px; cursor:pointer; }
.error { color:var(--err); margin-top:12px; }
code { font-size:.9em; }
`;

function layout(title: string, body: string): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${STYLE}</style></head><body><main>${body}</main></body></html>`;
}

export function loginPage(opts: { action: string; pending: string; site: string; clientName?: string; username?: string; error?: string }): string {
  const who = opts.clientName ? `<strong>${esc(opts.clientName)}</strong>` : "Una aplicación";
  return layout(
    "Campus UTN FRLP",
    `<h1>Conectar el campus UTN FRLP</h1>
<p class="muted">${who} quiere leer tu información del campus (${esc(opts.site.replace(/^https?:\/\//, ""))}): materias, apuntes, fechas, tareas y notas. Solo lectura.</p>
<form method="post" action="${esc(opts.action)}">
  <input type="hidden" name="pending" value="${esc(opts.pending)}">
  <label for="u">Usuario o email del campus</label>
  <input id="u" name="username" autocomplete="username" required value="${esc(opts.username)}">
  <label for="p">Contraseña</label>
  <input id="p" name="password" type="password" autocomplete="current-password" required>
  ${opts.error ? `<p class="error">${esc(opts.error)}</p>` : ""}
  <button type="submit">Conectar</button>
</form>
<p class="muted">Tu contraseña se usa una sola vez para pedirle un token al campus, igual que la app Moodle Mobile, y no se guarda. Podés revocar el acceso cuando quieras desde el campus en <em>Preferencias → Claves de seguridad</em>.</p>`,
  );
}

export function messagePage(title: string, text: string): string {
  return layout(title, `<h1>${esc(title)}</h1><p>${esc(text)}</p>`);
}

export function homePage(mcpUrl: string): string {
  return layout(
    "utn-mcp",
    `<h1>utn-mcp</h1>
<p>Servidor MCP de solo lectura para el campus virtual de la UTN Facultad Regional La Plata.</p>
<p>Agregalo como conector remoto en tu cliente MCP con esta URL:</p>
<p><code>${esc(mcpUrl)}</code></p>
<p class="muted">Al conectarlo te va a pedir iniciar sesión con tu cuenta del campus.</p>`,
  );
}
