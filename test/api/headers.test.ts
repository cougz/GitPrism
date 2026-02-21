import { describe, it, expect } from "vitest";
import { buildResponseHeaders } from "../../src/utils/headers";
import type { IngestResult } from "../../src/types";

const mockResult: IngestResult = {
  owner: "acme",
  repo: "myapp",
  repoName: "acme/myapp",
  ref: "main",
  fileCount: 42,
  totalSize: 102400,
  truncated: false,
  files: [],
};

describe("buildResponseHeaders", () => {
  it("sets Content-Type to text/markdown", () => {
    const headers = buildResponseHeaders({ result: mockResult });
    expect(headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
  });

  it("sets X-Repo", () => {
    const headers = buildResponseHeaders({ result: mockResult });
    expect(headers.get("X-Repo")).toBe("acme/myapp");
  });

  it("sets X-Ref", () => {
    const headers = buildResponseHeaders({ result: mockResult });
    expect(headers.get("X-Ref")).toBe("main");
  });

  it("sets X-File-Count", () => {
    const headers = buildResponseHeaders({ result: mockResult });
    expect(headers.get("X-File-Count")).toBe("42");
  });

  it("sets X-Total-Size", () => {
    const headers = buildResponseHeaders({ result: mockResult });
    expect(headers.get("X-Total-Size")).toBe("102400");
  });

  it("sets X-Truncated to false by default", () => {
    const headers = buildResponseHeaders({ result: mockResult });
    expect(headers.get("X-Truncated")).toBe("false");
  });

  it("sets X-Truncated to true when result is truncated", () => {
    const headers = buildResponseHeaders({ result: { ...mockResult, truncated: true } });
    expect(headers.get("X-Truncated")).toBe("true");
  });

  it("defaults X-Cache to MISS", () => {
    const headers = buildResponseHeaders({ result: mockResult });
    expect(headers.get("X-Cache")).toBe("MISS");
  });

  it("sets X-Cache to HIT when specified", () => {
    const headers = buildResponseHeaders({ result: mockResult, cacheStatus: "HIT" });
    expect(headers.get("X-Cache")).toBe("HIT");
  });

  it("sets rate limit headers when provided", () => {
    const headers = buildResponseHeaders({
      result: mockResult,
      rateLimitRemaining: "4998",
      rateLimitReset: "1700000000",
    });
    expect(headers.get("X-RateLimit-Remaining")).toBe("4998");
    expect(headers.get("X-RateLimit-Reset")).toBe("1700000000");
  });

  it("omits rate limit headers when not provided", () => {
    const headers = buildResponseHeaders({ result: mockResult });
    expect(headers.get("X-RateLimit-Remaining")).toBeNull();
    expect(headers.get("X-RateLimit-Reset")).toBeNull();
  });
});
