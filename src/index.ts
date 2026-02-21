import { handleIngest } from "./api/handler";
import { handleLlmsTxt } from "./api/llmstxt";
import type { Env } from "./types";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // MCP server (Phase 2 — stub until implemented)
    if (url.pathname.startsWith("/mcp")) {
      // Will be replaced in Phase 2
      return new Response(
        JSON.stringify({ error: "MCP endpoint not yet configured" }),
        { status: 501, headers: { "Content-Type": "application/json" } }
      );
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
