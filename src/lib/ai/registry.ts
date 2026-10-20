import "server-only";
import { ClaudeProvider } from "./claude";
import { resolveAiConfig, type AiConfig } from "./config";
import { AiUnavailableError } from "./errors";
import { OpenAiCompatibleProvider } from "./openai-compatible";
import type { AiProvider } from "./provider";

export function createProvider(config: AiConfig): AiProvider {
  return config.provider === "anthropic" ? new ClaudeProvider(config) : new OpenAiCompatibleProvider(config);
}

// One provider per process (shared across route bundles and hot reloads) so
// that its rate gate sees every request.
const globalForAi = globalThis as unknown as {
  notElicitAi?: { key: string; provider: AiProvider };
  notElicitAiOverride?: AiProvider;
};

/** The configured provider; throws AiUnavailableError with setup help if none. */
export function getProvider(): AiProvider {
  if (globalForAi.notElicitAiOverride) return globalForAi.notElicitAiOverride;
  const result = resolveAiConfig();
  if (!result.ok) throw new AiUnavailableError(result.error);
  const key = JSON.stringify(result.config);
  if (globalForAi.notElicitAi?.key !== key) {
    globalForAi.notElicitAi = { key, provider: createProvider(result.config) };
  }
  return globalForAi.notElicitAi.provider;
}

/** Test hook: use a specific provider instead of the configured one. */
export function setProviderForTesting(provider: AiProvider | undefined): void {
  globalForAi.notElicitAiOverride = provider;
}

/** Which model is in use, for display. Null when nothing is configured. */
export function aiStatus(): { label: string; model: string } | null {
  const result = resolveAiConfig();
  return result.ok ? { label: result.config.label, model: result.config.model } : null;
}
