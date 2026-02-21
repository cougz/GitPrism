import { describe, it, expect } from "vitest";
import {
  detectLanguage,
  formatSummary,
  formatTree,
  formatFileList,
  formatFull,
  formatOutput,
} from "../../src/engine/formatter";
import type { IngestResult } from "../../src/types";

const baseResult: IngestResult = {
  owner: "acme",
  repo: "myapp",
  repoName: "acme/myapp",
  ref: "main",
  fileCount: 3,
  totalSize: 375,
  truncated: false,
  files: [
    { path: "src/index.ts", size: 100, lines: 10, content: 'const x = 1;\nexport default x;\n' },
    { path: "src/utils/helper.py", size: 200, lines: 20, content: 'def hello():\n    pass\n' },
    { path: "README.md", size: 75, lines: 5, content: '# Hello\n\nWorld\n' },
  ],
};

describe("detectLanguage", () => {
  it("detects TypeScript", () => expect(detectLanguage("index.ts")).toBe("typescript"));
  it("detects TSX", () => expect(detectLanguage("App.tsx")).toBe("typescript"));
  it("detects JavaScript", () => expect(detectLanguage("app.js")).toBe("javascript"));
  it("detects JSX", () => expect(detectLanguage("App.jsx")).toBe("javascript"));
  it("detects Python", () => expect(detectLanguage("main.py")).toBe("python"));
  it("detects Rust", () => expect(detectLanguage("main.rs")).toBe("rust"));
  it("detects Go", () => expect(detectLanguage("main.go")).toBe("go"));
  it("detects Java", () => expect(detectLanguage("Main.java")).toBe("java"));
  it("detects C", () => expect(detectLanguage("main.c")).toBe("c"));
  it("detects C++", () => expect(detectLanguage("main.cpp")).toBe("cpp"));
  it("detects C#", () => expect(detectLanguage("Main.cs")).toBe("csharp"));
  it("detects Ruby", () => expect(detectLanguage("app.rb")).toBe("ruby"));
  it("detects PHP", () => expect(detectLanguage("index.php")).toBe("php"));
  it("detects Shell", () => expect(detectLanguage("build.sh")).toBe("bash"));
  it("detects Markdown", () => expect(detectLanguage("README.md")).toBe("markdown"));
  it("detects JSON", () => expect(detectLanguage("package.json")).toBe("json"));
  it("detects YAML", () => expect(detectLanguage("config.yaml")).toBe("yaml"));
  it("detects TOML", () => expect(detectLanguage("Cargo.toml")).toBe("toml"));
  it("detects HTML", () => expect(detectLanguage("index.html")).toBe("html"));
  it("detects CSS", () => expect(detectLanguage("styles.css")).toBe("css"));
  it("detects SCSS", () => expect(detectLanguage("styles.scss")).toBe("scss"));
  it("returns empty string for unknown extension", () => {
    expect(detectLanguage("file.unknownext")).toBe("");
  });
});

describe("formatSummary", () => {
  it("includes YAML front-matter block", () => {
    const output = formatSummary(baseResult);
    expect(output).toContain("---");
    expect(output).toContain("repo: acme/myapp");
    expect(output).toContain("ref: main");
    expect(output).toContain("files: 3");
    expect(output).toContain("size: 375");
  });

  it("returns a non-empty string", () => {
    expect(formatSummary(baseResult).length).toBeGreaterThan(0);
  });
});

describe("formatTree", () => {
  it("renders an ASCII tree", () => {
    const output = formatTree(baseResult.files);
    expect(output).toContain("src");
    expect(output).toContain("README.md");
    expect(output).toMatch(/[├└]/);
  });

  it("uses tree-drawing characters", () => {
    const output = formatTree(baseResult.files);
    expect(output).toMatch(/├──|└──/);
  });

  it("uses rootName when provided", () => {
    const output = formatTree(baseResult.files, "src/components");
    expect(output).toContain("src/components");
  });

  it("nests subdirectories correctly", () => {
    const output = formatTree(baseResult.files);
    // src should appear as a directory
    expect(output).toContain("src/");
    // utils should be nested under src
    expect(output).toMatch(/utils\//);
  });
});

describe("formatFileList", () => {
  it("includes summary block", () => {
    const output = formatFileList(baseResult);
    expect(output).toContain("repo: acme/myapp");
  });

  it("includes tree block", () => {
    const output = formatFileList(baseResult);
    expect(output).toContain("src/");
  });

  it("includes Markdown table header", () => {
    const output = formatFileList(baseResult);
    expect(output).toContain("| Path |");
    expect(output).toContain("| Size");
    expect(output).toContain("Lines");
  });

  it("includes file entries in the table", () => {
    const output = formatFileList(baseResult);
    expect(output).toContain("src/index.ts");
    expect(output).toContain("100");
    expect(output).toContain("10");
  });
});

describe("formatFull", () => {
  it("includes summary block", () => {
    const output = formatFull(baseResult);
    expect(output).toContain("repo: acme/myapp");
  });

  it("includes tree block", () => {
    const output = formatFull(baseResult);
    expect(output).toContain("src/");
  });

  it("includes fenced code blocks for each file", () => {
    const output = formatFull(baseResult);
    expect(output).toContain("```typescript");
    expect(output).toContain("```python");
    expect(output).toContain("```markdown");
  });

  it("includes file content in code blocks", () => {
    const output = formatFull(baseResult);
    expect(output).toContain("const x = 1;");
    expect(output).toContain("def hello():");
  });

  it("includes file path headers", () => {
    const output = formatFull(baseResult);
    expect(output).toContain("src/index.ts");
    expect(output).toContain("src/utils/helper.py");
  });
});

describe("truncation notice", () => {
  it("appends truncation notice when truncated is true", () => {
    const truncatedResult: IngestResult = {
      ...baseResult,
      truncated: true,
      truncationMessage:
        "<!-- [TRUNCATED] Output limit reached. 3 of 100 files included. Use ?path= to target a subdirectory for complete results. -->",
    };
    const output = formatFull(truncatedResult);
    expect(output).toContain("[TRUNCATED]");
  });

  it("does not append truncation notice when not truncated", () => {
    const output = formatFull(baseResult);
    expect(output).not.toContain("[TRUNCATED]");
  });
});

describe("formatOutput dispatcher", () => {
  it("dispatches to summary", () => {
    const output = formatOutput(baseResult, "summary");
    expect(output).toContain("repo: acme/myapp");
    expect(output).not.toContain("```typescript");
  });

  it("dispatches to structure", () => {
    const output = formatOutput(baseResult, "structure");
    expect(output).toContain("src/");
    expect(output).not.toContain("| Path |");
  });

  it("dispatches to file-list", () => {
    const output = formatOutput(baseResult, "file-list");
    expect(output).toContain("| Path |");
  });

  it("dispatches to full", () => {
    const output = formatOutput(baseResult, "full");
    expect(output).toContain("```typescript");
  });
});
