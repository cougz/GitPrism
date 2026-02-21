import { describe, it, expect } from "vitest";
import { parseRequest } from "../../src/engine/parser";
import { ParseError } from "../../src/types";

function makeRequest(path: string): Request {
  return new Request(`https://gitprism.dev${path}`);
}

describe("parseRequest – /ingest query-param form", () => {
  it("parses minimal repo param", () => {
    const result = parseRequest(makeRequest("/ingest?repo=owner/repo"));
    expect(result.owner).toBe("owner");
    expect(result.repo).toBe("repo");
    expect(result.detail).toBe("full");
    expect(result.noCache).toBe(false);
    expect(result.ref).toBeUndefined();
    expect(result.path).toBeUndefined();
  });

  it("parses all query params", () => {
    const result = parseRequest(
      makeRequest("/ingest?repo=acme/myrepo&ref=main&path=src/components&detail=summary")
    );
    expect(result.owner).toBe("acme");
    expect(result.repo).toBe("myrepo");
    expect(result.ref).toBe("main");
    expect(result.path).toBe("src/components");
    expect(result.detail).toBe("summary");
  });

  it("parses no-cache flag", () => {
    const result = parseRequest(makeRequest("/ingest?repo=a/b&no-cache=true"));
    expect(result.noCache).toBe(true);
  });

  it("accepts all valid detail levels", () => {
    for (const level of ["summary", "structure", "file-list", "full"] as const) {
      const result = parseRequest(makeRequest(`/ingest?repo=a/b&detail=${level}`));
      expect(result.detail).toBe(level);
    }
  });

  it("throws ParseError for missing repo param", () => {
    expect(() => parseRequest(makeRequest("/ingest"))).toThrow(ParseError);
  });

  it("throws ParseError for malformed repo (no slash)", () => {
    expect(() => parseRequest(makeRequest("/ingest?repo=justowner"))).toThrow(ParseError);
  });

  it("throws ParseError for empty owner", () => {
    expect(() => parseRequest(makeRequest("/ingest?repo=/repo"))).toThrow(ParseError);
  });

  it("throws ParseError for empty repo", () => {
    expect(() => parseRequest(makeRequest("/ingest?repo=owner/"))).toThrow(ParseError);
  });

  it("throws ParseError for invalid detail value", () => {
    expect(() => parseRequest(makeRequest("/ingest?repo=a/b&detail=invalid"))).toThrow(ParseError);
  });
});

describe("parseRequest – URL-appended shorthand form", () => {
  it("parses bare github URL", () => {
    const result = parseRequest(makeRequest("/https://github.com/owner/repo"));
    expect(result.owner).toBe("owner");
    expect(result.repo).toBe("repo");
    expect(result.detail).toBe("full");
    expect(result.ref).toBeUndefined();
    expect(result.path).toBeUndefined();
  });

  it("parses github URL with branch", () => {
    const result = parseRequest(makeRequest("/https://github.com/owner/repo/tree/main"));
    expect(result.owner).toBe("owner");
    expect(result.repo).toBe("repo");
    expect(result.ref).toBe("main");
    expect(result.path).toBeUndefined();
  });

  it("parses github URL with branch and subpath", () => {
    const result = parseRequest(
      makeRequest("/https://github.com/owner/repo/tree/main/src/components")
    );
    expect(result.owner).toBe("owner");
    expect(result.repo).toBe("repo");
    expect(result.ref).toBe("main");
    expect(result.path).toBe("src/components");
  });

  it("parses github URL with SHA ref", () => {
    const result = parseRequest(
      makeRequest("/https://github.com/owner/repo/tree/abc123def456/src")
    );
    expect(result.ref).toBe("abc123def456");
    expect(result.path).toBe("src");
  });

  it("accepts detail param alongside URL-appended form", () => {
    const result = parseRequest(
      makeRequest("/https://github.com/owner/repo?detail=structure")
    );
    expect(result.detail).toBe("structure");
  });

  it("throws ParseError for malformed github URL path", () => {
    expect(() => parseRequest(makeRequest("/https://github.com/"))).toThrow(ParseError);
  });

  it("throws ParseError for github URL with only owner", () => {
    expect(() => parseRequest(makeRequest("/https://github.com/owner"))).toThrow(ParseError);
  });
});

