import { describe, expect, it } from "vitest";
import { resolveAiConfig } from "@/lib/ai/config";

describe("resolveAiConfig", () => {
  it("explains how to get a free key when nothing is set", () => {
    const result = resolveAiConfig({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/GEMINI_API_KEY.*GROQ_API_KEY/);
  });

  it("detects a provider from its key, with that provider's defaults", () => {
    expect(resolveAiConfig({ GEMINI_API_KEY: "g" })).toEqual({
      ok: true,
      config: {
        provider: "gemini",
        label: "Gemini",
        model: "gemini-3.5-flash-lite",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
        apiKey: "g",
      },
    });
    expect(resolveAiConfig({ GROQ_API_KEY: "q" })).toMatchObject({
      ok: true,
      config: { provider: "groq", model: "llama-3.3-70b-versatile", baseUrl: "https://api.groq.com/openai/v1" },
    });
  });

  it("prefers Anthropic, then Gemini, when several keys are present", () => {
    expect(resolveAiConfig({ GROQ_API_KEY: "q", GEMINI_API_KEY: "g" })).toMatchObject({ config: { provider: "gemini" } });
    expect(resolveAiConfig({ GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "a" })).toMatchObject({
      config: { provider: "anthropic", model: "claude-opus-5-5", baseUrl: null, apiKey: "a" },
    });
  });

  it("honours explicit provider, model and base URL", () => {
    expect(
      resolveAiConfig({ AI_PROVIDER: "Groq", GEMINI_API_KEY: "g", GROQ_API_KEY: "q", AI_MODEL: "openai/gpt-oss-120b" }),
    ).toMatchObject({ config: { provider: "groq", model: "openai/gpt-oss-120b", apiKey: "q" } });
    expect(
      resolveAiConfig({ AI_PROVIDER: "openai-compatible", AI_BASE_URL: "http://localhost:1234/v1/", AI_API_KEY: "k", AI_MODEL: "m" }),
    ).toMatchObject({ config: { provider: "openai-compatible", baseUrl: "http://localhost:1234/v1", apiKey: "k" } });
    expect(resolveAiConfig({ ANTHROPIC_API_KEY: "a", ANTHROPIC_MODEL: "claude-sonnet-5-5" })).toMatchObject({
      config: { model: "claude-sonnet-5-5" },
    });
  });

  it("allows keyless self-hosted OpenAI-compatible servers", () => {
    expect(resolveAiConfig({ AI_PROVIDER: "openai-compatible", AI_BASE_URL: "http://localhost:1234/v1", AI_MODEL: "m" })).toMatchObject({
      ok: true,
      config: { apiKey: null },
    });
  });

  it("runs Ollama without a key", () => {
    expect(resolveAiConfig({ AI_PROVIDER: "ollama" })).toMatchObject({
      ok: true,
      config: { provider: "ollama", model: "llama3.1", baseUrl: "http://localhost:11434/v1", apiKey: null },
    });
  });

  it("reports what is missing", () => {
    const cases: [Record<string, string>, RegExp][] = [
      [{ AI_PROVIDER: "nope" }, /Unknown AI_PROVIDER/],
      [{ OPENROUTER_API_KEY: "o" }, /Set AI_MODEL/],
      [{ AI_PROVIDER: "openai-compatible", AI_MODEL: "m" }, /AI_BASE_URL/],
      [{ AI_PROVIDER: "groq" }, /Add GROQ_API_KEY/],
    ];
    for (const [env, error] of cases) {
      const result = resolveAiConfig(env);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(error);
    }
  });

  it("ignores blank values", () => {
    expect(resolveAiConfig({ ANTHROPIC_API_KEY: "  ", GEMINI_API_KEY: "g", AI_MODEL: "" })).toMatchObject({
      config: { provider: "gemini", model: "gemini-3.5-flash-lite" },
    });
  });
});
