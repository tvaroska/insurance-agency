import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server";
import { db } from "./db";

const server = createServer(db);
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Comm MCP server running on stdio");
