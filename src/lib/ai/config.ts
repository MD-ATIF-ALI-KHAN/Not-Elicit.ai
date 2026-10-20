// Which AI provider Not-Elicit.ai talks to, resolved from environment variables.
//
// Set AI_PROVIDER explicitly, or just add one provider's key and it is picked
// up automatically. Every provider except Anthropic is reached through the
// OpenAI-compatible Chat Completions API that they all expose.

export type ProviderId = "anthropic" | "gemini" | "groq" | "openrouter" | "ollama" | "openai-compatible";

interface Preset {
  label: string;
  /** OpenAI-compatible base URL (unused for Anthropic). */
  baseUrl: string | null;
  /** Environment variable holding the API key; null when no key is needed. */
  keyEnv: string | null;
  /** Whether the provider refuses requests without a key. */
  keyRequired: boolean;
  /** Default model; null when the user must choose one. */
  model: string | null;
}

export const PRESETS: Record<ProviderId, Preset> = {
  // Anthropic can also authenticate through an `ant auth login` profile.
  anthropic: { label: "Claude", baseUrl: null, keyEnv: "ANTHROPIC_API_KEY", keyRequired: false, model: "claude-opus-5-5" },
  gemini: {
    label: "Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    keyEnv: "GEMINI_API_KEY",
    keyRequired: true,
    // Flash-Lite allows 15 requests/minute on the free tier (gemini-3.8-flash allows 5).
    model: "gemini-3.5-flash-lite",
  },
  groq: { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", keyEnv: "GROQ_API_KEY", keyRequired: true, model: "llama-3.3-70b-versatile" },
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", keyEnv: "OPENROUTER_API_KEY", keyRequired: true, model: null },
  ollama: { label: "Ollama", baseUrl: "http://localhost:11434/v1", keyEnv: null, keyRequired: false, model: "llama3.1" },
  // Local servers (LM Studio, vLLM) usually need no key.
  "openai-compatible": { label: "AI provider", baseUrl: null, keyEnv: "AI_API_KEY", keyRequired: false, model: null },
};

// Auto-detection order when AI_PROVIDER is not set.
const DETECT_ORDER: ProviderId[] = ["anthropic", "gemini", "groq", "openrouter"];

export interface AiConfig {
  provider: ProviderId;
  label: string;
  model: string;
  /** Set for OpenAI-compatible providers. */
  baseUrl: string | null;
  apiKey: string | null;
}

export type AiConfigResult = { ok: true; config: AiConfig } | { ok: false; error: string };

const SETUP_HINT =
  "Add a free GEMINI_API_KEY (https://aistudio.google.com/apikey) or GROQ_API_KEY (https://console.groq.com/keys) " +
  "to .env.local and restart the server.";

export function resolveAiConfig(env: Record<string, string | undefined> = process.env): AiConfigResult {
  const value = (name: string | null) => (name ? env[name]?.trim() || undefined : undefined);

  let provider = value("AI_PROVIDER")?.toLowerCase() as ProviderId | undefined;
  if (provider && !(provider in PRESETS)) {
    return { ok: false, error: `Unknown AI_PROVIDER "${provider}". Use one of: ${Object.keys(PRESETS).join(", ")}.` };
  }
  provider ??= DETECT_ORDER.find((id) => value(PRESETS[id].keyEnv));
  if (!provider) return { ok: false, error: `No AI provider is set up. ${SETUP_HINT}` };

  const preset = PRESETS[provider];
  const apiKey = value("AI_API_KEY") ?? value(preset.keyEnv) ?? null;
  const model =
    value("AI_MODEL") ?? (provider === "anthropic" ? value("ANTHROPIC_MODEL") : undefined) ?? preset.model ?? undefined;
  const baseUrl = (value("AI_BASE_URL") ?? preset.baseUrl)?.replace(/\/+$/, "") ?? null;

  if (!model) return { ok: false, error: `Set AI_MODEL in .env.local to choose a ${preset.label} model.` };
  if (provider !== "anthropic" && !baseUrl) {
    return { ok: false, error: "Set AI_BASE_URL in .env.local to your provider's OpenAI-compatible endpoint." };
  }
  if (!apiKey && preset.keyRequired) {
    return { ok: false, error: `Add ${preset.keyEnv} to .env.local and restart the server.` };
  }
  return { ok: true, config: { provider, label: preset.label, model, baseUrl, apiKey } };
}
