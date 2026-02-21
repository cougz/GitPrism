import { unzipSync } from "fflate";
import { shouldIgnorePath, isBinaryContent, parseGitignore, filterBySubpath } from "./filter";
import type { DetailLevel, FileEntry, IngestResult } from "../types";

export interface DecompressOptions {
  subpath?: string;
  detail: DetailLevel;
  maxOutputBytes: number;
  maxFileCount: number;
}

/**
 * Decompresses a GitHub zipball and processes each file entry according to
 * the ignore rules, subpath filter, and content limits.
 *
 * GitHub zipballs have a top-level directory named `owner-repo-sha/` that
 * must be stripped from all paths.
 */
export function decompressAndProcess(
  zipData: Uint8Array,
  options: DecompressOptions
): IngestResult {
  const { detail, maxOutputBytes, maxFileCount } = options;
  const subpath = options.subpath ?? "";

  const unzipped = unzipSync(zipData);

  // ── Determine the top-level prefix to strip ──────────────────────────────
  // GitHub zip: all entries start with owner-repo-sha/
  let prefix = "";
  for (const key of Object.keys(unzipped)) {
    const slash = key.indexOf("/");
    if (slash !== -1) {
      prefix = key.slice(0, slash + 1); // includes trailing slash
      break;
    }
  }

  // ── First pass: collect .gitignore content ────────────────────────────────
  let gitignoreMatcher: ((path: string) => boolean) | null = null;
  const gitignoreKey = prefix + ".gitignore";
  if (unzipped[gitignoreKey]) {
    const content = new TextDecoder().decode(unzipped[gitignoreKey]);
    gitignoreMatcher = parseGitignore(content);
  }

  // ── Second pass: process all entries ─────────────────────────────────────
  const files: FileEntry[] = [];
  let totalSize = 0;
  let truncated = false;
  let truncationMessage: string | undefined;

  // Capture total unfiltered count for truncation message
  let totalUnfiltered = 0;

  for (const [zipPath, data] of Object.entries(unzipped)) {
    // Strip the GitHub top-level prefix
    let filePath = zipPath.startsWith(prefix) ? zipPath.slice(prefix.length) : zipPath;

    // Skip empty paths (the root directory entry itself)
    if (!filePath) continue;

    // Skip directory entries (they end with /)
    if (filePath.endsWith("/")) continue;

    totalUnfiltered++;

    // Apply hardcoded ignore list
    if (shouldIgnorePath(filePath)) continue;

    // Apply .gitignore patterns
    if (gitignoreMatcher && gitignoreMatcher(filePath)) continue;

    // Apply subpath filter (before binary check to save work)
    if (subpath) {
      const subpathPrefix = subpath.endsWith("/") ? subpath : subpath + "/";
      if (!filePath.startsWith(subpathPrefix)) continue;
      filePath = filePath.slice(subpathPrefix.length);
    }

    // Binary content check (check first 8KB)
    if (isBinaryContent(data)) continue;

    // ── Limit checks ───────────────────────────────────────────────────────
    if (files.length >= maxFileCount) {
      truncated = true;
      break;
    }

    const fileSize = data.length;

    if (detail === "full" && totalSize + fileSize > maxOutputBytes) {
      truncated = true;
      break;
    }

    // ── Build file entry ───────────────────────────────────────────────────
    const entry: FileEntry = {
      path: filePath,
      size: fileSize,
    };

    if (detail === "full" || detail === "file-list") {
      // Count lines
      const text = new TextDecoder().decode(data);
      entry.lines = text.split("\n").length;

      if (detail === "full") {
        entry.content = text;
      }
    }

    files.push(entry);
    totalSize += fileSize;
  }

  if (truncated) {
    const included = files.length;
    const total = totalUnfiltered;
    truncationMessage =
      `<!-- [TRUNCATED] Output limit reached. ${included} of ${total} files included. ` +
      `Use ?path= to target a subdirectory for complete results. -->`;
  }

  const repoName = ""; // Will be filled by the caller from parsed request

  return {
    owner: "",
    repo: "",
    repoName,
    ref: "",
    fileCount: files.length,
    totalSize,
    truncated,
    truncationMessage,
    files,
  };
}
