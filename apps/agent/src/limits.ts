// Application resource ceilings; provider metadata can impose smaller token limits.
export const MAX_OUTPUT_TOKENS = 128_000;
export const FALLBACK_CONTEXT_TOKENS = 32_768;
export const FALLBACK_OUTPUT_TOKENS = 8_192;
export const RUN_TIMEOUT_MS = 15 * 60_000;
export const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;
export const MAX_SESSION_ARTIFACT_BYTES = 64 * 1024 * 1024;
