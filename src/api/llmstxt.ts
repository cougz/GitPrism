const LLMS_TXT = `# GitPrism
> Convert public GitHub repositories into LLM-ready Markdown.

## API
GET https://gitprism.cloudemo.org/ingest?repo={owner/repo}&ref={branch}&path={subdir}&detail={level}

## Parameters
- repo (required): GitHub owner/repo, e.g. "cloudflare/workers-sdk"
- ref (optional): Branch, tag, or commit SHA. Defaults to the repo's default branch.
- path (optional): Subdirectory to scope results to, e.g. "src/components"
- detail (optional): One of: summary, structure, file-list, full. Defaults to full.

## Shorthand
GET https://gitprism.cloudemo.org/https://github.com/{owner}/{repo}/tree/{ref}/{path}

## MCP Server
Connect to: https://gitprism.cloudemo.org/mcp
Tool: ingest_repo(url, detail)

## Limits
- Maximum zip archive size: 50 MB
- Maximum output size: 10 MB
- Maximum file count: 5,000
- Rate limit: 30 requests per minute per IP
- Only public repositories are supported
`;

/**
 * Returns the /llms.txt content for AI agent discoverability.
 */
export function handleLlmsTxt(): Response {
  return new Response(LLMS_TXT, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
