import { describe, it, expect } from "vitest";
import {
  shouldIgnorePath,
  isBinaryContent,
  parseGitignore,
  filterBySubpath,
} from "../../src/engine/filter";
import type { FileEntry } from "../../src/types";

describe("shouldIgnorePath – ignored directories", () => {
  it("ignores node_modules", () => {
    expect(shouldIgnorePath("node_modules/lodash/index.js")).toBe(true);
  });
  it("ignores .git", () => {
    expect(shouldIgnorePath(".git/config")).toBe(true);
  });
  it("ignores vendor", () => {
    expect(shouldIgnorePath("vendor/autoload.php")).toBe(true);
  });
  it("ignores __pycache__", () => {
    expect(shouldIgnorePath("__pycache__/main.cpython-310.pyc")).toBe(true);
  });
  it("ignores dist", () => {
    expect(shouldIgnorePath("dist/bundle.js")).toBe(true);
  });
  it("ignores build", () => {
    expect(shouldIgnorePath("build/output.js")).toBe(true);
  });
  it("ignores .next", () => {
    expect(shouldIgnorePath(".next/server/pages/index.js")).toBe(true);
  });
  it("ignores coverage", () => {
    expect(shouldIgnorePath("coverage/lcov.info")).toBe(true);
  });
});

describe("shouldIgnorePath – ignored files", () => {
  it("ignores package-lock.json", () => {
    expect(shouldIgnorePath("package-lock.json")).toBe(true);
  });
  it("ignores yarn.lock", () => {
    expect(shouldIgnorePath("yarn.lock")).toBe(true);
  });
  it("ignores pnpm-lock.yaml", () => {
    expect(shouldIgnorePath("pnpm-lock.yaml")).toBe(true);
  });
  it("ignores Cargo.lock", () => {
    expect(shouldIgnorePath("Cargo.lock")).toBe(true);
  });
  it("ignores go.sum", () => {
    expect(shouldIgnorePath("go.sum")).toBe(true);
  });
  it("ignores *.min.js", () => {
    expect(shouldIgnorePath("static/app.min.js")).toBe(true);
  });
  it("ignores *.min.css", () => {
    expect(shouldIgnorePath("static/app.min.css")).toBe(true);
  });
  it("ignores *.map files", () => {
    expect(shouldIgnorePath("src/index.js.map")).toBe(true);
  });
  it("ignores *.pyc", () => {
    expect(shouldIgnorePath("src/main.pyc")).toBe(true);
  });
});

describe("shouldIgnorePath – binary extensions", () => {
  it("ignores .png", () => {
    expect(shouldIgnorePath("assets/logo.png")).toBe(true);
  });
  it("ignores .jpg", () => {
    expect(shouldIgnorePath("images/photo.jpg")).toBe(true);
  });
  it("ignores .woff2", () => {
    expect(shouldIgnorePath("fonts/font.woff2")).toBe(true);
  });
  it("ignores .pdf", () => {
    expect(shouldIgnorePath("docs/spec.pdf")).toBe(true);
  });
  it("ignores .sqlite", () => {
    expect(shouldIgnorePath("data/db.sqlite")).toBe(true);
  });
  it("ignores .exe", () => {
    expect(shouldIgnorePath("bin/app.exe")).toBe(true);
  });
  it("ignores .DS_Store", () => {
    expect(shouldIgnorePath(".DS_Store")).toBe(true);
  });
  it("ignores .svg", () => {
    expect(shouldIgnorePath("icons/icon.svg")).toBe(true);
  });
});

describe("shouldIgnorePath – allowed files", () => {
  it("allows src/index.ts", () => {
    expect(shouldIgnorePath("src/index.ts")).toBe(false);
  });
  it("allows README.md", () => {
    expect(shouldIgnorePath("README.md")).toBe(false);
  });
  it("allows src/components/Button.tsx", () => {
    expect(shouldIgnorePath("src/components/Button.tsx")).toBe(false);
  });
  it("allows package.json (not package-lock)", () => {
    expect(shouldIgnorePath("package.json")).toBe(false);
  });
  it("allows Cargo.toml (not Cargo.lock)", () => {
    expect(shouldIgnorePath("Cargo.toml")).toBe(false);
  });
});

describe("isBinaryContent", () => {
  it("detects null bytes as binary", () => {
    const buf = new Uint8Array(100);
    buf[50] = 0; // null byte
    expect(isBinaryContent(buf)).toBe(true);
  });

  it("identifies pure text as non-binary", () => {
    const text = "const x = 1;\nconsole.log(x);\n";
    const buf = new TextEncoder().encode(text);
    expect(isBinaryContent(buf)).toBe(false);
  });

  it("only checks first 8192 bytes", () => {
    // Fill with non-zero values, then put a null byte beyond the check window
    const buf = new Uint8Array(10000).fill(65); // 'A'
    buf[9000] = 0;
    expect(isBinaryContent(buf)).toBe(false);
  });

  it("treats empty buffer as non-binary", () => {
    expect(isBinaryContent(new Uint8Array(0))).toBe(false);
  });
});

describe("parseGitignore", () => {
  it("ignores paths matching a simple pattern", () => {
    const matcher = parseGitignore("*.log\n");
    expect(matcher("error.log")).toBe(true);
    expect(matcher("src/error.log")).toBe(true);
    expect(matcher("src/index.ts")).toBe(false);
  });

  it("ignores paths matching a directory pattern", () => {
    // Standard gitignore: trailing-slash pattern without leading slash matches at any depth
    const matcher = parseGitignore("logs/\n");
    expect(matcher("logs/error.log")).toBe(true);
    expect(matcher("src/logs/error.log")).toBe(true);
  });

  it("handles negation patterns", () => {
    const matcher = parseGitignore("*.log\n!important.log\n");
    expect(matcher("error.log")).toBe(true);
    expect(matcher("important.log")).toBe(false);
  });

  it("ignores comment lines", () => {
    const matcher = parseGitignore("# this is a comment\n*.log\n");
    expect(matcher("error.log")).toBe(true);
  });

  it("ignores empty lines", () => {
    const matcher = parseGitignore("\n\n*.log\n\n");
    expect(matcher("error.log")).toBe(true);
  });

  it("handles rooted patterns (starting with /)", () => {
    const matcher = parseGitignore("/build\n");
    expect(matcher("build/output.js")).toBe(true);
    expect(matcher("src/build/output.js")).toBe(false);
  });
});

describe("filterBySubpath", () => {
  const files: FileEntry[] = [
    { path: "src/index.ts", size: 100 },
    { path: "src/components/Button.tsx", size: 200 },
    { path: "README.md", size: 50 },
    { path: "src/utils/helper.ts", size: 75 },
  ];

  it("returns only files under the specified subpath", () => {
    const result = filterBySubpath(files, "src");
    expect(result).toHaveLength(3);
    expect(result.every((f) => !f.path.startsWith("README"))).toBe(true);
  });

  it("strips the subpath prefix from file paths", () => {
    const result = filterBySubpath(files, "src");
    expect(result[0].path).toBe("index.ts");
    expect(result[1].path).toBe("components/Button.tsx");
  });

  it("filters to deeper subpath", () => {
    const result = filterBySubpath(files, "src/components");
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("Button.tsx");
  });

  it("returns all files when subpath is empty string", () => {
    const result = filterBySubpath(files, "");
    expect(result).toHaveLength(4);
  });

  it("returns empty array when no files match", () => {
    const result = filterBySubpath(files, "nonexistent");
    expect(result).toHaveLength(0);
  });
});
