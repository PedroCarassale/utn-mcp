import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AppContext } from "./context.js";
import { registerAuthTools } from "./tools/auth.js";
import { registerCourseTools } from "./tools/courses.js";
import { registerFileTools } from "./tools/files.js";
import { registerCalendarTools } from "./tools/calendar.js";
import { registerAssignmentTools } from "./tools/assignments.js";
import { registerDraftTools } from "./tools/drafts.js";
import { registerGradeTools } from "./tools/grades.js";
import { registerForumTools } from "./tools/forums.js";
import { registerMessageTools } from "./tools/messages.js";
import { registerQuizTools } from "./tools/quizzes.js";

export const SERVER_VERSION = "0.1.0";

export const INSTRUCTIONS = `Servidor MCP del campus virtual (Moodle) de la UTN Facultad Regional La Plata.
Actúa con la cuenta del usuario. Flujo típico: campus_whoami → campus_list_courses → campus_course_contents / campus_upcoming / campus_assignments → campus_get_file para leer apuntes.
Para buscar dentro del contenido de los apuntes: campus_index_course una vez por materia y después campus_search_content.
Para entregar una tarea con archivos que indique el usuario: campus_draft_add (se puede llamar varias veces) → campus_draft_show → campus_draft_submit.
Las tools marcadas como ACCIÓN DE ESCRITURA (entregar tarea, enviar mensaje, publicar en foro, marcar leídas) requieren confirm=true, y solo debés pasarlo después de mostrarle al usuario exactamente qué se va a hacer y recibir su confirmación explícita.
Si una tool responde que no hay sesión o que el token venció, pedile al usuario que ejecute \`utn-mcp login\` en su terminal.
Las fechas se muestran en hora de Argentina.`;

export const REMOTE_INSTRUCTIONS = `Servidor MCP del campus virtual (Moodle) de la UTN Facultad Regional La Plata, versión pública de solo lectura.
Actúa con la cuenta del usuario que conectó el servidor. Flujo típico: campus_whoami → campus_list_courses → campus_course_contents / campus_upcoming / campus_assignments → campus_get_file para leer apuntes.
Para buscar dentro del contenido de los apuntes: campus_index_course una vez por materia y después campus_search_content. El índice es temporal: si la búsqueda no encuentra nada, volvé a indexar.
Esta versión no puede entregar tareas, enviar mensajes ni publicar en foros.
Si una tool responde que no hay sesión o que el token venció, pedile al usuario que desconecte y vuelva a conectar el servidor.
Las fechas se muestran en hora de Argentina.`;

/** Tools que modifican algo en el campus o en las credenciales locales. */
export const WRITE_TOOLS = new Set([
  "campus_login",
  "campus_logout",
  "campus_submit_assignment",
  "campus_send_message",
  "campus_forum_post",
  "campus_mark_notifications_read",
]);

/** Tools que trabajan con archivos del disco del usuario; no tienen sentido en el modo remoto. */
export const LOCAL_TOOLS = new Set(["campus_draft_add", "campus_draft_show", "campus_draft_remove", "campus_draft_submit"]);

export interface ServerOptions {
  /** No registra las tools de WRITE_TOOLS ni LOCAL_TOOLS y usa las instrucciones del modo remoto. */
  readOnly?: boolean;
  /** Se llama cada vez que un cliente ejecuta una tool (métricas). Se espera junto con la tool. */
  onToolCall?: (name: string) => Promise<void>;
}

/**
 * Devuelve una vista del servidor que ignora el registro de las tools de `skip`
 * y, si hay `onToolCall`, lo avisa en cada ejecución de las demás.
 */
function interceptTools(server: McpServer, skip: Set<string>, onToolCall?: (name: string) => Promise<void>): McpServer {
  return new Proxy(server, {
    get(target, prop, receiver) {
      if (prop === "registerTool") {
        return (name: string, ...rest: unknown[]) => {
          if (skip.has(name)) return undefined;
          const handler = rest.at(-1);
          if (onToolCall && typeof handler === "function") {
            rest[rest.length - 1] = async (...args: unknown[]) => {
              const tracked = onToolCall(name);
              try {
                return await handler(...args);
              } finally {
                await tracked;
              }
            };
          }
          return (target.registerTool as (...a: unknown[]) => unknown)(name, ...rest);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function createServer(ctx: AppContext = new AppContext(), opts: ServerOptions = {}): McpServer {
  const server = new McpServer(
    { name: "utn-mcp", version: SERVER_VERSION },
    { instructions: opts.readOnly ? REMOTE_INSTRUCTIONS : INSTRUCTIONS },
  );
  const skip = opts.readOnly ? new Set([...WRITE_TOOLS, ...LOCAL_TOOLS]) : new Set<string>();
  const target = skip.size > 0 || opts.onToolCall ? interceptTools(server, skip, opts.onToolCall) : server;
  registerAuthTools(target, ctx);
  registerCourseTools(target, ctx);
  registerFileTools(target, ctx);
  registerCalendarTools(target, ctx);
  registerAssignmentTools(target, ctx);
  registerDraftTools(target, ctx);
  registerGradeTools(target, ctx);
  registerForumTools(target, ctx);
  registerMessageTools(target, ctx);
  registerQuizTools(target, ctx);
  return server;
}
