import { parseRequest } from "../engine/parser";
import { resolveDefaultRef, checkZipSize, fetchZipball } from "../engine/fetcher";
import { decompressAndProcess } from "../engine/decompressor";
import { formatOutput, formatFileBlock, formatSummary, formatTree } from "../engine/formatter";
import { buildResponseHeaders } from "../utils/headers";
import { checkRateLimit } from "../utils/ratelimit";
import { buildCacheKey, getCached, putCache } from "../utils/cache";
import {
  ParseError,
  RepoNotFoundError,
  ZipTooLargeError,
  GitHubApiError,
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

  // ── 1. Parse request ──────────────────────────────────────────────────────
  let parsed;
  try {
    parsed = parseRequest(request);
  } catch (err) {
    if (err instanceof ParseError) {
      return jsonError(400, err.message);
    }
    return jsonError(400, "Invalid request.");
  }

  const { owner, repo, detail, noCache } = parsed;

  // ── 2. Rate limit check ───────────────────────────────────────────────────
  const clientIP = getClientIP(request);
  const rateLimitResult = await checkRateLimit(env, clientIP);
  if (!rateLimitResult.allowed) {
    const retryAfter = rateLimitResult.retryAfter ?? 60;
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

  // Build rate-limit response early for 429
  const cacheKey = buildCacheKey(parsed);

  // ── 3. Check cache ────────────────────────────────────────────────────────
  if (!noCache) {
    const cached = await getCached(cacheKey);
    if (cached) {
      const cachedResponse = new Response(cached.body, {
        status: cached.status,
        headers: new Headers(cached.headers),
      });
      cachedResponse.headers.set("X-Cache", "HIT");
      return cachedResponse;
    }
  }

  try {
    // ── 4. Resolve default ref ──────────────────────────────────────────────
    let ref = parsed.ref;
    if (!ref) {
      ref = await resolveDefaultRef(owner, repo, env);
    }

    // ── 5. Pre-flight size check ────────────────────────────────────────────
    await checkZipSize(owner, repo, ref, env);

    // ── 6. Fetch zipball ────────────────────────────────────────────────────
    const { data: zipData, rateLimitRemaining, rateLimitReset } = await fetchZipball(
      owner,
      repo,
      ref,
      env
    );

    // ── 7. Decompress and process ───────────────────────────────────────────
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
    result.ref = ref;

    // ── 8. Build response headers ───────────────────────────────────────────
    const headers = buildResponseHeaders({
      result,
      rateLimitRemaining,
      rateLimitReset,
      cacheStatus: "MISS",
    });

    // ── 9. Emit structured log ──────────────────────────────────────────────
    console.log(
      JSON.stringify({
        event: "ingest",
        repo: `${owner}/${repo}`,
        ref,
        detail,
        cacheHit: false,
        fileCount: result.fileCount,
        totalSize: result.totalSize,
        truncated: result.truncated,
        rateLimitRemaining,
        latencyMs: Date.now() - startTime,
      })
    );

    // ── 10. Stream response for detail=full, otherwise return all at once ───
    if (detail === "full") {
      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      const summaryBlock = formatSummary(result);
      const treeBlock = formatTree(result.files);
      const header =
        summaryBlock + "\n## Directory Structure\n\n" + treeBlock + "\n## File Contents\n\n";

      ctx.waitUntil(
        (async () => {
          await writer.write(encoder.encode(header));
          for (const file of result.files) {
            await writer.write(encoder.encode(formatFileBlock(file)));
          }
          if (result.truncated && result.truncationMessage) {
            await writer.write(encoder.encode("\n" + result.truncationMessage + "\n"));
          }
          await writer.close();
        })()
      );

      const response = new Response(readable, { headers });

      // Cache a non-streaming clone: build the full string and cache it
      const fullContent = formatOutput(result, "full");
      const cacheableResponse = new Response(fullContent, {
        status: 200,
        headers: new Headers(headers),
      });
      const cacheTtl = parseInt(env.CACHE_TTL_SECONDS ?? "3600", 10);
      putCache(cacheKey, cacheableResponse, cacheTtl, ctx);

      return response;
    }

    // Non-streaming path
    const content = formatOutput(result, detail);
    const response = new Response(content, { status: 200, headers });

    // Cache the response
    const cacheTtl = parseInt(env.CACHE_TTL_SECONDS ?? "3600", 10);
    putCache(cacheKey, response.clone(), cacheTtl, ctx);

    return response;
  } catch (err) {
    if (err instanceof RepoNotFoundError) {
      return jsonError(404, "Repository not found or is private");
    }
    if (err instanceof ZipTooLargeError) {
      return jsonError(413, err.message);
    }
    if (err instanceof GitHubApiError) {
      return jsonError(502, `GitHub API returned ${err.status}`);
    }
    // Unexpected error
    console.error("Unexpected error in handleIngest:", err);
    return jsonError(500, "Internal server error");
  }
}
