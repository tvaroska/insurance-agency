import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server";
import { prisma } from "./prisma";

const server = createServer(prisma);
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Comm MCP server running on stdio");
