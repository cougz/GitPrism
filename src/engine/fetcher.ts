import {
  GitHubApiError,
  RepoNotFoundError,
  ZipTooLargeError,
  type Env,
} from "../types";

const GITHUB_API_BASE = "https://api.github.com";
const USER_AGENT = "GitPrism/1.0";

function buildHeaders(env: Env): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    "Accept": "application/vnd.github+json",
  };
  if (env.GITHUB_TOKEN) {
    headers["Authorization"] = `Bearer ${env.GITHUB_TOKEN}`;
  }
  return headers;
}

function maxZipBytes(env: Env): number {
  return parseInt(env.MAX_ZIP_BYTES ?? "52428800", 10);
}

/**
 * Resolves the default branch for a repository.
 * Used when no ref is specified in the request.
 */
export async function resolveDefaultRef(
  owner: string,
  repo: string,
  env: Env
): Promise<string> {
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}`;
  const res = await fetch(url, { headers: buildHeaders(env) });

  if (res.status === 404) {
    throw new RepoNotFoundError(`Repository ${owner}/${repo} not found or is private.`);
  }
  if (!res.ok) {
    throw new GitHubApiError(res.status, `GitHub API returned ${res.status}`);
  }

  const data = await res.json() as { default_branch: string };
  return data.default_branch;
}

/**
 * Performs a pre-flight size check on the zipball before downloading.
 * Throws ZipTooLargeError if the archive exceeds MAX_ZIP_BYTES.
 */
export async function checkZipSize(
  owner: string,
  repo: string,
  ref: string,
  env: Env
): Promise<void> {
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/zipball/${ref}`;
  const res = await fetch(url, {
    method: "HEAD",
    redirect: "follow",
    headers: buildHeaders(env),
  });

  if (res.status === 404) {
    throw new RepoNotFoundError(`Repository ${owner}/${repo} not found or is private.`);
  }
  if (!res.ok) {
    throw new GitHubApiError(res.status, `GitHub API returned ${res.status}`);
  }

  const contentLength = res.headers.get("Content-Length");
  if (contentLength) {
    const size = parseInt(contentLength, 10);
    const limit = maxZipBytes(env);
    if (size > limit) {
      throw new ZipTooLargeError(
        `Repository archive exceeds ${Math.round(limit / 1024 / 1024)} MB limit. ` +
          "Use ?path= to target a subdirectory."
      );
    }
  }
}

export interface FetchZipballResult {
  data: Uint8Array;
  rateLimitRemaining: string;
  rateLimitReset: string;
}

/**
 * Downloads the repository zipball and returns the raw bytes plus rate limit info.
 */
export async function fetchZipball(
  owner: string,
  repo: string,
  ref: string,
  env: Env
): Promise<FetchZipballResult> {
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/zipball/${ref}`;
  const res = await fetch(url, {
    redirect: "follow",
    headers: buildHeaders(env),
  });

  if (res.status === 404) {
    throw new RepoNotFoundError(`Repository ${owner}/${repo} not found or is private.`);
  }
  if (!res.ok) {
    throw new GitHubApiError(res.status, `GitHub API returned ${res.status}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const data = new Uint8Array(arrayBuffer);

  return {
    data,
    rateLimitRemaining: res.headers.get("X-RateLimit-Remaining") ?? "",
    rateLimitReset: res.headers.get("X-RateLimit-Reset") ?? "",
  };
}
