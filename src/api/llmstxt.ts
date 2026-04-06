const LLMS_TXT = `# GitPrism
> Convert public GitHub repositories into LLM-ready Markdown.

## API
GET https://gitprism.cloudemo.org/ingest?repo={owner/repo}&ref={branch}&path={subdir}&detail={level}

## Parameters
- repo (required): GitHub owner/repo, e.g. "cloudflare/workers-sdk"
- ref (optional): Branch, tag, or commit SHA. Defaults to the repo's default branch.
- path (optional): Subdirectory to scope results to, e.g. "src/components"
- detail (optional): One of: summary, structure, file-list, full, commits. Defaults to full.

## Detail Levels
- summary: Repo name, ref, file count, total size
- structure: Summary + ASCII directory tree
- file-list: Structure + file paths with sizes and line counts
- full: Summary + structure + complete file contents in fenced code blocks (streamed)
- commits: Last 10 commit messages with SHA, author, date, message, and files changed

## Detail Level Shorthand
All three access modes support bare-key detail shortcuts instead of ?detail=<level>:
GET /ingest?repo=owner/repo&summary
GET /https://github.com/owner/repo?summary
Supported keys: ?summary, ?structure, ?file-list, ?full, ?commits

## URL Proxy Shorthand
GET https://gitprism.cloudemo.org/https://github.com/{owner}/{repo}/tree/{ref}/{path}
Append ?summary, ?structure, ?file-list, ?full, or ?commits to control output detail.

## Authentication (Optional)
Provide a GitHub personal access token to bypass shared rate limits and use your personal GitHub quota (5,000 req/hr instead of 30 req/min):
- Header: X-GitHub-Token: <your-token>
- Token requirements: Contents: Read-only access to public repositories
- Create token: https://github.com/settings/tokens?type=beta
- Response header X-Token-Source indicates which token was used: "user", "server", or "none"

## MCP Server
Connect to: https://gitprism.cloudemo.org/mcp
Tool: ingest_repo(url, detail, github_token?)
- url: GitHub URL or owner/repo shorthand
- detail: summary, structure, file-list, or full
- github_token (optional): Your GitHub PAT to bypass rate limits

## Limits
- Maximum zip archive size: 50 MB
- Maximum output size: 10 MB
- Maximum file count: 5,000
- Rate limit: 30 requests per minute per IP (bypassed with X-GitHub-Token)
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
