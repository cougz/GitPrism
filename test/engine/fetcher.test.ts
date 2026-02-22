import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveDefaultRef, checkZipSize, fetchZipball, resolveRefToSha } from "../../src/engine/fetcher";
import { RepoNotFoundError, ZipTooLargeError, GitHubApiError } from "../../src/types";
import type { Env } from "../../src/types";

const makeEnv = (token?: string): Env =>
  ({
    GITHUB_TOKEN: token,
    MAX_ZIP_BYTES: "52428800",
    MAX_OUTPUT_BYTES: "10485760",
    MAX_FILE_COUNT: "5000",
    CACHE_TTL_SECONDS: "3600",
  }) as unknown as Env;

describe("resolveDefaultRef", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the default_branch from GitHub API", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ default_branch: "main" }), { status: 200 })
    );
    const ref = await resolveDefaultRef("owner", "repo", makeEnv());
    expect(ref).toBe("main");
  });

  it("includes Authorization header when GITHUB_TOKEN is set", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ default_branch: "trunk" }), { status: 200 })
    );
    await resolveDefaultRef("owner", "repo", makeEnv("mytoken"));
    const [, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>)["Authorization"]).toBe("Bearer mytoken");
  });

  it("does not include Authorization header when no token", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ default_branch: "master" }), { status: 200 })
    );
    await resolveDefaultRef("owner", "repo", makeEnv());
    const [, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>)["Authorization"]).toBeUndefined();
  });

  it("throws RepoNotFoundError on 404", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response("Not Found", { status: 404 })
    );
    await expect(resolveDefaultRef("owner", "nonexistent", makeEnv())).rejects.toThrow(
      RepoNotFoundError
    );
  });

  it("throws GitHubApiError on 500", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500 })
    );
    await expect(resolveDefaultRef("owner", "repo", makeEnv())).rejects.toThrow(GitHubApiError);
  });
});

describe("checkZipSize", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves when zip is within size limit", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(null, {
        status: 200,
        headers: { "Content-Length": "1000000" },
      })
    );
    await expect(checkZipSize("owner", "repo", "main", makeEnv())).resolves.not.toThrow();
  });

  it("throws ZipTooLargeError when Content-Length exceeds limit", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(null, {
        status: 200,
        headers: { "Content-Length": "60000000" }, // > 52428800
      })
    );
    await expect(checkZipSize("owner", "repo", "main", makeEnv())).rejects.toThrow(ZipTooLargeError);
  });

  it("throws RepoNotFoundError on 404", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response("Not Found", { status: 404 })
    );
    await expect(checkZipSize("owner", "repo", "main", makeEnv())).rejects.toThrow(
      RepoNotFoundError
    );
  });

  it("uses correct zipball URL", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(null, { status: 200, headers: { "Content-Length": "1000" } })
    );
    await checkZipSize("myowner", "myrepo", "v1.0.0", makeEnv());
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toContain("myowner");
    expect(url).toContain("myrepo");
    expect(url).toContain("v1.0.0");
  });
});

describe("fetchZipball", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns zip data and rate limit headers", async () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(data.buffer, {
        status: 200,
        headers: {
          "X-RateLimit-Remaining": "4999",
          "X-RateLimit-Reset": "1700000000",
        },
      })
    );
    const result = await fetchZipball("owner", "repo", "main", makeEnv());
    expect(result.rateLimitRemaining).toBe("4999");
    expect(result.rateLimitReset).toBe("1700000000");
    expect(result.data).toBeInstanceOf(Uint8Array);
  });

  it("includes User-Agent header", async () => {
    const data = new Uint8Array([1, 2, 3]);
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(data.buffer, { status: 200 })
    );
    await fetchZipball("owner", "repo", "main", makeEnv());
    const [, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>)["User-Agent"]).toBe("GitPrism/1.0");
  });

  it("throws RepoNotFoundError on 404", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response("Not Found", { status: 404 })
    );
    await expect(fetchZipball("owner", "repo", "main", makeEnv())).rejects.toThrow(
      RepoNotFoundError
    );
  });

  it("throws GitHubApiError on 500", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response("Error", { status: 500 })
    );
    await expect(fetchZipball("owner", "repo", "main", makeEnv())).rejects.toThrow(GitHubApiError);
  });
});

describe("resolveRefToSha", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns SHA from GitHub API for branch ref", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ sha: "abc123def456" }), { status: 200 })
    );
    const sha = await resolveRefToSha("owner", "repo", "main", makeEnv());
    expect(sha).toBe("abc123def456");
  });

  it("returns SHA from GitHub API for tag ref", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ sha: "789xyz123" }), { status: 200 })
    );
    const sha = await resolveRefToSha("owner", "repo", "v1.0.0", makeEnv());
    expect(sha).toBe("789xyz123");
  });

  it("returns undefined on 404", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response("Not Found", { status: 404 })
    );
    const sha = await resolveRefToSha("owner", "nonexistent", "main", makeEnv());
    expect(sha).toBeUndefined();
  });

  it("returns undefined on 500", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response("Error", { status: 500 })
    );
    const sha = await resolveRefToSha("owner", "repo", "main", makeEnv());
    expect(sha).toBeUndefined();
  });

  it("includes Authorization header when GITHUB_TOKEN is set", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ sha: "abc123" }), { status: 200 })
    );
    await resolveRefToSha("owner", "repo", "main", makeEnv("mytoken"));
    const [, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>)["Authorization"]).toBe("Bearer mytoken");
  });
});
