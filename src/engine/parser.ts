import { ParseError, type DetailLevel, type ParsedRequest } from "../types";

const VALID_DETAIL_LEVELS = new Set<string>(["summary", "structure", "file-list", "full"]);

function parseDetail(raw: string | null): DetailLevel {
  if (!raw) return "full";
  if (!VALID_DETAIL_LEVELS.has(raw)) {
    throw new ParseError(
      `Invalid detail level "${raw}". Must be one of: summary, structure, file-list, full.`
    );
  }
  return raw as DetailLevel;
}

function parseOwnerRepo(raw: string): { owner: string; repo: string } {
  const parts = raw.split("/");
  if (parts.length < 2) {
    throw new ParseError(
      `Could not parse repo "${raw}". Expected format: owner/repo`
    );
  }
  const owner = parts[0].trim();
  const repo = parts[1].trim();
  if (!owner) {
    throw new ParseError("Repository owner must not be empty.");
  }
  if (!repo) {
    throw new ParseError("Repository name must not be empty.");
  }
  return { owner, repo };
}

/**
 * Parse an incoming Worker request into a structured ParsedRequest.
 * Supports two forms:
 *   1. /ingest?repo=owner/repo&ref=...&path=...&detail=...
 *   2. /https://github.com/owner/repo[/tree/ref[/subpath]]
 */
export function parseRequest(request: Request): ParsedRequest {
  const url = new URL(request.url);
  const noCache = url.searchParams.get("no-cache") === "true";
  const detail = parseDetail(url.searchParams.get("detail"));

  // ── Canonical form: /ingest ──────────────────────────────────────────────
  if (url.pathname === "/ingest") {
    const repoParam = url.searchParams.get("repo");
    if (!repoParam || !repoParam.trim()) {
      throw new ParseError(
        'Missing required "repo" parameter. Expected format: ?repo=owner/repo'
      );
    }
    const { owner, repo } = parseOwnerRepo(repoParam);
    const ref = url.searchParams.get("ref") ?? undefined;
    const path = url.searchParams.get("path") ?? undefined;
    return { owner, repo, ref: ref || undefined, path: path || undefined, detail, noCache };
  }

  // ── URL-appended shorthand: /https://github.com/... ──────────────────────
  if (url.pathname.startsWith("/https://github.com/")) {
    // Strip the leading "/" to recover the full GitHub URL
    const githubUrl = url.pathname.slice(1);
    // Parse as URL to extract the path segments
    let ghPath: string;
    try {
      ghPath = new URL(githubUrl).pathname;
    } catch {
      throw new ParseError(`Could not parse GitHub URL: ${githubUrl}`);
    }

    // pathname: /owner/repo[/tree/ref[/subpath...]]
    const segments = ghPath.replace(/^\//, "").split("/");
    if (segments.length < 2 || !segments[0] || !segments[1]) {
      throw new ParseError(
        `Could not parse GitHub URL. Expected format: https://github.com/owner/repo`
      );
    }

    const owner = segments[0];
    const repo = segments[1];
    let ref: string | undefined;
    let path: string | undefined;

    // segments: [owner, repo, "tree", ref, ...subpath]
    if (segments.length >= 4 && segments[2] === "tree") {
      ref = segments[3];
      if (segments.length > 4) {
        path = segments.slice(4).join("/");
      }
    }

    return { owner, repo, ref, path, detail, noCache };
  }

  throw new ParseError(
    "Request did not match any supported route. Use /ingest?repo=owner/repo or /https://github.com/owner/repo"
  );
}
