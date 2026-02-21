import type { ParsedRequest } from "../types";

const CACHE_BASE_URL = "https://gitprism.cloudemo.org/cache/";

/**
 * Builds a normalized cache key request from parsed request params.
 * The URL is normalized to ensure identical params produce the same key.
 */
export function buildCacheKey(parsed: ParsedRequest): Request {
  const params = new URLSearchParams();
  params.set("owner", parsed.owner);
  params.set("repo", parsed.repo);
  if (parsed.ref) params.set("ref", parsed.ref);
  if (parsed.path) params.set("path", parsed.path);
  params.set("detail", parsed.detail);

  const url = `${CACHE_BASE_URL}?${params.toString()}`;
  return new Request(url);
}

/**
 * Attempts to retrieve a cached response.
 * Returns undefined if not found or if the Cache API is unavailable.
 */
export async function getCached(cacheKey: Request): Promise<Response | undefined> {
  try {
    const cache = caches.default;
    const cached = await cache.match(cacheKey);
    return cached ?? undefined;
  } catch {
    // Cache API may not be available on *.workers.dev
    return undefined;
  }
}

/**
 * Stores a response in the cache with the given TTL.
 * Silently ignores errors (e.g., on *.workers.dev without custom domain).
 */
export function putCache(
  cacheKey: Request,
  response: Response,
  ttl: number,
  ctx: ExecutionContext
): void {
  try {
    const cacheResponse = new Response(response.clone().body, {
      status: response.status,
      headers: new Headers(response.headers),
    });
    cacheResponse.headers.set("Cache-Control", `public, max-age=${ttl}`);

    ctx.waitUntil(caches.default.put(cacheKey, cacheResponse));
  } catch {
    // Silently ignore cache errors
  }
}
