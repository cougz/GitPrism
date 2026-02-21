# GitPrism Implementation Plan

## Architecture Overview

GitPrism is a fast, token-efficient, stateless pipeline that converts public GitHub repositories into LLM-ready Markdown. Deployed as a single Cloudflare Worker serving humans, standard AI agents, and MCP clients from one shared core engine.

```
                    ┌─────────────────────────────────────────────┐
                    │          Single Cloudflare Worker            │
                    │               (gitprism)                    │
                    │                                             │
   Humans ────────► │  /              → Astro Static UI           │
                    │                   (Workers Static Assets)   │
                    │                                             │
   AI Agents ─────► │  /ingest?...    → REST API                  │
                    │  /<github-url>  → URL Proxy (shorthand)     │
                    │                                             │
   MCP Clients ───► │  /mcp           → Stateless MCP Server      │
                    │                   (createMcpHandler)        │
                    │                                             │
                    │         ┌───────────────────┐               │
                    │         │   Core Engine      │               │
                    │         │ ┌───────────────┐ │               │
                    │         │ │ URL Parser    │ │               │
                    │         │ │ Zipball Fetch │ │               │
                    │         │ │ fflate Decomp │ │               │
                    │         │ │ Filter/Ignore │ │               │
                    │         │ │ MD Formatter  │ │               │
                    │         │ └───────────────┘ │               │
                    │         └───────────────────┘               │
                    └─────────────────────────────────────────────┘
                                       │
                                       ▼
                              GitHub Zipball API
                          (authenticated via secret)
```

## Key Architectural Decisions

| Decision | Rationale |
|---|---|
| Single Worker (no Pages) | Workers Static Assets is the recommended approach for new projects. Eliminates CORS, simplifies deployment. |
| `createMcpHandler()` (no Durable Objects) | Tool is stateless. No per-session state needed. |
| fflate over jszip | Lower memory overhead in V8 isolates. |
| Server-side GITHUB_TOKEN | Raises rate limit from 60 to 5,000 req/hr without user auth. |
| Pre-flight size check | Prevents OOM crashes from large repos. |
| Cache API from day one | Identical repo+ref+detail produces identical output. |
| Four granularity levels | `file-list` fills the gap between tree-only and full content. |
| Streaming TransformStream for `full` | Reduces peak memory, improves TTFB. |

---

## Phase 0: Project Scaffolding

### 0.1 Initialize the project

1. Create `package.json`:
   - `"name": "gitprism"`, `"private": true`, `"type": "module"`
   - Scripts: `"dev": "wrangler dev"`, `"deploy": "wrangler deploy"`, `"test": "vitest run"`, `"test:watch": "vitest"`, `"build:ui": "cd ui && npm run build"`, `"typecheck": "tsc --noEmit"`

2. Install dependencies:
   ```
   npm install fflate @modelcontextprotocol/sdk agents zod
   npm install -D wrangler typescript vitest @cloudflare/vitest-pool-workers @types/node
   ```

3. Create `tsconfig.json`:
   ```json
   {
     "$schema": "https://json-schema.org/draft/2020-12/schema",
     "compilerOptions": {
       "target": "ESNext",
       "module": "ESNext",
       "moduleResolution": "bundler",
       "lib": ["ESNext"],
       "types": ["@cloudflare/vitest-pool-workers"],
       "strict": true,
       "noEmit": true,
       "skipLibCheck": true,
       "esModuleInterop": true,
       "resolveJsonModule": true,
       "isolatedModules": true
     },
     "include": ["src/**/*.ts", "test/**/*.ts"],
     "exclude": ["node_modules", "ui"]
   }
   ```

4. Create `wrangler.jsonc`:
   ```jsonc
   {
     "$schema": "./node_modules/wrangler/config-schema.json",
     "name": "gitprism",
     "main": "src/index.ts",
     "compatibility_date": "2026-02-21",
     "compatibility_flags": ["nodejs_compat"],
     "assets": {
       "directory": "./ui/dist",
       "binding": "ASSETS",
       "not_found_handling": "single-page-application"
     },
     "ratelimits": [
       {
         "name": "RATE_LIMITER",
         "namespace_id": "1001",
         "simple": { "limit": 30, "period": 60 }
       }
     ],
     "vars": {
       "MAX_ZIP_BYTES": "52428800",
       "MAX_OUTPUT_BYTES": "10485760",
       "MAX_FILE_COUNT": "5000",
       "CACHE_TTL_SECONDS": "3600"
     }
   }
   ```