describe("parseRequest – URL-encoded shorthand (percent-encoded colon)", () => {
  it("parses %3A-encoded colon in https scheme (single slash after)", () => {
    // Browsers sometimes encode the colon: https%3A//github.com/...
    // The Request constructor preserves the encoding in the pathname.
    const req = new Request("https://gitprism.dev/https%3A//github.com/owner/repo");
    const result = parseRequest(req);
    expect(result.owner).toBe("owner");
    expect(result.repo).toBe("repo");
    expect(result.detail).toBe("full");
  });

  it("parses %3A-encoded colon with tree/branch/subpath", () => {
    const req = new Request(
      "https://gitprism.dev/https%3A//github.com/cougz/arcane-mcp-server/tree/main/src/tools"
    );
    const result = parseRequest(req);
    expect(result.owner).toBe("cougz");
    expect(result.repo).toBe("arcane-mcp-server");
    expect(result.ref).toBe("main");
    expect(result.path).toBe("src/tools");
  });

  it("auto-extracts subpath from /tree/branch/path URL", () => {
    const result = parseRequest(
      makeRequest("/https://github.com/cougz/arcane-mcp-server/tree/main/src/tools")
    );
    expect(result.owner).toBe("cougz");
    expect(result.repo).toBe("arcane-mcp-server");
    expect(result.ref).toBe("main");
    expect(result.path).toBe("src/tools");
  });

  it("returns no path for bare repo URL (no /tree/...)", () => {
    const result = parseRequest(
      makeRequest("/https://github.com/cougz/arcane-mcp-server")
    );
    expect(result.owner).toBe("cougz");
    expect(result.repo).toBe("arcane-mcp-server");
    expect(result.ref).toBeUndefined();
    expect(result.path).toBeUndefined();
  });
});

describe("parseRequest – abbreviated detail shorthand (?summary, ?structure, etc.)", () => {
  it("parses ?summary bare key on URL-proxy form", () => {
    const result = parseRequest(
      makeRequest("/https://github.com/owner/repo?summary")
    );
    expect(result.detail).toBe("summary");
    expect(result.owner).toBe("owner");
    expect(result.repo).toBe("repo");
  });

  it("parses ?structure bare key on URL-proxy form", () => {
    const result = parseRequest(
      makeRequest("/https://github.com/owner/repo?structure")
    );
    expect(result.detail).toBe("structure");
  });

  it("parses ?file-list bare key on URL-proxy form", () => {
    const result = parseRequest(
      makeRequest("/https://github.com/owner/repo?file-list")
    );
    expect(result.detail).toBe("file-list");
  });

  it("parses ?full bare key on URL-proxy form", () => {
    const result = parseRequest(
      makeRequest("/https://github.com/owner/repo?full")
    );
    expect(result.detail).toBe("full");
  });

  it("?detail= takes priority over bare key when both present", () => {
    const result = parseRequest(
      makeRequest("/https://github.com/owner/repo?summary&detail=structure")
    );
    expect(result.detail).toBe("structure");
  });

  it("parses ?summary on /ingest form", () => {
    const result = parseRequest(makeRequest("/ingest?repo=owner/repo&summary"));
    expect(result.detail).toBe("summary");
  });

  it("defaults to full when no detail param and no bare key", () => {
    const result = parseRequest(makeRequest("/https://github.com/owner/repo"));
    expect(result.detail).toBe("full");
  });

  it("works with tree/ref/path and ?summary", () => {
    const result = parseRequest(
      makeRequest("/https://github.com/cougz/GitPrism/tree/main/src?summary")
    );
    expect(result.detail).toBe("summary");
    expect(result.ref).toBe("main");
    expect(result.path).toBe("src");
  });
});
