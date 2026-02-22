import type { IngestResult } from "../types";

export interface BuildHeadersParams {
  result: IngestResult;
  rateLimitRemaining?: string;
  rateLimitReset?: string;
  cacheStatus?: "HIT" | "MISS";
  commitSha?: string;
}

/**
 * Builds the standard response headers for all API responses.
 */
export function buildResponseHeaders({
  result,
  rateLimitRemaining,
  rateLimitReset,
  cacheStatus = "MISS",
  commitSha,
}: BuildHeadersParams): Headers {
  const headers = new Headers({
    "Content-Type": "text/markdown; charset=utf-8",
    "X-Repo": result.repoName,
    "X-Ref": result.ref,
    "X-File-Count": String(result.fileCount),
    "X-Total-Size": String(result.totalSize),
    "X-Truncated": String(result.truncated),
    "X-Cache": cacheStatus,
  });

  if (commitSha) {
    headers.set("X-Commit-Sha", commitSha);
  }

  if (rateLimitRemaining) {
    headers.set("X-RateLimit-Remaining", rateLimitRemaining);
  }
  if (rateLimitReset) {
    headers.set("X-RateLimit-Reset", rateLimitReset);
  }

  return headers;
}