5. Create `vitest.config.ts` using `@cloudflare/vitest-pool-workers` pool pointing at `wrangler.jsonc`.

6. Create `.gitignore` excluding `node_modules/`, `dist/`, `.wrangler/`, `ui/dist/`, `ui/node_modules/`, `.dev.vars`.

7. Create source directory structure:
   ```
   src/
     index.ts
     types.ts
     engine/
       parser.ts
       fetcher.ts
       decompressor.ts
       filter.ts
       formatter.ts
     mcp/
       server.ts
     api/
       handler.ts
       llmstxt.ts
     utils/
       cache.ts
       ratelimit.ts
       headers.ts
   test/
     engine/
       parser.test.ts
       filter.test.ts
       formatter.test.ts
       decompressor.test.ts
     api/
       handler.test.ts
       llmstxt.test.ts
   ```

8. Create `src/types.ts` with shared `Env` interface and core types:
   - `Env` (with `GITHUB_TOKEN`, `ASSETS`, `RATE_LIMITER`, env vars)
   - `DetailLevel` union type
   - `ParsedRequest` interface
   - `FileEntry` interface
   - `IngestResult` interface

**Commit**: `chore: scaffold project structure with config files and types`

---

## Phase 1: Core Engine, API Proxy, & Resource Safety

All modules follow TDD: write failing tests first, then implement until passing.

### 1.1 URL Parser (`src/engine/parser.ts`)

**Tests** (`test/engine/parser.test.ts`):
- Parses `/ingest?repo=owner/repo` → `{ owner, repo, detail: "full" }`
- Parses all query params: `repo`, `ref`, `path`, `detail`, `no-cache`
- Parses URL-appended form `/https://github.com/owner/repo`
- Parses `/https://github.com/owner/repo/tree/main/src/components`
- Returns descriptive error for malformed input
- Rejects invalid detail values
- Defaults `detail` to `"full"` when omitted

**Implementation**: `parseRequest(request: Request): ParsedRequest`
- Handles `/ingest` (query params) and `/https://github.com/...` (URL-appended) forms
- Validates owner/repo format
- Throws `ParseError` (custom class) with descriptive message for 400 responses

**Commit**: `feat: add URL parser with validation`

### 1.2 Filter module (`src/engine/filter.ts`)

**Tests** (`test/engine/filter.test.ts`):
- `shouldIgnorePath("node_modules/foo")` → true
- `shouldIgnorePath("src/index.ts")` → false
- `shouldIgnorePath("package-lock.json")` → true
- `shouldIgnorePath("image.png")` → true
- `shouldIgnorePath(".git/config")` → true
- `isBinaryContent(bufferWithNullBytes)` → true
- `isBinaryContent(textBuffer)` → false
- `parseGitignore(content)` returns working matcher
- Gitignore handles `*.log`, `build/`, `!important.log`, comments
- `filterBySubpath(files, "src")` returns only files under `src/`, adjusts paths

**Implementation**:
- `shouldIgnorePath(filePath: string): boolean` — hardcoded ignore list from project plan
- `isBinaryContent(buffer: Uint8Array): boolean` — checks first 8192 bytes for null bytes
- `parseGitignore(content: string): (path: string) => boolean`
- `filterBySubpath(files: FileEntry[], subpath: string): FileEntry[]`

Hardcoded always-ignored directories: `node_modules/`, `vendor/`, `.git/`, `__pycache__/`, `.venv/`, `venv/`, `dist/`, `build/`, `.next/`, `.nuxt/`, `.svelte-kit/`, `.output/`, `.cache/`, `.parcel-cache/`, `coverage/`, `.tox/`, `.mypy_cache/`

Hardcoded always-ignored files: `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lockb`, `Cargo.lock`, `composer.lock`, `Gemfile.lock`, `go.sum`, `poetry.lock`, `*.min.js`, `*.min.css`, `*.map`, `*.wasm`, `*.pb.go`, `*.pyc`, `*.pyo`

