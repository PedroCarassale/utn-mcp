# utn-mcp

Servidor [MCP](https://modelcontextprotocol.io) para el campus virtual de la **UTN Facultad Regional La Plata** (`https://frlp.cvg.utn.edu.ar`, Moodle). Permite que un agente (Claude Code, Claude Desktop, Cursor, etc.) entre al campus **con la cuenta del usuario** y traiga apuntes, fechas, tareas, notas, novedades y mensajes, y con confirmación explícita, entregue tareas o publique en foros.

Usa la API REST oficial de Moodle con un token por usuario, igual que la app Moodle Mobile. No scrapea HTML.

## Requisitos

- Node.js 20 o superior
- Una cuenta del campus

## Instalación

```bash
git clone https://github.com/PedroCarassale/utn-mcp.git
cd utn-mcp
npm install
npm run build
```

## Iniciar sesión (una sola vez)

```bash
node dist/cli.js login
```

Pide usuario y contraseña, obtiene un token de web services y lo guarda en `~/.utn-mcp/credentials.json`. **La contraseña no se guarda.** El token se puede revocar en cualquier momento desde el campus: *Preferencias → Claves de seguridad*.

Alternativas:

```bash
node dist/cli.js login --token <token-generado-en-el-campus>
# o por variables de entorno
UTN_MOODLE_TOKEN=... UTN_MOODLE_SITE=https://frlp.cvg.utn.edu.ar node dist/cli.js serve
```

Comprobar que funciona y ver qué funciones de la API habilitó la facultad:

```bash
node dist/cli.js whoami
node dist/cli.js discover     # genera docs/functions.json
```

## Conectarlo a un agente

**Claude Code** (desde cualquier carpeta):

```bash
claude mcp add utn-mcp -- node "C:/ruta/a/utn-mcp/dist/cli.js" serve
```

Dentro de este repo ya está configurado en `.mcp.json`.

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "utn-mcp": {
      "command": "node",
      "args": ["C:/ruta/a/utn-mcp/dist/cli.js", "serve"]
    }
  }
}
```

## Tools

| Tool | Qué hace |
|---|---|
| `campus_login` / `campus_logout` / `campus_whoami` / `campus_functions` | Sesión y diagnóstico |
| `campus_list_courses` | Materias en las que está inscripto el usuario |
| `campus_course_contents` | Unidades y módulos de una materia (apuntes, tareas, foros, cuestionarios) |
| `campus_module` | Detalle de un módulo: texto de una página, consigna y estado de una tarea, archivos, hilos de un foro |
| `campus_get_file` | Descarga un apunte y devuelve su texto (PDF, DOCX, PPTX, XLSX, TXT, HTML), paginado |
| `campus_search_files` | Busca archivos por nombre en todas las materias |
| `campus_index_course` / `campus_search_content` / `campus_indexed_files` | Indexa todos los apuntes de una materia y busca dentro del contenido |
| `campus_upcoming` | Próximas fechas: entregas, cuestionarios, parciales, eventos |
| `campus_assignments` | Tareas con fechas, estado de entrega y nota |
| `campus_grades` | Notas por materia o detalle de ítems |
| `campus_announcements` / `campus_forum_discussion` | Novedades de la cátedra y lectura de hilos |
| `campus_messages` / `campus_conversation` / `campus_notifications` / `campus_search_users` | Mensajería y notificaciones |
| `campus_quizzes` | Cuestionarios, fechas, intentos y mejor nota |
| `campus_scheduler` | Turnos de consulta (si la API los expone; si no, los links) |
| `campus_submit_assignment` ⚠ | Entregar una tarea (archivos y/o texto) |
| `campus_send_message` ⚠ | Enviar un mensaje |
| `campus_forum_post` ⚠ | Responder o abrir una discusión en un foro |
| `campus_mark_notifications_read` ⚠ | Marcar notificaciones como leídas |

⚠ Las acciones de escritura requieren `confirm: true`. Sin él devuelven una vista previa y no ejecutan nada; el agente debe mostrársela al usuario y pedir confirmación.

## Datos locales

Todo vive en `~/.utn-mcp/` (configurable con `UTN_MCP_HOME`):

- `credentials.json`: token (nunca la contraseña)
- `cache/`: respuestas de la API con TTL corto
- `files/`: apuntes descargados, por materia
- `text/` e `index.json`: texto extraído e índice de búsqueda
- `actions.log`: registro local de acciones (login, entregas, mensajes, indexados)

## Desarrollo

```bash
npm run dev -- whoami      # correr el CLI desde TypeScript
npm test                   # tests unitarios
UTN_MCP_LIVE=1 npm test    # incluye pruebas contra el campus real (sin credenciales)
npm run typecheck
```

Estructura:

```
src/
  auth/token.ts        login/token.php, almacenamiento del token
  moodle/client.ts     cliente REST (flatten de args, errores, rate limit, descargas)
  moodle/api.ts        una función tipada por wsfunction
  moodle/required.ts   qué funciones necesita cada tool
  files/extract.ts     PDF/DOCX/PPTX/XLSX/ODF/HTML → texto
  store/cache.ts       caché JSON con TTL
  store/index.ts       índice full-text local
  tools/*.ts           una familia de tools por archivo
  server.ts            registro de tools e instrucciones del servidor
  cli.ts               login, whoami, discover, serve
```

Ver `PLAN.md` para el plan completo y las fases siguientes.

## Seguridad

- Un usuario por instancia; el servidor actúa en nombre del alumno, no es un bot masivo.
- El token se guarda localmente con permisos restrictivos y nunca se loguea.
- Rate limit suave (300 ms entre llamadas) y caché para no cargar el servidor de la facultad.
- Toda acción que modifica el campus pide confirmación y queda registrada en `actions.log`.
