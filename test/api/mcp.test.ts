import { describe, it, expect, vi } from "vitest";
import worker from "../../src/index";
import type { Env } from "../../src/types";
import { zipSync, strToU8 } from "fflate";

// Stub out caches to avoid miniflare isolated storage issues
vi.stubGlobal("caches", {
  default: {
    match: vi.fn().mockResolvedValue(undefined),
    put: vi.fn().mockResolvedValue(undefined),
  },
});

function makeEnv(): Env {
  return {
    GITHUB_TOKEN: undefined,
    ASSETS: {
      fetch: vi.fn().mockResolvedValue(new Response("<html>", { status: 200 })),
    } as unknown as Fetcher,
    RATE_LIMITER: {
      limit: vi.fn().mockResolvedValue({ success: true }),
    } as unknown as RateLimit,
    MAX_ZIP_BYTES: "52428800",
    MAX_OUTPUT_BYTES: "10485760",
    MAX_FILE_COUNT: "5000",
    CACHE_TTL_SECONDS: "3600",
  };
}

function makeCtx(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext;
}

describe("MCP endpoint", () => {
  it("responds to MCP initialization request with a valid HTTP response", async () => {
    const initRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0" },
      },
    };

    const req = new Request("https://gitprism.dev/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(initRequest),
    });

    const res = await worker.fetch(req, makeEnv(), makeCtx());
    // MCP handler should return any valid HTTP response (not 501 which was the old stub)
    expect(res.status).not.toBe(501);
    // Should be a well-formed HTTP response
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(600);
  });

  it("responds to MCP tools/list request with a valid HTTP response", async () => {
    const toolsListRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    };

    const req = new Request("https://gitprism.dev/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "mcp-session-id": "test-session-123",
      },
      body: JSON.stringify(toolsListRequest),
    });

    const res = await worker.fetch(req, makeEnv(), makeCtx());
    expect(res.status).not.toBe(501);
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(600);
  });

  it("does not route /mcp to static assets", async () => {
    const env = makeEnv();
    const req = new Request("https://gitprism.dev/mcp", { method: "GET" });
    const res = await worker.fetch(req, env, makeCtx());
    // ASSETS.fetch should not have been called
    expect((env.ASSETS.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it("returns ingest_repo tool with recommended workflow guidance in description", async () => {
    const toolsListRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    };

    const req = new Request("https://gitprism.dev/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "mcp-session-id": "test-session-123",
      },
      body: JSON.stringify(toolsListRequest),
    });

    const res = await worker.fetch(req, makeEnv(), makeCtx());
    const text = await res.text();
    
    // Parse SSE format
    const lines = text.split('\n').filter((line: string) => line.startsWith('data: '));
    const events = lines.map((line: string) => JSON.parse(line.substring(6)));
    
    // Find the tools/list result
    const toolsListEvent = events.find((e: any) => e.result?.tools);
    expect(toolsListEvent).toBeDefined();
    
    expect(toolsListEvent.result.tools).toBeDefined();
    const ingestRepoTool = toolsListEvent.result.tools.find((t: any) => t.name === "ingest_repo");
    expect(ingestRepoTool).toBeDefined();
    
    // Verify the description contains the recommended workflow guidance
    expect(ingestRepoTool!.description).toContain("RECOMMENDED WORKFLOW FOR LARGE REPOS");
    expect(ingestRepoTool!.description).toContain("detail='file-list'");
    expect(ingestRepoTool!.description).toContain("two-step approach");
    expect(ingestRepoTool!.description).toContain("tens of thousands of tokens");
    expect(ingestRepoTool!.description).toContain("USE ON SUBDIRECTORIES");
  });
});