Binary extensions: `.png`, `.jpg`, `.jpeg`, `.gif`, `.ico`, `.webp`, `.bmp`, `.tiff`, `.svg`, `.woff`, `.woff2`, `.ttf`, `.eot`, `.otf`, `.pdf`, `.zip`, `.tar`, `.gz`, `.bz2`, `.7z`, `.rar`, `.exe`, `.dll`, `.so`, `.dylib`, `.bin`, `.o`, `.a`, `.mp3`, `.mp4`, `.avi`, `.mov`, `.mkv`, `.flac`, `.wav`, `.ogg`, `.sqlite`, `.db`, `.DS_Store`

**Commit**: `feat: add file filter with gitignore support`

### 1.3 Formatter module (`src/engine/formatter.ts`)

**Tests** (`test/engine/formatter.test.ts`):
- `formatSummary(result)` → Markdown with YAML front-matter (repo, ref, file count, total size)
- `formatTree(files)` → ASCII tree with `├──`, `└──`, `│`
- `formatFileList(result)` → summary + tree + Markdown table (Path, Size, Lines)
- `formatFull(result)` → summary + tree + fenced code blocks with language tags
- `detectLanguage(".ts")` → `typescript`, `".py"` → `python`, etc.
- Tree rooted at subpath when `subpath` is set
- Truncation notice appended when `result.truncated === true`

**Implementation**:
- `detectLanguage(filePath: string): string`
- `formatSummary(result: IngestResult): string`
- `formatTree(files: FileEntry[], rootName?: string): string`
- `formatFileList(result: IngestResult): string`
- `formatFull(result: IngestResult): string` (produces full string for non-streaming use)
- `formatOutput(result: IngestResult, detail: DetailLevel): string` — dispatcher

**Commit**: `feat: add markdown formatter with four detail levels`

### 1.4 GitHub Fetcher (`src/engine/fetcher.ts`)

**Tests** (`test/engine/fetcher.test.ts`) using mocked fetch:
- Constructs correct GitHub API URLs
- Adds `Authorization` header when `GITHUB_TOKEN` present
- Pre-flight size check rejects zips > MAX_ZIP_BYTES with descriptive error
- Rate limit headers extracted from GitHub response
- 404 response → specific `RepoNotFoundError`
- 500 response → `GitHubApiError` (502 to caller)

**Implementation**:
- `resolveDefaultRef(owner, repo, env): Promise<string>` — calls repos API, extracts `default_branch`
- `checkZipSize(owner, repo, ref, env): Promise<{ size: number }>` — HEAD + follow redirect, check Content-Length
- `fetchZipball(owner, repo, ref, env): Promise<{ data: Uint8Array; rateLimitRemaining: string; rateLimitReset: string }>`

All GitHub API requests must include:
- `User-Agent: GitPrism/1.0`
- `Authorization: Bearer <token>` if `GITHUB_TOKEN` set
- `Accept: application/vnd.github+json`

**Commit**: `feat: add GitHub fetcher with pre-flight size check`

### 1.5 Decompressor (`src/engine/decompressor.ts`)

**Tests** (`test/engine/decompressor.test.ts`) using `fflate.zipSync` to create test fixtures:
- Creates test zip, decompresses to correct file entries
- Strips top-level GitHub prefix directory (`owner-repo-sha/`)
- Skips binary files (null bytes in content)
- Skips files matching ignore patterns
- Respects subpath filter
- Parses and applies root `.gitignore`
- Stops at `MAX_OUTPUT_BYTES` and sets `truncated = true`
- Stops at `MAX_FILE_COUNT` and sets `truncated = true`
- For `detail !== "full"`, stores metadata only (no content)

**Implementation**: `decompressAndProcess(zipData: Uint8Array, options: DecompressOptions): IngestResult`

Uses `fflate.unzipSync` for synchronous decompression. For each entry:
1. Strip top-level directory prefix
2. Check `shouldIgnorePath` → skip
3. Collect root `.gitignore`, parse, apply
4. Apply subpath filter
5. Check `isBinaryContent` on first 8KB → skip
6. Track cumulative size and count against limits
7. Store content only when `detail === "full"`
8. Build ASCII tree, compute totals
9. Set `truncated` and `truncationMessage` if limits hit

