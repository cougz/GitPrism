import { handleIngest } from "./api/handler";
import { handleLlmsTxt } from "./api/llmstxt";
import { createMcpFetchHandler } from "./mcp/server";
import type { Env } from "./types";

const mcpHandler = createMcpFetchHandler();

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    // Decode once — browsers may percent-encode characters like the colon in https%3A
    const pathname = decodeURIComponent(url.pathname);

    // MCP server (stateless, no Durable Objects required)
    if (pathname.startsWith("/mcp")) {
      return mcpHandler(request, env, ctx);
    }

    // REST API — canonical form and URL-appended shorthand
    // Also handle https%3A encoded forms (e.g. from copy-paste in some clients)
    if (pathname === "/ingest" || pathname.startsWith("/https://")) {
      return handleIngest(request, env, ctx);
    }

    // AI discoverability
    if (pathname === "/llms.txt") {
      return handleLlmsTxt();
    }

    // Static assets fallthrough (Astro UI)
    return env.ASSETS.fetch(request);
  },
};
