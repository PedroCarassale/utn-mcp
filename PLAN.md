# Plan: Campus Virtual UTN La Plata agéntico (MCP)

Fecha: 2026-10-20

## 1. Qué hay del otro lado (verificado)

Se probaron endpoints públicos de https://frlp.cvg.utn.edu.ar sin credenciales:

| Dato | Valor | Implicancia |
|---|---|---|
| Plataforma | **Moodle**, 4.5+ (usa `core\exception\moodle_exception`, `qbank_*`) | API REST oficial y documentada, no hace falta scraping para lo principal |
| `enablewebservices` | 1 | El servidor acepta llamadas REST con token |
| `enablemobilewebservice` | 1 | El servicio `moodle_mobile_app` está activo: cualquier usuario puede obtener un token con su usuario y contraseña |
| `typeoflogin` | 1 | Login clásico usuario/contraseña, **sin SSO**. `login/token.php` funciona directo |
| `authloginviaemail` | 1 | Se puede loguear con mail o usuario |
| Plugins visibles | `mod_scheduler` (turnos/citas), `mod_quiz`, `atto`, `tool_lp` | Hay turnos para consultas, cuestionarios, competencias |
| Idioma | es | Mensajes de error en español |

Conclusión: **el 80 % del trabajo es un cliente REST de Moodle envuelto como MCP server**. Scraping o browser automation queda como fallback para lo que la API no exponga.

## 2. Arquitectura

```
Claude / agente  ──MCP (stdio o HTTP)──►  utn-campus-mcp
                                              │
                      ┌───────────────────────┼─────────────────────────┐
                      ▼                       ▼                         ▼
              Moodle REST WS           pluginfile.php            Fallback web
         (webservice/rest/server.php)   (descarga archivos      (cookie MoodleSession
          token del usuario              con ?token=)            + fetch HTML) solo si
                                                                 la API no alcanza
                      │                       │
                      ▼                       ▼
               caché JSON local         caché de archivos
            (cursos, calendario,       (~/.utn-campus/files)
             contenidos, diff)          + extracción de texto
                                        (PDF, DOCX, PPTX)
```

Componentes del servidor MCP:

1. **auth**: obtiene y guarda el token del usuario. Nunca persiste la contraseña.
2. **moodle-client**: wrapper tipado de `wsfunction`s, manejo de errores de Moodle, reintentos, rate limit suave.
3. **tools**: herramientas MCP de alto nivel orientadas a lo que pide un alumno, no espejo 1:1 de la API.
4. **files**: descarga de recursos con token, caché y conversión a texto para que el agente pueda leer apuntes.
5. **store**: estado local para detectar novedades (nuevos archivos, nuevas fechas, nuevas notas).

Stack propuesto: **TypeScript + `@modelcontextprotocol/sdk`**, transporte stdio (Claude Desktop, Claude Code, Cursor). HTTP remoto con OAuth queda para una etapa posterior si se quiere servir a varios usuarios.

## 3. Autenticación: cómo el usuario le da su cuenta al agente

Flujo elegido (el que usa la app oficial Moodle Mobile):

1. El usuario corre una vez `utn-campus-mcp login` (o la tool `campus_login`).
2. El server hace `POST /login/token.php` con `username`, `password`, `service=moodle_mobile_app`.
3. Moodle devuelve un `token` (y `privatetoken`). Se guarda en el keychain del sistema o en un archivo con permisos 600 en `~/.utn-campus/`.
4. La contraseña se descarta en memoria. Todas las llamadas siguientes usan solo el token.
5. El usuario puede revocar el token desde Moodle: *Preferencias → Claves de seguridad*.

Alternativa sin pasar la contraseña por el agente: el usuario copia el token manualmente desde *Preferencias → Claves de seguridad* y lo pega en la config del MCP. Soportar ambas.

Verificación obligatoria al inicio: `core_webservice_get_site_info` devuelve `functions`, la lista exacta de funciones habilitadas para el servicio móvil en esta instancia. **Ese listado define qué tools son viables** y hay que correrlo con una cuenta real antes de implementar nada.

## 4. Tools MCP por fase

### Fase 0: fundamentos (1 semana)
- Scaffold del repo, cliente REST, login, `campus_whoami`.
- Script de descubrimiento: imprime las funciones disponibles y cuántos cursos ve el usuario.
- Prueba manual con cuenta real.

### Fase 1: lectura, lo que da valor inmediato (2 semanas)

| Tool MCP | Función(es) Moodle | Para qué |
|---|---|---|
| `campus_list_courses` | `core_enrol_get_users_courses` | Materias en las que está inscripto |
| `campus_course_contents` | `core_course_get_contents` | Secciones, recursos, tareas, foros de una materia |
| `campus_get_file` | `pluginfile.php?token=` + `mod_resource_get_resources_by_courses`, `mod_folder_get_folders_by_courses` | Bajar un apunte y devolverlo como texto o ruta local |
| `campus_search_files` | sobre caché de `core_course_get_contents` | "Traeme el apunte de la unidad 3 de Análisis" |
| `campus_upcoming` | `core_calendar_get_action_events_by_timesort`, `core_calendar_get_calendar_events` | Fechas de entrega, parciales, eventos próximos |
| `campus_assignments` | `mod_assign_get_assignments`, `mod_assign_get_submission_status` | Tareas, estado de entrega, nota |
| `campus_grades` | `gradereport_user_get_grade_items`, `gradereport_overview_get_course_grades` | Notas por materia |
| `campus_announcements` | `mod_forum_get_forums_by_courses`, `mod_forum_get_forum_discussions` | Foro de novedades de la cátedra |
| `campus_messages` | `core_message_get_conversations`, `core_message_get_messages` | Mensajes privados |
| `campus_notifications` | `message_popup_get_popup_notifications` | Notificaciones del campus |
| `campus_quizzes` | `mod_quiz_get_quizzes_by_courses`, `mod_quiz_get_user_attempts` | Cuestionarios, intentos, fechas |
| `campus_scheduler` | `mod_scheduler_*` si está expuesto; si no, fallback HTML | Turnos de consulta |

