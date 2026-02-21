import { handleIngest } from "./api/handler";
import { handleLlmsTxt } from "./api/llmstxt";
import { createMcpFetchHandler } from "./mcp/server";
import type { Env } from "./types";

const mcpHandler = createMcpFetchHandler();

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // MCP server (stateless, no Durable Objects required)
    if (url.pathname.startsWith("/mcp")) {
      return mcpHandler(request, env, ctx);
    }

    // REST API — canonical form and URL-appended shorthand
    if (url.pathname === "/ingest" || url.pathname.startsWith("/https://")) {
      return handleIngest(request, env, ctx);
    }

    // AI discoverability
    if (url.pathname === "/llms.txt") {
      return handleLlmsTxt();
    }

    // Static assets fallthrough (Astro UI)
    return env.ASSETS.fetch(request);
  },
};
