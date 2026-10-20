#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

/** Arranca el servidor MCP por stdio. No escribir nada a stdout salvo el protocolo. */
export async function serve(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[utn-mcp] servidor MCP listo (stdio)");
}

const isMain = process.argv[1] && /index\.(js|ts)$/.test(process.argv[1]);
if (isMain) {
  serve().catch((err) => {
    console.error("[utn-mcp] error fatal:", err);
    process.exit(1);
  });
}