**Commit**: `feat: add zip decompressor with filtering and limits`

### 1.6 Response Headers (`src/utils/headers.ts`)

**Tests**: Verify header builder produces all required headers.

**Implementation**: `buildResponseHeaders(params): Headers`

Required headers:
| Header | Value |
|---|---|
| `Content-Type` | `text/markdown; charset=utf-8` |
| `X-Repo` | `owner/repo` |
| `X-Ref` | resolved ref |
| `X-File-Count` | number of files |
| `X-Total-Size` | total size in bytes |
| `X-Truncated` | `true` or `false` |
| `X-RateLimit-Remaining` | pass-through from GitHub |
| `X-RateLimit-Reset` | pass-through from GitHub |
| `X-Cache` | `HIT` or `MISS` |

**Commit**: `feat: add response header builder`

### 1.7 Rate Limiter (`src/utils/ratelimit.ts`)

**Implementation**: `checkRateLimit(env: Env, clientIP: string): Promise<{ allowed: boolean; retryAfter?: number }>`

Calls `env.RATE_LIMITER.limit({ key: clientIP })`. If `!success`, returns `{ allowed: false, retryAfter: 60 }`.

**Commit**: `feat: add rate limiting helper`

### 1.8 Cache Helpers (`src/utils/cache.ts`)

**Implementation**:
- `buildCacheKey(parsed: ParsedRequest): Request` — normalized URL as cache key
- `getCached(cacheKey: Request): Promise<Response | undefined>` — `caches.default.match()`
- `putCache(cacheKey: Request, response: Response, ttl: number, ctx: ExecutionContext): void` — `ctx.waitUntil(caches.default.put(...))`

Wrap all cache operations in try/catch — the Workers Cache API is only available on custom domains, not `*.workers.dev`.

**Commit**: `feat: add cache helpers`

### 1.9 API Handler (`src/api/handler.ts`)

**Tests** (`test/api/handler.test.ts`):
- Valid request returns 200 with `text/markdown` content type
- 400 for malformed input
- 413 when size check fails
- 429 when rate limited (mock `RATE_LIMITER`)
- Correct response headers present
- `?no-cache=true` bypasses cache
- Streaming response for `detail=full`

**Implementation**: `handleIngest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>`

Orchestration flow:
1. `parseRequest(request)` → `ParsedRequest` (400 on `ParseError`)
2. `checkRateLimit(env, clientIP)` → 429 with `Retry-After` if exceeded
3. Check cache (skip if `noCache`) → return cached response with `X-Cache: HIT`
4. `resolveDefaultRef` if `ref` not specified
5. `checkZipSize` → 413 if too large
6. `fetchZipball` → raw zip data
7. `decompressAndProcess` → `IngestResult`
8. For `detail=full`: stream via `TransformStream`, write summary+tree first, then file blocks
9. For other levels: `formatOutput(result, detail)` → single `Response`
10. Set all response headers via `buildResponseHeaders`
11. Cache response (clone for cache store)
12. Return response

Error mapping:
- `ParseError` → 400
- `RepoNotFoundError` → 404 `{ "error": "Repository not found or is private" }`
- `ZipTooLargeError` → 413 `{ "error": "Repository archive exceeds 50 MB limit. Use ?path= to target a subdirectory." }`
- Rate limited → 429 `{ "error": "Rate limit exceeded", "retryAfter": 42 }`
- `GitHubApiError` → 502 `{ "error": "GitHub API returned <status>" }`

**Commit**: `feat: add API handler with streaming and error handling`

### 1.10 Worker Entry Point + llms.txt

**`src/api/llmstxt.ts`**: `handleLlmsTxt(): Response`
Returns the `/llms.txt` content as `text/plain; charset=utf-8`:
```
# GitPrism
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
```

**`src/index.ts`**: Main Worker fetch handler with routing:
- `/mcp*` → MCP handler (stub returning 501 until Phase 2)
- `/ingest` or `/https://...` → `handleIngest`
- `/llms.txt` → `handleLlmsTxt`
- Everything else → `env.ASSETS.fetch(request)`

**Tests**: Integration tests verifying routing behavior.

**Commit**: `feat: add worker entry point with routing and llms.txt`

---

## Phase 2: MCP Server Integration (Stateless)

