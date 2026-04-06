export interface Env {
  GITHUB_TOKEN?: string;
  ASSETS: Fetcher;
  RATE_LIMITER: RateLimit;
  MAX_ZIP_BYTES: string;
  MAX_OUTPUT_BYTES: string;
  MAX_FILE_COUNT: string;
  CACHE_TTL_SECONDS: string;
}

export type DetailLevel = "summary" | "structure" | "file-list" | "file-contents" | "commits" | "full";

export interface ParsedRequest {
  owner: string;
  repo: string;
  ref?: string;
  path?: string;
  detail: DetailLevel[];
  noCache: boolean;
  userToken?: string;
}

export interface FileEntry {
  path: string;
  size: number;
  content?: string;
  lines?: number;
}

export interface IngestResult {
  owner: string;
  repo: string;
  repoName: string;
  ref: string;
  fileCount: number;
  totalSize: number;
  truncated: boolean;
  truncationMessage?: string;
  files: FileEntry[];
}

export class ParseError extends Error {
  readonly __type = "ParseError";
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

export class RepoNotFoundError extends Error {
  readonly __type = "RepoNotFoundError";
  constructor(message: string) {
    super(message);
    this.name = "RepoNotFoundError";
  }
}

export class ZipTooLargeError extends Error {
  readonly __type = "ZipTooLargeError";
  constructor(message: string) {
    super(message);
    this.name = "ZipTooLargeError";
  }
}

export class GitHubApiError extends Error {
  status: number;
  readonly __type = "GitHubApiError";
  constructor(status: number, message: string) {
    super(message);
    this.name = "GitHubApiError";
    this.status = status;
  }
}

export class DecompressionError extends Error {
  readonly __type = "DecompressionError";
  constructor(message: string) {
    super(message);
    this.name = "DecompressionError";
  }
}

// Type guards that work after bundling
export function isParseError(err: unknown): err is ParseError {
  return err instanceof Error && (err as ParseError).__type === "ParseError";
}

export function isRepoNotFoundError(err: unknown): err is RepoNotFoundError {
  return err instanceof Error && (err as RepoNotFoundError).__type === "RepoNotFoundError";
}

export function isZipTooLargeError(err: unknown): err is ZipTooLargeError {
  return err instanceof Error && (err as ZipTooLargeError).__type === "ZipTooLargeError";
}

export function isGitHubApiError(err: unknown): err is GitHubApiError {
  return err instanceof Error && (err as GitHubApiError).__type === "GitHubApiError";
}

export function isDecompressionError(err: unknown): err is DecompressionError {
  return err instanceof Error && (err as DecompressionError).__type === "DecompressionError";
}