### Fase 2: lectura profunda y escritura controlada (2 a 3 semanas)
- Extracción de texto de PDF, DOCX, PPTX descargados (pdf-parse / mammoth / etc.) para que el agente resuma apuntes sin que el usuario abra nada.
- Índice local de materiales por materia y unidad.
- Escritura, **siempre con confirmación explícita del usuario** antes de ejecutar:
  - `campus_submit_assignment`: `mod_assign_save_submission` + `core_files_upload`.
  - `campus_send_message`: `core_message_send_instant_messages`.
  - `campus_mark_read`: `core_message_mark_all_notifications_as_read`.
  - `campus_forum_post`: `mod_forum_add_discussion_post`.

### Fase 3: proactividad y resto del "universo facultad" (abierto)
- **Novedades**: tarea programada que compara snapshot de contenidos y calendario y avisa "subieron un apunte nuevo en Física II" o "cambió la fecha del parcial".
- **Resumen diario o semanal** vía Claude Code `/schedule` o un cron.
- **Mailing institucional**: conectar el MCP de Gmail/Outlook del usuario y cruzar mails de la facultad con el calendario del campus.
- **Otros sistemas** (autogestión/SysAcad, inscripción a finales): investigar si tienen API; si no, mismo patrón con fallback de browser automation. Pendiente de relevar.

## 5. Fallback cuando la API no alcanza

Orden de preferencia por cada función:
1. Web service REST con token (rápido, estable, oficial).
2. Fetch HTML con cookie `MoodleSession` (login por formulario, parseo con cheerio). Útil para plugins sin WS como podría ser `mod_scheduler`.
3. Browser automation (Playwright) solo para flujos con JavaScript pesado.

Cada tool declara qué camino usa; se mide cuántas quedan en 2 o 3 para decidir si vale pedirle a la facultad habilitar funciones extra.

## 6. Seguridad y buenas prácticas

- Token por usuario, almacenado localmente, nunca en el repo ni en logs.
- Contraseña solo en memoria durante el login.
- Toda acción que modifique estado en el campus requiere confirmación del usuario en el mismo turno.
- Descargas solo a una carpeta del usuario; nombres sanitizados.
- Rate limit suave (p. ej. 2 req/s) y caché agresiva para no castigar el servidor de la facultad.
- Respetar el reglamento de uso del campus: es la cuenta del alumno actuando en su nombre, no un bot masivo. Un solo usuario por instancia del MCP.
- Loguear localmente qué hizo el agente (auditoría para el propio usuario).

## 7. Estructura del repo

```
utn-campus-mcp/
  src/
    index.ts            # arranque MCP (stdio)
    auth/token.ts       # login/token.php, keychain
    moodle/client.ts    # llamadas REST tipadas
    moodle/types.ts
    tools/              # una tool por archivo
    files/download.ts
    files/extract.ts    # PDF/DOCX/PPTX -> texto
    store/cache.ts
  scripts/discover.ts   # lista funciones disponibles y cursos
  test/
  README.md
```

## 8. Riesgos

| Riesgo | Mitigación |
|---|---|
| El admin deshabilita el servicio móvil o funciones puntuales | Fase 0 lo detecta; fallback HTML; eventualmente hablar con la facultad |
| Funciones ausentes en el servicio móvil (p. ej. `mod_scheduler`) | Fallback HTML por tool |
| Archivos grandes (videos) | Límite de tamaño, solo metadatos para multimedia |
| Cambios de versión de Moodle | Las WS son estables entre versiones; tests contra la instancia real |
| Token filtrado | Revocación desde Moodle, almacenamiento en keychain |

## 9. Estado (2026-10-20)

| Fase | Estado |
|---|---|
| Fase 0: scaffold, login, cliente REST, `discover` | **Hecha** |
| Fase 1: tools de lectura (cursos, contenidos, archivos, calendario, tareas, notas, foros, mensajes, notificaciones, cuestionarios, scheduler) | **Hecha**, pendiente validar contra cuenta real |
| Fase 2: extracción PDF/DOCX/PPTX/XLSX, índice local full-text, escritura con confirmación (entregar tarea, mensaje, foro, marcar leídas) | **Hecha**, pendiente validar contra cuenta real |
| Fase 3: novedades, resumen programado, mailing, otros sistemas | Pendiente |

Lo que falta para cerrar Fases 1 y 2: correr `node dist/cli.js login` y `node dist/cli.js discover` con la cuenta del usuario, y ajustar las tools según las funciones que falten (ver `docs/functions.json`).

## 10. Próximos pasos inmediatos

1. `node dist/cli.js login` con la cuenta real y `node dist/cli.js discover`.
2. Probar desde Claude Code cada tool contra el campus y corregir diferencias de formato.
3. Si `mod_scheduler` no está en la API, implementar el fallback HTML con cookie de sesión.
4. Arrancar Fase 3: snapshot de contenidos y calendario para detectar novedades, y resumen programado.