### 2.1 MCP Server (`src/mcp/server.ts`)

**Key constraint**: Create a new `McpServer` instance per request — the SDK does not allow re-connecting an already-connected server to a new transport.

**Implementation**:
```ts
import { createMcpHandler } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

function createServer(env: Env) {
  const server = new McpServer({ name: "GitPrism", version: "1.0.0" });

  server.registerTool("ingest_repo", {
    description: "Convert a public GitHub repository or subdirectory into LLM-ready Markdown. " +
      "Supports four detail levels: 'summary' (name, ref, file count), " +
      "'structure' (summary + ASCII directory tree), " +
      "'file-list' (structure + file paths with sizes and line counts), " +
      "'full' (structure + complete file contents in fenced code blocks).",
    inputSchema: {
      url: z.string().describe(
        "GitHub URL. Examples: 'https://github.com/owner/repo', " +
        "'https://github.com/owner/repo/tree/main/src', or shorthand 'owner/repo'."
      ),
      detail: z.enum(["summary", "structure", "file-list", "full"])
        .default("full")
        .describe("Level of detail in the output. Defaults to 'full'."),
    },
  }, async ({ url, detail }) => {
    const markdown = await ingestFromUrl(url, detail, env);
    return { content: [{ type: "text", text: markdown }] };
  });

  return server;
}

export function createMcpFetchHandler() {
  return async (request: Request, env: Env, ctx: ExecutionContext) => {
    const server = createServer(env);
    return createMcpHandler(server, { route: "/mcp" })(request, env, ctx);
  };
}
```

`ingestFromUrl` is a shared helper that reuses the core pipeline to return a Markdown string (non-streaming, suitable for MCP tool responses).

### 2.2 Wire MCP into entry point

Update `src/index.ts` to replace the Phase 1 stub and call `mcpFetchHandler(request, env, ctx)` for `/mcp*` routes.

**Commit**: `feat: add stateless MCP server with ingest_repo tool`

---

## Phase 3: UI Layer (Astro Static Site)

### 3.1 Initialize Astro project

```bash
cd ui
npm create astro@latest -- . --template minimal --no-install --no-git --typescript strict
npm install
```

Configure `ui/astro.config.mjs` for static output:
```js
import { defineConfig } from 'astro/config';
export default defineConfig({ output: 'static' });
```

Build output goes to `ui/dist/` (already referenced in `wrangler.jsonc`).

### 3.2 UI Pages

**`ui/src/layouts/Layout.astro`**: Clean responsive HTML, dark mode support, monospace code area.

**`ui/src/pages/index.astro`**: Single-page app with:
- Hero section explaining the three access modes
- GitHub URL input field
- Optional ref/branch input
- Optional subdirectory path input
- Granularity selector dropdown (summary / structure / file-list / full) with descriptions
- Submit button with loading state
- Results viewer (`<pre><code>`) with syntax highlighting
- "Copy to Clipboard" button
- "Download as .md" button
- Metadata display from response headers (file count, total size, truncation, cache status)
- Error display per status code:
  - 413 → "This repository is too large. Try specifying a subdirectory."
  - 429 → "Rate limit reached. Please try again in X seconds."
  - 404 → "Repository not found. It may be private or misspelled."

Client-side JS wires the form to `fetch("/ingest?repo=...&ref=...&path=...&detail=...")`.

**Commit**: `feat: add Astro UI with interactive form`

---

## Phase 4: Polish & AI Discoverability

### 4.1 Structured Logging

Add `console.log(JSON.stringify({...}))` calls in `handleIngest` and the MCP handler:
```json
{
  "event": "ingest",
  "repo": "owner/repo",
  "ref": "main",
  "detail": "full",
  "cacheHit": false,
  "fileCount": 42,
  "totalSize": 102400,
  "truncated": false,
  "rateLimitRemaining": "4998",
  "latencyMs": 312
}
```

Workers automatically captures `console.log` output for Workers Logs / Logpush.

### 4.2 README.md

Comprehensive README with:
- Project description and architecture diagram
- Usage examples for all three modes
- Deployment instructions (`wrangler deploy`, `wrangler secret put GITHUB_TOKEN`)
- Configuration reference (env vars, rate limits, cache TTL)
- Hardcoded ignore list documentation and rationale
- Root-only `.gitignore` limitation documented
- Code Mode compatibility notes for agent developers

