import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleIngest } from "../../src/api/handler";
import { zipSync, strToU8 } from "fflate";
import type { Env } from "../../src/types";

// Stub out the caches API to avoid miniflare isolated-storage issues in tests
vi.stubGlobal("caches", {
  default: {
    match: vi.fn().mockResolvedValue(undefined),
    put: vi.fn().mockResolvedValue(undefined),
  },
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeZip(files: Record<string, string>, prefix = "owner-repo-abc/"): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, content] of Object.entries(files)) {
    entries[prefix + name] = strToU8(content);
  }
  return zipSync(entries);
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    GITHUB_TOKEN: undefined,
    ASSETS: { fetch: vi.fn() } as unknown as Fetcher,
    RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) } as unknown as RateLimit,
    MAX_ZIP_BYTES: "52428800",
    MAX_OUTPUT_BYTES: "10485760",
    MAX_FILE_COUNT: "5000",
    CACHE_TTL_SECONDS: "3600",
    ...overrides,
  };
}

function makeCtx(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext;
}

const zipData = makeZip({ "src/index.ts": "const x = 1;\nexport default x;\n" });

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("handleIngest – happy path", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    // Mock HEAD (size check): Content-Length within limit
    // Mock GET (repo info): default branch
    // Mock GET (zipball): zip data
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        // HEAD size check
        new Response(null, { status: 200, headers: { "Content-Length": "1000" } })
      )
      .mockResolvedValueOnce(
        // zipball fetch
        new Response(zipData.buffer, {
          status: 200,
          headers: {
            "X-RateLimit-Remaining": "4999",
            "X-RateLimit-Reset": "1700000000",
          },
        })
      );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns 200 with text/markdown content type", async () => {
    const req = new Request("https://gitprism.dev/ingest?repo=owner/repo&ref=main");
    const res = await handleIngest(req, makeEnv(), makeCtx());
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
  });

  it("sets response headers", async () => {
    const req = new Request("https://gitprism.dev/ingest?repo=owner/repo&ref=main&detail=summary");
    const res = await handleIngest(req, makeEnv(), makeCtx());
    expect(res.headers.get("X-Repo")).toBe("owner/repo");
    expect(res.headers.get("X-Ref")).toBe("main");
    expect(res.headers.get("X-Cache")).toBe("MISS");
  });

  it("returns markdown body", async () => {
    const req = new Request("https://gitprism.dev/ingest?repo=owner/repo&ref=main&detail=summary");
    const res = await handleIngest(req, makeEnv(), makeCtx());
    const text = await res.text();
    expect(text).toContain("owner/repo");
  });
});

describe("handleIngest – resolves default ref", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("calls repo API when no ref is provided", async () => {
    vi.stubGlobal("fetch", vi.fn());
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ default_branch: "main" }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(null, { status: 200, headers: { "Content-Length": "1000" } })
      )
      .mockResolvedValueOnce(
        new Response(zipData.buffer, { status: 200 })
      );

    const req = new Request("https://gitprism.dev/ingest?repo=owner/repo");
    const res = await handleIngest(req, makeEnv(), makeCtx());
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Ref")).toBe("main");
  });
});

describe("handleIngest – error responses", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns 400 for malformed input", async () => {
    const req = new Request("https://gitprism.dev/ingest");
    const res = await handleIngest(req, makeEnv(), makeCtx());
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBeTruthy();
  });

  it("returns 400 for missing repo param", async () => {
    const req = new Request("https://gitprism.dev/ingest?ref=main");
    const res = await handleIngest(req, makeEnv(), makeCtx());
    expect(res.status).toBe(400);
  });

  it("returns 413 when zip is too large", async () => {
    vi.stubGlobal("fetch", vi.fn());
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(null, {
        status: 200,
        headers: { "Content-Length": "60000000" }, // > 52428800
      })
    );
    const req = new Request("https://gitprism.dev/ingest?repo=owner/repo&ref=main");
    const res = await handleIngest(req, makeEnv(), makeCtx());
    expect(res.status).toBe(413);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("50 MB");
  });

  it("returns 404 for non-existent repo", async () => {
    vi.stubGlobal("fetch", vi.fn());
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response("Not Found", { status: 404 })
    );
    const req = new Request("https://gitprism.dev/ingest?repo=nobody/nonexistent&ref=main");
    const res = await handleIngest(req, makeEnv(), makeCtx());
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("not found");
  });

  it("returns 429 when rate limited", async () => {
    const env = makeEnv({
      RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: false }) } as unknown as RateLimit,
    });
    const req = new Request("https://gitprism.dev/ingest?repo=owner/repo&ref=main");
    const res = await handleIngest(req, env, makeCtx());
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("returns 502 for GitHub 5xx errors", async () => {
    vi.stubGlobal("fetch", vi.fn());
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500 })
    );
    const req = new Request("https://gitprism.dev/ingest?repo=owner/repo&ref=main");
    const res = await handleIngest(req, makeEnv(), makeCtx());
    expect(res.status).toBe(502);
  });
});

describe("handleIngest – no-cache param", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("bypasses cache when no-cache=true", async () => {
    vi.stubGlobal("fetch", vi.fn());
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        new Response(null, { status: 200, headers: { "Content-Length": "1000" } })
      )
      .mockResolvedValueOnce(
        new Response(zipData.buffer, { status: 200 })
      );

    const req = new Request(
      "https://gitprism.dev/ingest?repo=owner/repo&ref=main&no-cache=true"
    );
    const res = await handleIngest(req, makeEnv(), makeCtx());
    // Should still succeed but go to origin
    expect(res.status).toBe(200);
  });
});
