import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import worker from "../../src/index";
import type { Env } from "../../src/types";

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

describe("Worker routing", () => {
  it("routes /llms.txt to llmstxt handler", async () => {
    const req = new Request("https://gitprism.dev/llms.txt");
    const res = await worker.fetch(req, makeEnv(), makeCtx());
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    const text = await res.text();
    expect(text).toContain("GitPrism");
  });

  it("routes /mcp to the MCP handler (not static assets)", async () => {
    const env = makeEnv();
    const req = new Request("https://gitprism.dev/mcp");
    const res = await worker.fetch(req, env, makeCtx());
    // MCP handler is now live — it returns valid HTTP (not 501 stub, not proxied to ASSETS)
    expect(res.status).not.toBe(501);
    // ASSETS.fetch should not have been called for /mcp
    expect((env.ASSETS.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it("routes /ingest to API handler (returns 400 for missing params)", async () => {
    const req = new Request("https://gitprism.dev/ingest");
    const res = await worker.fetch(req, makeEnv(), makeCtx());
    // Should return 400 from the parser (missing repo param)
    expect(res.status).toBe(400);
  });

  it("routes URL-appended GitHub path to API handler", async () => {
    const req = new Request("https://gitprism.dev/https://github.com/owner/repo");
    const res = await worker.fetch(req, makeEnv(), makeCtx());
    // Will fail with a fetch error (no mock), but should NOT return 501
    expect(res.status).not.toBe(501);
  });

  it("falls through to ASSETS for unknown paths", async () => {
    const env = makeEnv();
    const req = new Request("https://gitprism.dev/");
    await worker.fetch(req, env, makeCtx());
    expect((env.ASSETS.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });
});
