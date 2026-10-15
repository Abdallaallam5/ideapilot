'use strict';

const { loadEnv } = require('./env');

const SUPPORTED_PROVIDERS = {
  google: { name: 'Google Gemini', defaultModel: 'gemini-flash-latest' },
};

/**
 * Resolves AI settings from the environment. The API key never leaves the
 * backend: callers only receive `publicInfo()` for templates.
 */
function getAIConfig() {
  const env = loadEnv();
  const provider = env.AI_PROVIDER;
  const meta = SUPPORTED_PROVIDERS[provider];
  const apiKey = env.AI_API_KEY;
  const model = env.AI_MODEL || meta?.defaultModel || '';

  let reason = null;
  if (!meta) reason = `AI_PROVIDER "${provider}" is not supported. Supported: ${Object.keys(SUPPORTED_PROVIDERS).join(', ')}.`;
  else if (!apiKey) reason = 'No AI_API_KEY is configured on the server.';

  return {
    enabled: !reason,
    reason,
    provider,
    providerName: meta?.name || provider,
    apiKey,
    model,
    timeoutMs: env.AI_TIMEOUT_MS,
    dailyLimit: env.AI_DAILY_LIMIT,
    perMinute: env.AI_RATE_LIMIT_PER_MINUTE,
    maxOutputTokens: 8192,
    maxInputChars: 24000,
  };
}

/** Safe subset for views: no credentials. */
function publicInfo() {
  const c = getAIConfig();
  return { enabled: c.enabled, reason: c.reason, providerName: c.providerName, model: c.enabled ? c.model : null, dailyLimit: c.dailyLimit };
}

module.exports = { getAIConfig, publicInfo, SUPPORTED_PROVIDERS };
