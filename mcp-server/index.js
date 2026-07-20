#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTerritorioTools } from "./tools.js";

const server = new McpServer({
  name: "territorios-mcp-server",
  version: "1.0.0"
});

registerTerritorioTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Servidor MCP de territorios corriendo (stdio)");
}

main().catch((error) => {
  console.error("Error al arrancar el servidor:", error);
  process.exit(1);
});
