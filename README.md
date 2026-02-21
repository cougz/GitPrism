# GitPrism

A fast, token-efficient, stateless pipeline that converts public GitHub repositories into LLM-ready Markdown. Deployed as a single Cloudflare Worker serving humans, AI agents, and MCP clients from one shared core engine.

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
                    │         │  URL Parser        │               │
                    │         │  Zipball Fetch     │               │
                    │         │  fflate Decomp     │               │
                    │         │  Filter/Ignore     │               │
                    │         │  MD Formatter      │               │
                    │         └───────────────────┘               │
                    └─────────────────────────────────────────────┘
                                       │
                                       ▼
                              GitHub Zipball API
                          (authenticated via secret)
```

## Usage

### Web UI

Visit `https://gitprism.dev/` and paste any GitHub URL.

### REST API

**Canonical form (recommended for programmatic use):**
```
GET /ingest?repo=owner/repo&ref=main&path=src&detail=full
```

**URL-appended shorthand (human-friendly):**
```
GET /https://github.com/owner/repo/tree/main/src
```

**Parameters:**

| Parameter | Required | Default | Description |
|---|---|---|---|
| `repo` | Yes (canonical) | — | `owner/repo`, e.g. `cloudflare/workers-sdk` |
| `ref` | No | default branch | Branch, tag, or commit SHA |
| `path` | No | — | Subdirectory to scope results to |
| `detail` | No | `full` | Output level: `summary`, `structure`, `file-list`, or `full` |
| `no-cache` | No | `false` | Set to `true` to bypass response cache |

**Detail levels:**

| Level | Returns |
|---|---|
| `summary` | YAML front-matter with repo name, ref, file count, total size |
| `structure` | Summary + ASCII directory tree |
| `file-list` | Structure + table of every included file with byte size and line count |
| `full` | Summary + structure + complete file contents in fenced code blocks. Streamed. |

**Response headers:**

| Header | Description |
|---|---|
| `Content-Type` | `text/markdown; charset=utf-8` |
| `X-Repo` | `owner/repo` |
| `X-Ref` | Resolved ref (branch, tag, or SHA) |
| `X-File-Count` | Number of files included |
| `X-Total-Size` | Total size of included files in bytes |
| `X-Truncated` | `true` if output was truncated |
| `X-RateLimit-Remaining` | GitHub API rate limit remaining |
| `X-RateLimit-Reset` | GitHub API rate limit reset timestamp |
| `X-Cache` | `HIT` or `MISS` |

**Error responses (JSON):**

| Status | Condition |
|---|---|
| 400 | Malformed input |
| 404 | Repository not found or private |
| 413 | Archive exceeds 50 MB limit |
| 429 | Rate limited (30 req/min per IP) |
| 502 | GitHub API error |

### MCP Tool

Connect any MCP-compatible client to `https://gitprism.dev/mcp`.

Available tool: **`ingest_repo`**

```json
{
  "url": "https://github.com/owner/repo",
  "detail": "full"
}
```

The tool is fully compatible with Code Mode agents — the strongly-typed Zod input schema and descriptive annotations allow client-side `createCodeTool()` to wrap it automatically.

## Deployment

### Prerequisites

- Cloudflare account (Workers paid plan recommended for 5-minute CPU limit)
- Custom domain configured in Cloudflare (required for Cache API)

### Steps

1. **Clone and install:**
   ```sh
   git clone https://github.com/cougz/gitprism.git
   cd gitprism
   npm install
   cd ui && npm install && npm run build && cd ..
   ```

2. **Configure secrets:**
   ```sh
   npx wrangler secret put GITHUB_TOKEN
   # Enter your fine-grained PAT with public repo read-only scope
   ```

3. **Deploy:**
   ```sh
   npx wrangler deploy
   ```

4. **Configure custom domain** in the Cloudflare dashboard under Workers & Pages → your worker → Custom Domains. This enables the Cache API.

### Environment Variables

Configured in `wrangler.jsonc` under `vars`:

| Variable | Default | Description |
|---|---|---|
| `MAX_ZIP_BYTES` | `52428800` (50 MB) | Maximum zip archive size |
| `MAX_OUTPUT_BYTES` | `10485760` (10 MB) | Maximum output size before truncation |
| `MAX_FILE_COUNT` | `5000` | Maximum file count before truncation |
| `CACHE_TTL_SECONDS` | `3600` (1 hour) | Cache TTL |

### Secrets

| Secret | Purpose |
|---|---|
| `GITHUB_TOKEN` | Fine-grained PAT, public repo read-only. Raises rate limit from 60 to 5,000 req/hr. |

## Development

```sh
# Run tests (169 tests)
npm test

# Watch mode
npm run test:watch

# Type-check
npm run typecheck

# Local dev server
npm run dev

# Build UI only
npm run build:ui
```

## Architecture

### Project Structure

