import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AppContext } from "./context.js";
import { registerAuthTools } from "./tools/auth.js";
import { registerCourseTools } from "./tools/courses.js";
import { registerFileTools } from "./tools/files.js";
import { registerCalendarTools } from "./tools/calendar.js";
import { registerAssignmentTools } from "./tools/assignments.js";
import { registerGradeTools } from "./tools/grades.js";
import { registerForumTools } from "./tools/forums.js";
import { registerMessageTools } from "./tools/messages.js";
import { registerQuizTools } from "./tools/quizzes.js";

export const SERVER_VERSION = "0.1.0";

export const INSTRUCTIONS = `Servidor MCP del campus virtual (Moodle) de la UTN Facultad Regional La Plata.
Actúa con la cuenta del usuario. Flujo típico: campus_whoami → campus_list_courses → campus_course_contents / campus_upcoming / campus_assignments → campus_get_file para leer apuntes.
Para buscar dentro del contenido de los apuntes: campus_index_course una vez por materia y después campus_search_content.
Las tools marcadas como ACCIÓN DE ESCRITURA (entregar tarea, enviar mensaje, publicar en foro, marcar leídas) requieren confirm=true, y solo debés pasarlo después de mostrarle al usuario exactamente qué se va a hacer y recibir su confirmación explícita.
Si una tool responde que no hay sesión o que el token venció, pedile al usuario que ejecute \`utn-mcp login\` en su terminal.
Las fechas se muestran en hora de Argentina.`;

export function createServer(ctx: AppContext = new AppContext()): McpServer {
  const server = new McpServer(
    { name: "utn-mcp", version: SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );
  registerAuthTools(server, ctx);
  registerCourseTools(server, ctx);
  registerFileTools(server, ctx);
  registerCalendarTools(server, ctx);
  registerAssignmentTools(server, ctx);
  registerGradeTools(server, ctx);
  registerForumTools(server, ctx);
  registerMessageTools(server, ctx);
  registerQuizTools(server, ctx);
  return server;
}
