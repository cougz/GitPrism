export interface Env {
  GITHUB_TOKEN?: string;
  ASSETS: Fetcher;
  RATE_LIMITER: RateLimit;
  MAX_ZIP_BYTES: string;
  MAX_OUTPUT_BYTES: string;
  MAX_FILE_COUNT: string;
  CACHE_TTL_SECONDS: string;
}

export type DetailLevel = "summary" | "structure" | "file-list" | "full";

export interface ParsedRequest {
  owner: string;
  repo: string;
  ref?: string;
  path?: string;
  detail: DetailLevel;
  noCache: boolean;
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
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

export class RepoNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepoNotFoundError";
  }
}

export class ZipTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipTooLargeError";
  }
}

export class GitHubApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "GitHubApiError";
    this.status = status;
  }
}
