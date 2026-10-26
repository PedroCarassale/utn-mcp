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
| `campus_draft_add` / `campus_draft_show` / `campus_draft_remove` | Armar una entrega localmente: copiar archivos a un borrador por tarea, validados contra la configuración de la tarea |
| `campus_draft_submit` ⚠ | Subir al campus una entrega armada con `campus_draft_add` |
| `campus_submit_assignment` ⚠ | Entregar una tarea en un solo paso (archivos y/o texto) |
| `campus_send_message` ⚠ | Enviar un mensaje |
| `campus_forum_post` ⚠ | Responder o abrir una discusión en un foro |
| `campus_mark_notifications_read` ⚠ | Marcar notificaciones como leídas |

⚠ Las acciones de escritura requieren `confirm: true`. Sin él devuelven una vista previa y no ejecutan nada; el agente debe mostrársela al usuario y pedir confirmación.

## Modo remoto (público, solo lectura)

Además del modo local por stdio, el servidor puede correr como servicio HTTP para que cualquiera lo agregue como conector remoto (claude.ai, Claude Code, Cursor) sin instalar nada.

- **Transporte:** Streamable HTTP sin sesiones, en `/mcp`.
- **Autenticación:** OAuth 2.1 con registro dinámico de clientes y PKCE. Al conectar, el usuario inicia sesión con su cuenta del campus en `/authorize`; el servidor pide un token a Moodle y lo entrega **cifrado** (AES-256-GCM) como access token. No hay base de datos: client_id, códigos y tokens son blobs sellados con `UTN_MCP_SECRET`. La contraseña no se guarda.
- **Solo lectura:** no se registran `campus_login`, `campus_logout`, `campus_submit_assignment`, `campus_send_message`, `campus_forum_post` ni `campus_mark_notifications_read`, ni las de borradores de entrega (`campus_draft_*`), que leen archivos del disco del usuario.
- **Datos:** caché, apuntes e índice van a un directorio temporal por usuario (`UTN_MCP_DATA_DIR`, default `/tmp/utn-mcp`). En serverless se pierden cuando se recicla la instancia.

Variables de entorno:

| Variable | Obligatoria | Qué es |
|---|---|---|
| `UTN_MCP_SECRET` | sí | Clave para sellar tokens, ≥ 32 caracteres (`openssl rand -base64 48`). Cambiarla cierra todas las sesiones. |
| `PUBLIC_URL` | no | URL pública (issuer OAuth). En Vercel se toma de `VERCEL_PROJECT_PRODUCTION_URL`. |
| `UTN_MOODLE_SITE` | no | Campus a usar. Default `https://frlp.cvg.utn.edu.ar` |
| `UTN_MCP_DATA_DIR` | no | Directorio de caché por usuario |

Probarlo local:

```bash
UTN_MCP_SECRET=$(openssl rand -base64 48) node dist/cli.js serve-http --port 3000
claude mcp add --transport http utn-remoto http://localhost:3000/mcp
```

### Deploy en Vercel

1. Importar el repo en Vercel (sin framework; `vercel.json` ya define build, rewrites y la función `api/index.js`).
2. Cargar `UTN_MCP_SECRET` en *Settings → Environment Variables*.
3. Deployar. La URL del conector es `https://<proyecto>.vercel.app/mcp`.

Límites a tener en cuenta: la función corre como máximo 60 s y los apuntes muy grandes (más de ~10 MB) pueden no llegar a procesarse.

## Datos locales

Todo vive en `~/.utn-mcp/` (configurable con `UTN_MCP_HOME`):

- `credentials.json`: token (nunca la contraseña)
- `cache/`: respuestas de la API con TTL corto
- `files/`: apuntes descargados, por materia
- `text/` e `index.json`: texto extraído e índice de búsqueda
- `drafts/`: entregas en preparación, una carpeta por tarea con la copia de los archivos
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
  remote/app.ts        modo remoto: Express, OAuth y /mcp sin sesiones
  remote/oauth.ts      proveedor OAuth sin estado (login con la cuenta del campus)
  remote/seal.ts       cifrado de tokens con UTN_MCP_SECRET
  server.ts            registro de tools e instrucciones del servidor
  cli.ts               login, whoami, discover, serve, serve-http
api/index.js           entrada de Vercel
```

Ver `PLAN.md` para el plan completo y las fases siguientes.

## Seguridad

- En modo local, un usuario por instancia; el servidor actúa en nombre del alumno, no es un bot masivo.
- En modo remoto cada pedido usa el token del usuario que lo hace, con caché separada por usuario, y solo hay tools de lectura.
- El token se guarda localmente con permisos restrictivos y nunca se loguea.
- Rate limit suave (300 ms entre llamadas) y caché para no cargar el servidor de la facultad.
- Toda acción que modifica el campus pide confirmación y queda registrada en `actions.log`.
