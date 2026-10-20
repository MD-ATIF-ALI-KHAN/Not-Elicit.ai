/** The model declined to answer (a safety refusal or content filter). */
export class AiRefusalError extends Error {
  constructor() {
    super("The AI model declined to answer this request.");
  }
}

/**
 * The AI provider could not be used at all: nothing is configured, the API
 * key was rejected, or the server could not be reached.
 */
export class AiUnavailableError extends Error {}

/** The AI provider is rate limiting requests (common on free tiers). */
export class AiRateLimitError extends Error {
  constructor(provider: string) {
    super(`${provider} is rate limiting requests right now. Wait a minute, then use Retry.`);
  }
}

/** The AI provider returned an error for this request. */
export class AiRequestError extends Error {}
