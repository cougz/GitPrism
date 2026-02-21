import { describe, it, expect } from "vitest";
import { handleLlmsTxt } from "../../src/api/llmstxt";

describe("handleLlmsTxt", () => {
  it("returns 200 status", () => {
    const res = handleLlmsTxt();
    expect(res.status).toBe(200);
  });

  it("returns text/plain content type", () => {
    const res = handleLlmsTxt();
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
  });

  it("includes API endpoint documentation", async () => {
    const res = handleLlmsTxt();
    const text = await res.text();
    expect(text).toContain("GitPrism");
    expect(text).toContain("/ingest");
    expect(text).toContain("repo");
    expect(text).toContain("detail");
  });

  it("includes MCP server documentation", async () => {
    const res = handleLlmsTxt();
    const text = await res.text();
    expect(text).toContain("/mcp");
    expect(text).toContain("ingest_repo");
  });

  it("includes limits documentation", async () => {
    const res = handleLlmsTxt();
    const text = await res.text();
    expect(text).toContain("50 MB");
    expect(text).toContain("5,000");
    expect(text).toContain("30 requests per minute");
  });

  it("includes shorthand URL format", async () => {
    const res = handleLlmsTxt();
    const text = await res.text();
    expect(text).toContain("github.com/{owner}/{repo}/tree/{ref}");
  });
});
