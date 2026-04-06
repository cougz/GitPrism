import {
  GitHubApiError,
  RepoNotFoundError,
  ZipTooLargeError,
  type Env,
} from "../types";

const GITHUB_API_BASE = "https://api.github.com";
const USER_AGENT = "GitPrism/1.0";

function buildHeaders(env: Env, userToken?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    "Accept": "application/vnd.github+json",
  };
  const token = userToken || env.GITHUB_TOKEN;
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
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
  env: Env,
  userToken?: string
): Promise<string> {
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}`;
  const res = await fetch(url, { headers: buildHeaders(env, userToken) });

  if (res.status === 404) {
    throw new RepoNotFoundError(`Repository ${owner}/${repo} not found or is private.`);
  }
  if (res.status === 403) {
    const rateLimitRemaining = res.headers.get("X-RateLimit-Remaining");
    const rateLimitReset = res.headers.get("X-RateLimit-Reset");
    
    // If X-RateLimit-Remaining header exists and is "0", it's definitely rate limiting
    if (rateLimitRemaining !== null && rateLimitRemaining === "0") {
      const resetTime = rateLimitReset ? new Date(parseInt(rateLimitReset) * 1000).toISOString() : "soon";
      throw new GitHubApiError(403, `GitHub API rate limit exceeded. Resets at ${resetTime}.`);
    }
    
    // For other 403s, try to get more details from response
    const body = await res.text();
    const message = body.includes("rate limit") 
      ? "GitHub API rate limit exceeded." 
      : `GitHub API access denied: ${body || "403 Forbidden"}`;
    throw new GitHubApiError(403, message);
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
  env: Env,
  userToken?: string
): Promise<void> {
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/zipball/${ref}`;
  const res = await fetch(url, {
    method: "HEAD",
    redirect: "follow",
    headers: buildHeaders(env, userToken),
  });

  if (res.status === 404) {
    throw new RepoNotFoundError(`Repository ${owner}/${repo} not found or is private.`);
  }
  if (res.status === 403) {
    const rateLimitRemaining = res.headers.get("X-RateLimit-Remaining");
    const rateLimitReset = res.headers.get("X-RateLimit-Reset");
    
    if (rateLimitRemaining !== null && rateLimitRemaining === "0") {
      const resetTime = rateLimitReset ? new Date(parseInt(rateLimitReset) * 1000).toISOString() : "soon";
      throw new GitHubApiError(403, `GitHub API rate limit exceeded. Resets at ${resetTime}.`);
    }
    throw new GitHubApiError(403, "GitHub API access denied (403)");
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

/**
 * Resolves any ref (branch, tag, or SHA) to its commit SHA.
 * Returns undefined if resolution fails (caller should skip caching).
 */
export async function resolveRefToSha(
  owner: string,
  repo: string,
  ref: string,
  env: Env,
  userToken?: string
): Promise<string | undefined> {
  try {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/commits/${ref}`;
    const res = await fetch(url, { headers: buildHeaders(env, userToken) });

    if (!res.ok) {
      return undefined;
    }

    const data = await res.json() as { sha: string };
    return data.sha;
  } catch {
    return undefined;
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
  env: Env,
  userToken?: string
): Promise<FetchZipballResult> {
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/zipball/${ref}`;
  const res = await fetch(url, {
    redirect: "follow",
    headers: buildHeaders(env, userToken),
  });

  if (res.status === 404) {
    throw new RepoNotFoundError(`Repository ${owner}/${repo} not found or is private.`);
  }
  if (res.status === 403) {
    const rateLimitRemaining = res.headers.get("X-RateLimit-Remaining");
    const rateLimitReset = res.headers.get("X-RateLimit-Reset");
    
    if (rateLimitRemaining !== null && rateLimitRemaining === "0") {
      const resetTime = rateLimitReset ? new Date(parseInt(rateLimitReset) * 1000).toISOString() : "soon";
      throw new GitHubApiError(403, `GitHub API rate limit exceeded. Resets at ${resetTime}.`);
    }
    throw new GitHubApiError(403, "GitHub API access denied (403)");
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

export interface CommitInfo {
  sha: string;
  author: string;
  date: string;
  message: string;
  filesChanged: number;
}

export async function fetchCommits(
  owner: string,
  repo: string,
  ref: string,
  env: Env,
  userToken?: string,
  path?: string
): Promise<CommitInfo[]> {
  const params = new URLSearchParams({
    sha: ref,
    per_page: "10",
  });
  
  if (path) {
    params.set("path", path);
  }

  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/commits?${params.toString()}`;
  const res = await fetch(url, { headers: buildHeaders(env, userToken) });

  if (res.status === 404) {
    throw new RepoNotFoundError(`Repository ${owner}/${repo} not found or is private.`);
  }
  if (res.status === 403) {
    const rateLimitRemaining = res.headers.get("X-RateLimit-Remaining");
    const rateLimitReset = res.headers.get("X-RateLimit-Reset");
    
    if (rateLimitRemaining !== null && rateLimitRemaining === "0") {
      const resetTime = rateLimitReset ? new Date(parseInt(rateLimitReset) * 1000).toISOString() : "soon";
      throw new GitHubApiError(403, `GitHub API rate limit exceeded. Resets at ${resetTime}.}`);
    }
    throw new GitHubApiError(403, "GitHub API access denied (403)");
  }
  if (!res.ok) {
    throw new GitHubApiError(res.status, `GitHub API returned ${res.status}`);
  }

  const commits = await res.json() as Array<{
    sha: string;
    commit: {
      author: {
        name: string;
        date: string;
      };
      message: string;
    };
    files?: Array<unknown>;
  }>;

  return commits.map((commit) => ({
    sha: commit.sha.substring(0, 7),
    author: commit.commit.author.name,
    date: new Date(commit.commit.author.date).toISOString().split("T")[0],
    message: commit.commit.message.split("\n")[0],
    filesChanged: commit.files?.length ?? 0,
  }));
}
