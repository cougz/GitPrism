import { parseRequest } from "./parser";
import { resolveDefaultRef, checkZipSize, fetchZipball } from "./fetcher";
import { decompressAndProcess } from "./decompressor";
import { formatOutput } from "./formatter";
import type { DetailLevel, Env } from "../types";

/**
 * Shared ingestion pipeline used by both the REST API handler and the MCP tool.
 * Takes a GitHub URL (or owner/repo shorthand), runs the full pipeline,
 * and returns the formatted Markdown as a string.
 *
 * Unlike handleIngest, this function does NOT handle caching, rate limiting,
 * or streaming — it is intended for use in contexts where the caller manages
 * those concerns (e.g., the MCP server returns the full string to the client).
 */
export async function ingestFromUrl(
  githubUrl: string,
  detail: DetailLevel,
  env: Env
): Promise<string> {
  // Normalize: if given `owner/repo` shorthand, prefix with the URL-appended form
  let urlToParse: string;
  if (githubUrl.startsWith("https://github.com/")) {
    urlToParse = `https://gitprism.cloudemo.org/${githubUrl}`;
  } else if (!githubUrl.startsWith("http")) {
    // Assume owner/repo shorthand
    urlToParse = `https://gitprism.cloudemo.org/ingest?repo=${encodeURIComponent(githubUrl)}&detail=${detail}`;
  } else {
    urlToParse = `https://gitprism.cloudemo.org/${githubUrl}`;
  }

  const parsed = parseRequest(new Request(urlToParse));
  parsed.detail = detail; // override with caller's detail

  let ref = parsed.ref;
  if (!ref) {
    ref = await resolveDefaultRef(parsed.owner, parsed.repo, env);
  }

  await checkZipSize(parsed.owner, parsed.repo, ref, env);

  const { data: zipData } = await fetchZipball(parsed.owner, parsed.repo, ref, env);

  const maxOutputBytes = parseInt(env.MAX_OUTPUT_BYTES ?? "10485760", 10);
  const maxFileCount = parseInt(env.MAX_FILE_COUNT ?? "5000", 10);

  const result = decompressAndProcess(zipData, {
    subpath: parsed.path,
    detail,
    maxOutputBytes,
    maxFileCount,
  });

  result.owner = parsed.owner;
  result.repo = parsed.repo;
  result.repoName = `${parsed.owner}/${parsed.repo}`;
  result.ref = ref;

  return formatOutput(result, detail);
}
