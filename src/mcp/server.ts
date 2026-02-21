import { createMcpHandler } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ingestFromUrl } from "../engine/ingest";
import type { Env } from "../types";

/**
 * Creates a new McpServer instance with the ingest_repo tool registered.
 *
 * IMPORTANT: A new McpServer instance must be created per request.
 * The MCP SDK does not allow connecting an already-connected server
 * to a new transport.
 */
function createServer(env: Env): McpServer {
  const server = new McpServer({
    name: "GitPrism",
    version: "1.0.0",
  });

  server.registerTool(
    "ingest_repo",
    {
      description:
        "Convert a public GitHub repository or subdirectory into LLM-ready Markdown. " +
        "RECOMMENDED WORKFLOW FOR LARGE REPOS: " +
        "1. Call with detail='file-list' to get the directory structure, file sizes, and line counts. " +
        "2. Identify the relevant subdirectory from the file-list output. " +
        "3. Call again with the subdirectory URL (e.g., 'owner/repo/tree/main/src') and detail='full' to get only the files you need. " +
        "This two-step approach prevents consuming tens of thousands of tokens when calling detail='full' on an entire repository. " +
        "Detail levels: 'summary' (repo name, ref, file count), " +
        "'structure' (summary + ASCII directory tree), " +
        "'file-list' (structure + file paths with sizes and line counts; RECOMMENDED FIRST STEP), " +
        "'full' (structure + complete file contents in fenced code blocks; USE ON SUBDIRECTORIES).",
      inputSchema: {
        url: z
          .string()
          .describe(
            "GitHub URL. Examples: 'https://github.com/owner/repo', " +
              "'https://github.com/owner/repo/tree/main/src', or shorthand 'owner/repo'."
          ),
        detail: z
          .enum(["summary", "structure", "file-list", "full"])
          .default("full")
          .describe("Level of detail in the output. Defaults to 'full'."),
      },
    },
    async ({ url, detail }) => {
      try {
        const markdown = await ingestFromUrl(url, detail, env);
        return { content: [{ type: "text" as const, text: markdown }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  return server;
}

/**
 * Returns a fetch handler that processes MCP requests for the /mcp route.
 */
export function createMcpFetchHandler(): (
  request: Request,
  env: Env,
  ctx: ExecutionContext
) => Promise<Response> {
  return async (request: Request, env: Env, ctx: ExecutionContext) => {
    const server = createServer(env);
    return createMcpHandler(server, { route: "/mcp" })(request, env, ctx);
  };
}
