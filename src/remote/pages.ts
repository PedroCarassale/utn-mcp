/** Páginas HTML mínimas del modo remoto: login del campus, mensajes y portada. */

function esc(s: string | undefined): string {
  return (s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const STYLE = `
:root { color-scheme: light dark; --bg:#fff; --fg:#0a0a0a; --muted:#6b6b6b; --subtle:#f4f4f4; --border:#e3e3e3; --ring:#0a0a0a; --btn-fg:#fff; --err:#d92d20; }
@media (prefers-color-scheme: dark) { :root { --bg:#000; --fg:#fafafa; --muted:#8f8f8f; --subtle:#111; --border:#262626; --ring:#fafafa; --btn-fg:#000; --err:#ff6b5e; } }
* { box-sizing: border-box; }
body { margin:0; min-height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center; background:var(--bg); color:var(--fg); font:15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; padding:48px 16px; -webkit-font-smoothing:antialiased; }
main { width:100%; max-width:360px; }
.brand { display:flex; align-items:center; gap:12px; margin-bottom:40px; }
.brand svg { height:36px; width:auto; fill:var(--fg); }
.brand span { display:flex; flex-direction:column; padding-left:12px; border-left:1px solid var(--border); font-size:.78rem; line-height:1.3; color:var(--muted); }
.brand strong { color:var(--fg); font-size:.95rem; letter-spacing:.02em; }
h1 { font-size:1.6rem; line-height:1.2; letter-spacing:-.02em; font-weight:650; margin:0 0 8px; }
p { margin:8px 0; }
.muted { color:var(--muted); }
.small { font-size:.82rem; }
.scope { margin:24px 0 8px; padding:14px 16px; background:var(--subtle); border:1px solid var(--border); border-radius:10px; font-size:.88rem; }
.scope ul { list-style:none; margin:10px 0 0; padding:0; display:grid; gap:6px; }
.scope li { display:flex; align-items:center; gap:8px; color:var(--muted); }
.scope li svg { flex:none; width:14px; height:14px; stroke:var(--fg); }
label { display:block; margin:20px 0 6px; font-weight:550; font-size:.85rem; }
input { width:100%; height:44px; padding:0 14px; font:inherit; color:inherit; background:var(--bg); border:1px solid var(--border); border-radius:8px; outline:none; transition:border-color .15s, box-shadow .15s; }
input:hover { border-color:var(--muted); }
input:focus { border-color:var(--ring); box-shadow:0 0 0 3px color-mix(in srgb, var(--ring) 15%, transparent); }
button { width:100%; height:44px; margin-top:24px; font:inherit; font-weight:600; color:var(--btn-fg); background:var(--fg); border:0; border-radius:8px; cursor:pointer; transition:opacity .15s; }
button:hover { opacity:.85; }
button:focus-visible { outline:2px solid var(--ring); outline-offset:2px; }
.error { margin:8px 0 0; color:var(--err); font-size:.85rem; }
input[aria-invalid="true"] { border-color:var(--err); }
.note { margin-top:28px; padding-top:20px; border-top:1px solid var(--border); }
code { display:block; margin:12px 0; padding:12px 14px; background:var(--subtle); border:1px solid var(--border); border-radius:8px; font:.85rem/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; word-break:break-all; }
footer { margin-top:48px; font-size:.78rem; color:var(--muted); }
`;

/** Emblema de la UTN: barra vertical, barra horizontal y dos medios anillos. */
const EMBLEM = `<svg viewBox="0 0 100 120" role="img" aria-label="UTN"><path d="M39 0h22v120H39z"/><path d="M0 49h100v22H0z"/><path d="M0 0A50 50 0 0 0 100 0H78A28 28 0 0 1 22 0Z"/><path d="M0 120A50 50 0 0 1 100 120H78A28 28 0 0 0 22 120Z"/></svg>`;

const CHECK = `<svg viewBox="0 0 16 16" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3 3 7-7"/></svg>`;

function layout(title: string, body: string): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${STYLE}</style></head><body><main><div class="brand">${EMBLEM}<span><strong>UTN FRLP</strong>Campus virtual</span></div>${body}</main><footer>Universidad Tecnológica Nacional · Facultad Regional La Plata</footer></body></html>`;
}

export function loginPage(opts: { action: string; pending: string; site: string; clientName?: string; username?: string; error?: string }): string {
  const who = opts.clientName ? `<strong>${esc(opts.clientName)}</strong>` : "Una aplicación";
  const focus = opts.username ? ["", " autofocus"] : [" autofocus", ""];
  const scope = ["Materias y apuntes", "Fechas y tareas", "Notas"].map((s) => `<li>${CHECK}${s}</li>`).join("");
  return layout(
    "Iniciar sesión · Campus UTN FRLP",
    `<h1>Iniciá sesión en el campus</h1>
<p class="muted">Usá tu cuenta de ${esc(opts.site.replace(/^https?:\/\//, ""))}.</p>
<div class="scope">${who} quiere acceso de <strong>solo lectura</strong> a:<ul>${scope}</ul></div>
<form method="post" action="${esc(opts.action)}">
  <input type="hidden" name="pending" value="${esc(opts.pending)}">
  <label for="u">Usuario o email</label>
  <input id="u" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required${focus[0]} value="${esc(opts.username)}">
  <label for="p">Contraseña</label>
  <input id="p" name="password" type="password" autocomplete="current-password" required${focus[1]}${opts.error ? ' aria-invalid="true" aria-describedby="err"' : ""}>
  ${opts.error ? `<p class="error" id="err" role="alert">${esc(opts.error)}</p>` : ""}
  <button type="submit">Conectar</button>
</form>
<p class="note muted small">Tu contraseña se usa una sola vez para pedirle un token al campus, igual que la app Moodle Mobile, y no se guarda. Podés revocar el acceso cuando quieras desde el campus en <em>Preferencias → Claves de seguridad</em>.</p>`,
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
<p class="muted small">Al conectarlo te va a pedir iniciar sesión con tu cuenta del campus.</p>`,
  );
}
