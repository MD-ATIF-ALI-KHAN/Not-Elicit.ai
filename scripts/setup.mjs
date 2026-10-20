#!/usr/bin/env node
// Interactive first-time setup: asks which AI provider to use and for your
// API key, then writes .env.local (which git never commits). The key is
// written only to that local file; it is never printed or sent anywhere.

import fs from "node:fs";
import path from "node:path";
import { stdin, stdout } from "node:process";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(root, ".env.local");
const template = path.join(root, ".env.example");

const PROVIDERS = [
  { name: "Google Gemini (free tier)", variable: "GEMINI_API_KEY", url: "https://aistudio.google.com/apikey" },
  { name: "Groq (free tier)", variable: "GROQ_API_KEY", url: "https://console.groq.com/keys" },
  { name: "OpenRouter (free models)", variable: "OPENROUTER_API_KEY", url: "https://openrouter.ai/keys", needsModel: true },
  { name: "Anthropic Claude (paid)", variable: "ANTHROPIC_API_KEY", url: "https://platform.claude.com/settings/keys" },
  { name: "Ollama (local, no key)", variable: null, url: "https://ollama.com" },
];

/** Sets `name=value` in env text, replacing an existing (possibly commented) line. */
function setVariable(text, name, value) {
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^#?\\s*${name}=.*$`, "m");
  return pattern.test(text) ? text.replace(pattern, line) : `${text.trimEnd()}\n${line}\n`;
}

// Read answers line by line so this works both typed and piped.
const rl = readline.createInterface({ input: stdin });
const lines = rl[Symbol.asyncIterator]();
async function ask(question) {
  stdout.write(question);
  const { value, done } = await lines.next();
  if (done) throw new Error("No answer was given.");
  return value;
}

try {
  console.log("\nNot-Elicit.ai setup\n");
  if (fs.existsSync(envFile)) {
    const answer = await ask(".env.local already exists. Replace the AI settings in it? (y/N) ");
    if (!/^y(es)?$/i.test(answer.trim())) {
      console.log("Nothing changed.");
      process.exit(0);
    }
  }

  PROVIDERS.forEach((provider, index) => console.log(`  ${index + 1}. ${provider.name}`));
  const choice = Number.parseInt(await ask("\nWhich AI provider? [1] "), 10) || 1;
  const provider = PROVIDERS[choice - 1];
  if (!provider) throw new Error("Please choose a number from the list.");

  let text = fs.readFileSync(fs.existsSync(envFile) ? envFile : template, "utf8");
  // Clear every provider key so only the chosen one is active.
  for (const p of PROVIDERS) if (p.variable) text = text.replace(new RegExp(`^${p.variable}=.*$`, "m"), `${p.variable}=`);

  if (provider.variable) {
    console.log(`\nGet a key at ${provider.url}`);
    const key = (await ask(`Paste your ${provider.variable}: `)).trim();
    if (!key || /\s/.test(key)) throw new Error("That doesn't look like an API key.");
    text = setVariable(text, provider.variable, key);
    text = text.replace(/^AI_PROVIDER=.*$/m, "# AI_PROVIDER=");
  } else {
    text = setVariable(text, "AI_PROVIDER", "ollama");
  }
  if (provider.needsModel || !provider.variable) {
    const fallback = provider.variable ? "" : "llama3.1";
    const model = (await ask(`Model name${fallback ? ` [${fallback}]` : " (e.g. one ending in :free)"}: `)).trim() || fallback;
    if (model) text = setVariable(text, "AI_MODEL", model);
  }

  const openAlex = (await ask("\nOptional: free OpenAlex API key (https://openalex.org/settings/api), or press Enter to skip: ")).trim();
  if (openAlex) text = setVariable(text, "OPENALEX_API_KEY", openAlex);

  fs.writeFileSync(envFile, text, { mode: 0o600 });
  console.log("\nSaved your settings to .env.local (this file is never committed to git).");
  console.log("Start the app with:  npm run dev   then open http://localhost:3000\n");
} catch (error) {
  console.error(`\nSetup stopped: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
} finally {
  rl.close();
}