```
gitprism/
├── src/
│   ├── index.ts              # Worker entry point, routing
│   ├── types.ts              # Shared interfaces and error classes
│   ├── engine/
│   │   ├── parser.ts         # URL parsing and validation
│   │   ├── fetcher.ts        # GitHub zipball download + size check
│   │   ├── decompressor.ts   # fflate decompression + processing
│   │   ├── filter.ts         # Ignore lists, .gitignore, binary detection
│   │   ├── formatter.ts      # Markdown output generators (4 levels)
│   │   └── ingest.ts         # Shared pipeline (used by API + MCP)
│   ├── mcp/
│   │   └── server.ts         # createMcpHandler setup
│   ├── api/
│   │   ├── handler.ts        # REST API handler, streaming, caching
│   │   └── llmstxt.ts        # /llms.txt endpoint
│   └── utils/
│       ├── cache.ts          # Workers Cache API helpers
│       ├── ratelimit.ts      # Rate limiting helper
│       └── headers.ts        # Response header builder
├── test/                     # Vitest test files (169 tests)
├── ui/
│   ├── src/                  # Astro source
│   ├── dist/                 # Build output (gitignored)
│   └── astro.config.mjs
├── PLAN.md                   # Detailed implementation plan
└── wrangler.jsonc
```

### Key Decisions

| Decision | Rationale |
|---|---|
| Single Worker (no Pages) | Workers Static Assets is the recommended approach. No CORS, simpler deployment. |
| `createMcpHandler()` (no Durable Objects) | Tool is stateless. No per-session state needed. |
| `fflate` over `jszip` | Streaming decompression, smaller bundle, lower peak memory in V8 isolates. |
| Server-side `GITHUB_TOKEN` | Raises rate limit from 60 to 5,000 req/hr without user auth. |
| Pre-flight size check | Prevents OOM crashes from large repos. |
| Cache API from day one | Identical repo+ref+detail produces identical output. Caching cuts latency and GitHub API usage. |
| Streaming `TransformStream` for `full` | Reduces peak memory, improves time-to-first-byte. |

## File Filtering

### Hardcoded Ignore List

The following are always excluded regardless of `.gitignore`:

**Directories:** `node_modules/`, `vendor/`, `.git/`, `__pycache__/`, `.venv/`, `venv/`, `dist/`, `build/`, `.next/`, `.nuxt/`, `.svelte-kit/`, `.output/`, `.cache/`, `.parcel-cache/`, `coverage/`, `.tox/`, `.mypy_cache/`

**Files:** `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lockb`, `Cargo.lock`, `composer.lock`, `Gemfile.lock`, `go.sum`, `poetry.lock`, `*.min.js`, `*.min.css`, `*.map`, `*.wasm`, `*.pb.go`, `*.pyc`, `*.pyo`

**Binary extensions:** `.png`, `.jpg`, `.jpeg`, `.gif`, `.ico`, `.webp`, `.bmp`, `.tiff`, `.svg`, `.woff`, `.woff2`, `.ttf`, `.eot`, `.otf`, `.pdf`, `.zip`, `.tar`, `.gz`, `.bz2`, `.7z`, `.rar`, `.exe`, `.dll`, `.so`, `.dylib`, `.bin`, `.o`, `.a`, `.mp3`, `.mp4`, `.avi`, `.mov`, `.mkv`, `.flac`, `.wav`, `.ogg`, `.sqlite`, `.db`, `.DS_Store`

**Binary content detection:** Files containing null bytes in their first 8 KB are skipped regardless of extension.

### .gitignore Support

The root `.gitignore` of the repository is parsed and applied. Supports:
- Wildcard patterns (`*.log`, `**/*.tmp`)
- Directory patterns with trailing slash (`logs/`)
- Rooted patterns (`/build`)
- Negation patterns (`!important.log`)
- Comments (`# this line is ignored`)

**Limitation:** Only the root `.gitignore` is evaluated. Nested `.gitignore` files (e.g., `src/.gitignore`) are not supported in v1.

## Code Mode Compatibility

The `ingest_repo` MCP tool is compatible with Code Mode agents by design:
- Clear, descriptive tool name (`ingest_repo`)
- Multi-sentence description explaining all four detail levels
- Strongly-typed Zod schemas with `.describe()` on every parameter
- No server-side changes needed — standard MCP tools with typed schemas are inherently Code Mode compatible

## Limits

| Limit | Value | Configurable |
|---|---|---|
| Max zip archive size | 50 MB | `MAX_ZIP_BYTES` env var |
| Max output size | 10 MB | `MAX_OUTPUT_BYTES` env var |
| Max file count | 5,000 | `MAX_FILE_COUNT` env var |
| Rate limit | 30 req/min per IP | `wrangler.jsonc` ratelimits binding |
| Cache TTL | 1 hour | `CACHE_TTL_SECONDS` env var |

## License

MIT
