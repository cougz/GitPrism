import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    include: ["test/**/*.test.ts"],
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          // Provide stub bindings so pure unit tests don't fail from missing bindings
          bindings: {
            MAX_ZIP_BYTES: "52428800",
            MAX_OUTPUT_BYTES: "10485760",
            MAX_FILE_COUNT: "5000",
            CACHE_TTL_SECONDS: "3600",
          },
        },
      },
    },
  },
});
