import type { DetailLevel, FileEntry, IngestResult } from "../types";

// ── Language detection ────────────────────────────────────────────────────────

const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  cs: "csharp",
  rb: "ruby",
  php: "php",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  md: "markdown",
  mdx: "markdown",
  json: "json",
  jsonc: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  sass: "scss",
  less: "css",
  xml: "xml",
  svg: "xml",
  sql: "sql",
  graphql: "graphql",
  gql: "graphql",
  tf: "hcl",
  hcl: "hcl",
  dockerfile: "dockerfile",
  swift: "swift",
  r: "r",
  lua: "lua",
  vim: "vim",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  hrl: "erlang",
  hs: "haskell",
  lhs: "haskell",
  clj: "clojure",
  cljs: "clojure",
  scala: "scala",
  dart: "dart",
  vue: "vue",
  astro: "astro",
  nix: "nix",
};

export function detectLanguage(filePath: string): string {
  const fileName = filePath.split("/").pop() ?? filePath;

  // Handle "Dockerfile" and similar no-extension files
  if (fileName.toLowerCase() === "dockerfile") return "dockerfile";
  if (fileName.toLowerCase() === "makefile") return "makefile";

  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex === -1 || dotIndex === fileName.length - 1) return "";

  const ext = fileName.slice(dotIndex + 1).toLowerCase();
  return EXT_TO_LANG[ext] ?? "";
}

// ── Summary block ─────────────────────────────────────────────────────────────

export function formatSummary(result: IngestResult): string {
  const lines = [
    "---",
    `repo: ${result.repoName}`,
    `ref: ${result.ref}`,
    `files: ${result.fileCount}`,
    `size: ${result.totalSize}`,
    `truncated: ${result.truncated}`,
    "---",
    "",
    `# ${result.repoName}`,
    "",
    `**Ref:** \`${result.ref}\`  `,
    `**Files:** ${result.fileCount}  `,
    `**Total size:** ${formatBytes(result.totalSize)}  `,
    "",
  ];
  return lines.join("\n");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── ASCII tree ────────────────────────────────────────────────────────────────

interface TreeNode {
  name: string;
  isDir: boolean;
  children: Map<string, TreeNode>;
}

function buildTree(files: FileEntry[]): TreeNode {
  const root: TreeNode = { name: "", isDir: true, children: new Map() };

  for (const file of files) {
    const parts = file.path.split("/");
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isDir = i < parts.length - 1;
      if (!node.children.has(part)) {
        node.children.set(part, { name: part, isDir, children: new Map() });
      }
      node = node.children.get(part)!;
    }
  }
  return root;
}

function renderTree(node: TreeNode, prefix: string, isLast: boolean, isRoot: boolean): string {
  if (isRoot) {
    let output = "";
    const children = [...node.children.values()];
    for (let i = 0; i < children.length; i++) {
      output += renderTree(children[i], "", i === children.length - 1, false);
    }
    return output;
  }

  const connector = isLast ? "└── " : "├── ";
  const displayName = node.isDir ? `${node.name}/` : node.name;
  let output = `${prefix}${connector}${displayName}\n`;

  const childPrefix = prefix + (isLast ? "    " : "│   ");
  const children = [...node.children.values()];
  for (let i = 0; i < children.length; i++) {
    output += renderTree(children[i], childPrefix, i === children.length - 1, false);
  }
  return output;
}

export function formatTree(files: FileEntry[], rootName?: string): string {
  const tree = buildTree(files);
  const header = rootName ? `${rootName}/\n` : "./\n";
  const body = renderTree(tree, "", true, true);
  return `\`\`\`\n${header}${body}\`\`\`\n`;
}

// ── File list table ───────────────────────────────────────────────────────────

export function formatFileList(result: IngestResult): string {
  const summary = formatSummary(result);
  const tree = formatTree(result.files);

  const rows = result.files
    .map((f) => `| ${f.path} | ${f.size} | ${f.lines ?? "-"} |`)
    .join("\n");

  const table = [
    "## File List",
    "",
    "| Path | Size (bytes) | Lines |",
    "|------|-------------|-------|",
    rows,
    "",
  ].join("\n");

  return summary + "\n## Directory Structure\n\n" + tree + "\n" + table;
}

// ── Full content ──────────────────────────────────────────────────────────────

export function formatFileBlock(file: FileEntry): string {
  const lang = detectLanguage(file.path);
  const fence = `\`\`\`${lang}`;
  return [
    `### \`${file.path}\``,
    "",
    fence,
    file.content ?? "",
    "```",
    "",
  ].join("\n");
}

export function formatFull(result: IngestResult): string {
  const summary = formatSummary(result);
  const tree = formatTree(result.files);

  let content = summary + "\n## Directory Structure\n\n" + tree + "\n## File Contents\n\n";

  for (const file of result.files) {
    content += formatFileBlock(file);
  }

  if (result.truncated && result.truncationMessage) {
    content += "\n" + result.truncationMessage + "\n";
  }

  return content;
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

export function formatOutput(result: IngestResult, detail: DetailLevel): string {
  switch (detail) {
    case "summary":
      return formatSummary(result);
    case "structure":
      return formatSummary(result) + "\n## Directory Structure\n\n" + formatTree(result.files);
    case "file-list":
      return formatFileList(result);
    case "full":
      return formatFull(result);
  }
}
