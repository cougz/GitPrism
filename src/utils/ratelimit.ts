import type { Env } from "../types";

export interface RateLimitResult {
  allowed: boolean;
  retryAfter?: number;
}

/**
 * Checks the rate limit for the given client IP.
 * Uses the Cloudflare Rate Limiting binding (RATE_LIMITER).
 */
export async function checkRateLimit(env: Env, clientIP: string): Promise<RateLimitResult> {
  try {
    const { success } = await env.RATE_LIMITER.limit({ key: clientIP });
    if (!success) {
      return { allowed: false, retryAfter: 60 };
    }
    return { allowed: true };
  } catch {
    // If the binding is unavailable (e.g., local dev), allow the request
    return { allowed: true };
  }
}
