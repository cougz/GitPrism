import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { decompressAndProcess } from "../../src/engine/decompressor";
import type { DecompressOptions } from "../../src/engine/decompressor";

/**
 * Creates a test zip buffer that mimics GitHub's zipball format.
 * GitHub adds a top-level directory: owner-repo-sha/
 */
function makeZip(
  files: Record<string, string>,
  prefix = "owner-repo-abc123/"
): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, content] of Object.entries(files)) {
    entries[prefix + name] = strToU8(content);
  }
  return zipSync(entries);
}

const defaultOptions: DecompressOptions = {
  detail: "full",
  maxOutputBytes: 10 * 1024 * 1024,
  maxFileCount: 5000,
};

describe("decompressAndProcess – basic extraction", () => {
  it("extracts text files and strips prefix", () => {
    const zip = makeZip({
      "src/index.ts": "const x = 1;",
      "README.md": "# Hello",
    });
    const result = decompressAndProcess(zip, defaultOptions);
    expect(result.fileCount).toBe(2);
    const paths = result.files.map((f) => f.path);
    expect(paths).toContain("src/index.ts");
    expect(paths).toContain("README.md");
  });

  it("strips GitHub top-level prefix directory", () => {
    const zip = makeZip({ "main.py": "print('hello')" }, "cloudflare-workers-sdk-deadbeef/");
    const result = decompressAndProcess(zip, defaultOptions);
    expect(result.files[0].path).toBe("main.py");
  });

  it("includes file content when detail=full", () => {
    const zip = makeZip({ "src/app.ts": "export const app = 1;" });
    const result = decompressAndProcess(zip, { ...defaultOptions, detail: "full" });
    expect(result.files[0].content).toBe("export const app = 1;");
  });

  it("excludes file content when detail=summary", () => {
    const zip = makeZip({ "src/app.ts": "export const app = 1;" });
    const result = decompressAndProcess(zip, { ...defaultOptions, detail: "summary" });
    expect(result.files[0].content).toBeUndefined();
  });

  it("counts lines correctly", () => {
    const zip = makeZip({ "src/app.ts": "line1\nline2\nline3" });
    const result = decompressAndProcess(zip, defaultOptions);
    expect(result.files[0].lines).toBe(3);
  });

  it("computes totalSize correctly", () => {
    const zip = makeZip({
      "a.ts": "abc",   // 3 bytes
      "b.ts": "abcde", // 5 bytes
    });
    const result = decompressAndProcess(zip, defaultOptions);
    expect(result.totalSize).toBe(8);
  });
});

describe("decompressAndProcess – filtering", () => {
  it("skips node_modules files", () => {
    const zip = makeZip({
      "src/index.ts": "code",
      "node_modules/lodash/index.js": "lodash",
    });
    const result = decompressAndProcess(zip, defaultOptions);
    expect(result.fileCount).toBe(1);
    expect(result.files[0].path).toBe("src/index.ts");
  });

  it("skips package-lock.json", () => {
    const zip = makeZip({
      "src/index.ts": "code",
      "package-lock.json": '{"lockfileVersion": 2}',
    });
    const result = decompressAndProcess(zip, defaultOptions);
    expect(result.fileCount).toBe(1);
  });

  it("skips binary files detected by null bytes", () => {
    const entries: Record<string, Uint8Array> = {
      "owner-repo-abc/src/index.ts": strToU8("code"),
    };
    // Binary file with null bytes
    const binaryData = new Uint8Array(100);
    binaryData[10] = 0;
    entries["owner-repo-abc/image.data"] = binaryData;
    const zip = zipSync(entries);
    const result = decompressAndProcess(zip, defaultOptions);
    expect(result.files.every((f) => f.path !== "image.data")).toBe(true);
  });

  it("skips binary extension files", () => {
    const zip = makeZip({
      "src/index.ts": "code",
      "assets/logo.png": "fake png data",
    });
    const result = decompressAndProcess(zip, defaultOptions);
    expect(result.files.every((f) => !f.path.endsWith(".png"))).toBe(true);
  });

  it("applies root .gitignore patterns", () => {
    const zip = makeZip({
      ".gitignore": "*.log\ndebug/\n",
      "src/index.ts": "code",
      "error.log": "some error",
      "debug/trace.txt": "debug data",
    });
    const result = decompressAndProcess(zip, defaultOptions);
    const paths = result.files.map((f) => f.path);
    expect(paths).not.toContain("error.log");
    expect(paths).not.toContain("debug/trace.txt");
    expect(paths).toContain("src/index.ts");
  });
});

describe("decompressAndProcess – subpath filtering", () => {
  it("includes only files under the subpath", () => {
    const zip = makeZip({
      "src/index.ts": "code",
      "src/utils/helper.ts": "helper",
      "README.md": "readme",
    });
    const result = decompressAndProcess(zip, { ...defaultOptions, subpath: "src" });
    expect(result.fileCount).toBe(2);
    const paths = result.files.map((f) => f.path);
    expect(paths).not.toContain("README.md");
  });

  it("strips subpath prefix from file paths", () => {
    const zip = makeZip({ "src/utils/helper.ts": "code" });
    const result = decompressAndProcess(zip, { ...defaultOptions, subpath: "src" });
    expect(result.files[0].path).toBe("utils/helper.ts");
  });
});

describe("decompressAndProcess – truncation", () => {
  it("truncates when maxFileCount is exceeded", () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 10; i++) {
      files[`file${i}.ts`] = `const x = ${i};`;
    }
    const zip = makeZip(files);
    const result = decompressAndProcess(zip, { ...defaultOptions, maxFileCount: 3 });
    expect(result.truncated).toBe(true);
    expect(result.fileCount).toBe(3);
    expect(result.truncationMessage).toContain("[TRUNCATED]");
  });

  it("truncates when maxOutputBytes is exceeded", () => {
    const zip = makeZip({
      "a.ts": "a".repeat(1000),
      "b.ts": "b".repeat(1000),
      "c.ts": "c".repeat(1000),
    });
    const result = decompressAndProcess(zip, {
      ...defaultOptions,
      detail: "full",
      maxOutputBytes: 1500,
    });
    expect(result.truncated).toBe(true);
    expect(result.truncationMessage).toContain("[TRUNCATED]");
  });

  it("is not truncated when within limits", () => {
    const zip = makeZip({ "src/index.ts": "code" });
    const result = decompressAndProcess(zip, defaultOptions);
    expect(result.truncated).toBe(false);
    expect(result.truncationMessage).toBeUndefined();
  });
});
