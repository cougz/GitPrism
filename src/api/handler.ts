import { parseRequest } from "../engine/parser";
import { resolveDefaultRef, checkZipSize, fetchZipball, resolveRefToSha, fetchCommits } from "../engine/fetcher";
import { decompressAndProcess } from "../engine/decompressor";
import { formatOutput, formatFileBlock, formatSummary, formatTree, formatCommits } from "../engine/formatter";
import { buildResponseHeaders } from "../utils/headers";
import { checkRateLimit } from "../utils/ratelimit";
import { buildCacheKey, getCached, putCache } from "../utils/cache";
import {
  isParseError,
  isRepoNotFoundError,
  isZipTooLargeError,
  isGitHubApiError,
  isDecompressionError,
  type Env,
} from "../types";

function getClientIP(request: Request): string {
  return (
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("X-Forwarded-For")?.split(",")[0].trim() ??
    "unknown"
  );
}

function jsonError(status: number, message: string, extra?: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ error: message, ...extra }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Main REST API handler for /ingest and /<github-url> routes.
 */
export async function handleIngest(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const startTime = Date.now();
  
  console.log("[INGEST] Request received:", request.url);

  // ── 1. Parse request ──────────────────────────────────────────────────────
  let parsed;
  try {
    parsed = parseRequest(request);
    console.log("[INGEST] Parsed request:", { owner: parsed.owner, repo: parsed.repo, detail: parsed.detail, ref: parsed.ref });
  } catch (err) {
    console.error("[INGEST] Parse error:", err);
    if (isParseError(err)) {
      return jsonError(400, (err as Error).message);
    }
    return jsonError(400, "Invalid request.");
  }

  // ── 2. Extract user-provided GitHub token ─────────────────────────────────
  const userToken = request.headers.get("X-GitHub-Token") ?? undefined;
  parsed.userToken = userToken;

  const { owner, repo, detail, noCache, ref: originalRef } = parsed;

  // ── 3. Rate limit — skip when user supplies their own token ───────────────
  console.log("[INGEST] Checking rate limit, userToken:", !!userToken);
  if (!userToken) {
    const clientIP = getClientIP(request);
    const rateLimitResult = await checkRateLimit(env, clientIP);
    console.log("[INGEST] Rate limit result:", rateLimitResult);
    if (!rateLimitResult.allowed) {
      const retryAfter = rateLimitResult.retryAfter ?? 60;
      console.log("[INGEST] Rate limited, retry after:", retryAfter);
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded", retryAfter }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(retryAfter),
          },
        }
      );
    }
  }

  // ── 4. Resolve ref to commit SHA ────────────────────────────────────────────
  console.log("[INGEST] Resolving ref, originalRef:", originalRef);
  let resolvedRef: string | undefined;
  let resolvedSha: string | undefined;

  if (!originalRef) {
    console.log("[INGEST] No ref provided, resolving default branch");
    resolvedRef = await resolveDefaultRef(owner, repo, env, userToken);
    console.log("[INGEST] Default branch resolved:", resolvedRef);
    resolvedSha = await resolveRefToSha(owner, repo, resolvedRef, env, userToken);
  } else {
    resolvedRef = originalRef;
    resolvedSha = await resolveRefToSha(owner, repo, originalRef, env, userToken);
  }
  console.log("[INGEST] Ref resolved:", { resolvedRef, resolvedSha });

  // ── 5. Build cache key with SHA (or ref if SHA resolution failed) ───────
  const cacheKey = buildCacheKey(parsed, resolvedSha);

  // ── 6. Check cache (skip if no-cache=true or SHA resolution failed) ─────────
  const cachingEnabled = resolvedSha !== undefined;
  const shouldCheckCache = cachingEnabled && !noCache;
  console.log("[INGEST] Cache check:", { cachingEnabled, shouldCheckCache, noCache });

  if (shouldCheckCache) {
    const cached = await getCached(cacheKey);
    console.log("[INGEST] Cache result:", cached ? "HIT" : "MISS");
    if (cached) {
      const cachedResponse = new Response(cached.body, {
        status: cached.status,
        headers: new Headers(cached.headers),
      });
      cachedResponse.headers.set("X-Cache", "HIT");
      console.log("[INGEST] Returning cached response");
      return cachedResponse;
    }
  }

  try {
    console.log("[INGEST] Starting processing, detail level:", detail);
    // ── 7. Special handling for commits detail level ─────────────────────────────
    if (detail === "commits") {
      console.log("[INGEST] Handling commits detail level");
      const commits = await fetchCommits(owner, repo, resolvedRef, env, userToken, parsed.path);
      console.log("[INGEST] Fetched commits:", commits.length);
      const content = formatCommits(owner, repo, resolvedRef, commits);

      const headers = new Headers({
        "Content-Type": "text/markdown; charset=utf-8",
        "X-Repo": `${owner}/${repo}`,
        "X-Ref": resolvedRef,
        "X-Commit-Sha": resolvedSha ?? "",
        "X-Cache": "MISS",
        "X-Token-Source": userToken ? "user" : env.GITHUB_TOKEN ? "server" : "none",
      });

      console.log(
        JSON.stringify({
          event: "ingest",
          repo: `${owner}/${repo}`,
          ref: resolvedRef,
          detail: "commits",
          commitCount: commits.length,
          tokenSource: userToken ? "user" : env.GITHUB_TOKEN ? "server" : "none",
          latencyMs: Date.now() - startTime,
        })
      );

      return new Response(content, { status: 200, headers });
    }

    // ── 8. Use resolvedRef for all operations ────────────────────────────────────
    const ref = resolvedRef;
    console.log("[INGEST] Processing detail level:", detail, "ref:", ref);

    // ── 8. Pre-flight size check ────────────────────────────────────────────
    console.log("[INGEST] Checking zip size");
    await checkZipSize(owner, repo, ref, env, userToken);
    console.log("[INGEST] Zip size check passed");

    // ── 9. Fetch zipball ────────────────────────────────────────────────────
    console.log("[INGEST] Fetching zipball");
    const { data: zipData, rateLimitRemaining, rateLimitReset } = await fetchZipball(
      owner,
      repo,
      ref,
      env,
      userToken
    );
    console.log("[INGEST] Zipball fetched, size:", zipData.length);

    // ── 10. Decompress and process ───────────────────────────────────────────
    const maxOutputBytes = parseInt(env.MAX_OUTPUT_BYTES ?? "10485760", 10);
    const maxFileCount = parseInt(env.MAX_FILE_COUNT ?? "5000", 10);

    const result = decompressAndProcess(zipData, {
      subpath: parsed.path,
      detail,
      maxOutputBytes,
      maxFileCount,
    });

    // Fill in metadata from parsed request
    result.owner = owner;
    result.repo = repo;
    result.repoName = `${owner}/${repo}`;
    result.ref = originalRef ?? ref;

    // ── 11. Build response headers ───────────────────────────────────────────
    const headers = buildResponseHeaders({
      result,
      rateLimitRemaining,
      rateLimitReset,
      cacheStatus: "MISS",
      commitSha: resolvedSha,
    });

    headers.set(
      "X-Token-Source",
      userToken ? "user" : env.GITHUB_TOKEN ? "server" : "none"
    );

    // ── 12. Emit structured log ──────────────────────────────────────────────
    console.log(
      JSON.stringify({
        event: "ingest",
        repo: `${owner}/${repo}`,
        ref,
        originalRef,
        resolvedSha,
        detail,
        cacheHit: false,
        fileCount: result.fileCount,
        totalSize: result.totalSize,
        truncated: result.truncated,
        rateLimitRemaining,
        latencyMs: Date.now() - startTime,
        tokenSource: userToken ? "user" : env.GITHUB_TOKEN ? "server" : "none",
      })
    );

    // ── 13. Stream response for detail=full, otherwise return all at once ───
    if (detail === "full") {
      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      const summaryBlock = formatSummary(result);
      const treeBlock = formatTree(result.files);
      const header =
        summaryBlock + "\n## Directory Structure\n\n" + treeBlock + "\n## File Contents\n\n";

      // Wrap streaming in try-catch to prevent unhandled promise rejections
      ctx.waitUntil(
        (async () => {
          try {
            await writer.write(encoder.encode(header));
            for (const file of result.files) {
              try {
                await writer.write(encoder.encode(formatFileBlock(file)));
              } catch (writeErr) {
                console.error("Error writing file block:", writeErr);
                // Continue with other files
              }
            }
            if (result.truncated && result.truncationMessage) {
              await writer.write(encoder.encode("\n" + result.truncationMessage + "\n"));
            }
          } catch (streamErr) {
            console.error("Streaming error:", streamErr);
          } finally {
            try {
              await writer.close();
            } catch {
              // Ignore close errors
            }
          }
        })()
      );

      const response = new Response(readable, { headers });

      // Cache a non-streaming clone: build the full string and cache it
      let fullContent: string;
      try {
        fullContent = formatOutput(result, "full");
      } catch (formatErr) {
        console.error("Error formatting output for cache:", formatErr);
        // If formatting fails, still return the streaming response but skip caching
        return response;
      }
      
      const cacheableResponse = new Response(fullContent, {
        status: 200,
        headers: new Headers(headers),
      });

      // Only cache if SHA resolution succeeded
      if (cachingEnabled && !noCache) {
        const cacheTtl = parseInt(env.CACHE_TTL_SECONDS ?? "86400", 10);
        putCache(cacheKey, cacheableResponse, cacheTtl, ctx);
      }

      return response;
    }

    // Non-streaming path
    const content = formatOutput(result, detail);
    const response = new Response(content, { status: 200, headers });

    // Only cache if SHA resolution succeeded
    if (cachingEnabled && !noCache) {
      const cacheTtl = parseInt(env.CACHE_TTL_SECONDS ?? "86400", 10);
      putCache(cacheKey, response.clone(), cacheTtl, ctx);
    }

    return response;
  } catch (err) {
    // Log error details for observability
    const errorLog = {
      event: "error",
      repo: `${owner}/${repo}`,
      ref: resolvedRef,
      errorType: err instanceof Error ? err.name : "Unknown",
      errorMessage: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    };
    console.error(JSON.stringify(errorLog));

    if (isRepoNotFoundError(err)) {
      return jsonError(404, "Repository not found or is private");
    }
    if (isZipTooLargeError(err)) {
      return jsonError(413, (err as Error).message);
    }
    if (isGitHubApiError(err)) {
      const apiErr = err as { status: number; message: string };
      const status = apiErr.status === 403 ? 429 : 502;
      return jsonError(status, apiErr.message);
    }
    if (isDecompressionError(err)) {
      return jsonError(422, `Failed to process repository archive: ${(err as Error).message}`);
    }
    if (isParseError(err)) {
      return jsonError(400, (err as Error).message);
    }
    // Unexpected error
    return jsonError(500, "Internal server error");
  }
}
