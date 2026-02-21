import type { FileEntry } from "../types";

// ── Hardcoded ignore lists ────────────────────────────────────────────────────

const IGNORED_DIRS = new Set([
  "node_modules",
  "vendor",
  ".git",
  "__pycache__",
  ".venv",
  "venv",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".output",
  ".cache",
  ".parcel-cache",
  "coverage",
  ".tox",
  ".mypy_cache",
]);

const IGNORED_FILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "Cargo.lock",
  "composer.lock",
  "Gemfile.lock",
  "go.sum",
  "poetry.lock",
]);

const IGNORED_EXTENSIONS = new Set([
  ".min.js",
  ".min.css",
  ".map",
  ".wasm",
  ".pb.go",
  ".pyc",
  ".pyo",
]);

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".webp",
  ".bmp",
  ".tiff",
  ".svg",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".bz2",
  ".7z",
  ".rar",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".o",
  ".a",
  ".mp3",
  ".mp4",
  ".avi",
  ".mov",
  ".mkv",
  ".flac",
  ".wav",
  ".ogg",
  ".sqlite",
  ".db",
  ".DS_Store",
]);

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns true if the file path should be excluded based on the hardcoded
 * ignore list (directories, exact filenames, extensions, binary extensions).
 */
export function shouldIgnorePath(filePath: string): boolean {
  const parts = filePath.split("/");
  const fileName = parts[parts.length - 1];

  // Check if any path segment is an ignored directory
  for (let i = 0; i < parts.length - 1; i++) {
    if (IGNORED_DIRS.has(parts[i])) return true;
  }
  // Also check the filename itself as a directory component for dotfiles like .git
  if (parts.length === 1 && IGNORED_DIRS.has(parts[0])) return true;

  // Exact filename match
  if (IGNORED_FILES.has(fileName)) return true;

  // Check binary extensions (longest match first handles .min.js etc.)
  for (const ext of IGNORED_EXTENSIONS) {
    if (fileName.endsWith(ext)) return true;
  }
  for (const ext of BINARY_EXTENSIONS) {
    if (fileName.endsWith(ext)) return true;
  }

  return false;
}

/**
 * Returns true if the buffer appears to be binary content.
 * Checks only the first 8 KB for null bytes.
 */
export function isBinaryContent(buffer: Uint8Array): boolean {
  const limit = Math.min(buffer.length, 8192);
  for (let i = 0; i < limit; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

/**
 * Converts a gitignore glob pattern to a RegExp.
 * Handles: wildcards (*), globstars (**), directory-only patterns (trailing /),
 * rooted patterns (leading /), and character escaping.
 */
function gitignorePatternToRegex(pattern: string): RegExp {
  let rooted = false;

  // Strip trailing slash (directory-only marker) — we only use the prefix match logic
  const isDir = pattern.endsWith("/");
  if (isDir) pattern = pattern.slice(0, -1);

  // Rooted patterns start with /
  if (pattern.startsWith("/")) {
    rooted = true;
    pattern = pattern.slice(1);
  }

  // Escape special regex chars except * and ?
  let regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "<<<GLOBSTAR>>>")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/<<<GLOBSTAR>>>/g, ".*");

  if (isDir) {
    // Match the directory itself or any file inside it
    if (rooted) {
      return new RegExp(`^${regexStr}(/.*)?$`);
    }
    return new RegExp(`(^|/)${regexStr}(/.*)?$`);
  }

  if (rooted) {
    // Rooted name: match at root level only (as file or directory prefix)
    return new RegExp(`^${regexStr}(/.*)?$`);
  }

  // Non-rooted: match anywhere in the path
  return new RegExp(`(^|/)${regexStr}$`);
}

/**
 * Parses a .gitignore file content and returns a predicate function.
 * The predicate returns true when a path should be ignored.
 *
 * Limitation: Only the root .gitignore is supported. Nested .gitignore files
 * (e.g., src/.gitignore) are not evaluated.
 */
export function parseGitignore(content: string): (path: string) => boolean {
  const rules: Array<{ negate: boolean; regex: RegExp }> = [];

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const negate = line.startsWith("!");
    const pattern = negate ? line.slice(1) : line;
    if (!pattern) continue;

    try {
      rules.push({ negate, regex: gitignorePatternToRegex(pattern) });
    } catch {
      // Skip unparseable patterns
    }
  }

  return (path: string): boolean => {
    let ignored = false;
    for (const { negate, regex } of rules) {
      if (regex.test(path)) {
        ignored = !negate;
      }
    }
    return ignored;
  };
}

/**
 * Filters a list of FileEntry objects to only those under the given subpath,
 * and strips the subpath prefix from each file's path.
 */
export function filterBySubpath(files: FileEntry[], subpath: string): FileEntry[] {
  if (!subpath) return files;

  const prefix = subpath.endsWith("/") ? subpath : subpath + "/";
  return files
    .filter((f) => f.path.startsWith(prefix) || f.path === subpath)
    .map((f) => ({
      ...f,
      path: f.path.startsWith(prefix) ? f.path.slice(prefix.length) : f.path,
    }));
}