**Commit**: `docs: add README and structured logging`

---

## Deployment Configuration

### `wrangler.jsonc`

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "gitprism",
  "main": "src/index.ts",
  "compatibility_date": "2026-02-21",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": "./ui/dist",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application"
  },
  "routes": [
    { "pattern": "gitprism.cloudemo.org/*", "custom_domain": true }
  ],
  "ratelimits": [
    {
      "name": "RATE_LIMITER",
      "namespace_id": "1001",
      "simple": { "limit": 30, "period": 60 }
    }
  ],
  "vars": {
    "MAX_ZIP_BYTES": "52428800",
    "MAX_OUTPUT_BYTES": "10485760",
    "MAX_FILE_COUNT": "5000",
    "CACHE_TTL_SECONDS": "3600"
  }
}
```

### Secrets

Set via `wrangler secret put`:

| Secret | Purpose |
|---|---|
| `GITHUB_TOKEN` | Fine-grained PAT with public repo read-only scope. Raises GitHub rate limit from 60 to 5,000 req/hr. |

---

## Project Structure

```
gitprism/
├── src/
│   ├── index.ts              # Worker entry, routing
│   ├── types.ts              # Shared interfaces and types
│   ├── engine/
│   │   ├── parser.ts         # URL parsing & validation
│   │   ├── fetcher.ts        # GitHub zipball download + size check
│   │   ├── decompressor.ts   # fflate decompression + processing
│   │   ├── filter.ts         # Ignore lists, .gitignore, binary detection
│   │   └── formatter.ts      # Markdown output generators (4 levels)
│   ├── mcp/
│   │   └── server.ts         # createMcpHandler setup
│   ├── api/
│   │   ├── handler.ts        # REST API request handling, caching
│   │   └── llmstxt.ts        # /llms.txt endpoint
│   └── utils/
│       ├── cache.ts          # Cache API helpers
│       ├── ratelimit.ts      # Rate limiting helpers
│       └── headers.ts        # Response header builders
├── test/
│   ├── engine/
│   │   ├── parser.test.ts
│   │   ├── filter.test.ts
│   │   ├── formatter.test.ts
│   │   └── decompressor.test.ts
│   └── api/
│       ├── handler.test.ts
│       └── llmstxt.test.ts
├── ui/
│   ├── src/                  # Astro source
│   ├── dist/                 # Build output (gitignored)
│   ├── astro.config.mjs
│   └── package.json
├── PLAN.md                   # This file
├── wrangler.jsonc
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

---

## Output Granularity

| Level | Parameter | Returns |
|---|---|---|
| Summary | `detail=summary` | Repo name, resolved ref, total file count, total size (YAML front-matter) |
| Directory Structure | `detail=structure` | Summary + ASCII folder tree |
| File List | `detail=file-list` | Structure + table of every included file with byte size and line count |
| Full Content | `detail=full` | Summary + Structure + file contents in fenced code blocks. Streamed via TransformStream. |

## Platform Constraints & Mitigations

| Constraint | Value | Mitigation |
|---|---|---|
| Memory per isolate | 128 MB | Pre-flight Content-Length check; reject zips > 50 MB |
| GitHub unauthenticated rate limit | 60 req/hr per IP | Server-side `GITHUB_TOKEN` raises to 5,000 req/hr |
| Cache API | Requires custom domain | Wrap in try/catch; gracefully skip on `*.workers.dev` |
| Workers Rate Limiting | Eventually consistent | Acceptable for abuse prevention use case |

## Error Responses

All errors return structured JSON:

| Status | Condition | Example Body |
|---|---|---|
| 400 | Malformed input | `{ "error": "Could not parse GitHub URL. Expected format: owner/repo" }` |
| 404 | Repo or ref not found | `{ "error": "Repository not found or is private" }` |
| 413 | Zip too large | `{ "error": "Repository archive exceeds 50 MB limit. Use ?path= to target a subdirectory." }` |
| 429 | Rate limited | `{ "error": "Rate limit exceeded", "retryAfter": 42 }` |
| 502 | GitHub API error | `{ "error": "GitHub API returned 500" }` |
