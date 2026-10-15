'use strict';

require('dotenv').config({ quiet: true });
const { z } = require('zod');

const bool = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((v) => v === true || v === 'true' || v === '1');

const intWithDefault = (def) =>
  z.coerce.number().int().positive().optional().default(def);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  MONGODB_URI: z.string().trim().min(1, 'MONGODB_URI is required'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  SESSION_NAME: z.string().trim().min(1).default('ideapilot.sid'),
  SESSION_MAX_AGE_HOURS: intWithDefault(24),
  APP_BASE_URL: z.url().default('http://localhost:5000'),
  TRUST_PROXY: bool,
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  LOGIN_RATE_LIMIT: intWithDefault(10),
  AI_PROVIDER: z.string().trim().toLowerCase().default('google'),
  AI_API_KEY: z.string().trim().optional().default(''),
  AI_MODEL: z.string().trim().optional().default(''),
  AI_RATE_LIMIT_PER_MINUTE: intWithDefault(6),
  AI_DAILY_LIMIT: intWithDefault(50),
  AI_TIMEOUT_MS: intWithDefault(45000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
});

let cached;

/**
 * Validates process.env once and returns a frozen config object.
 * Throws with a readable list of problems (never the values themselves).
 */
function loadEnv() {
  if (cached) return cached;
  const raw = { ...process.env };
  // Empty strings in .env should behave like "unset" so defaults apply.
  for (const key of Object.keys(raw)) {
    if (raw[key] === '') delete raw[key];
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    const err = new Error(`Invalid environment configuration:\n${problems}`);
    err.code = 'ENV_INVALID';
    throw err;
  }
  cached = Object.freeze({
    ...result.data,
    isProduction: result.data.NODE_ENV === 'production',
    isTest: result.data.NODE_ENV === 'test',
  });
  return cached;
}

function resetEnvCache() {
  cached = undefined;
}

module.exports = { loadEnv, resetEnvCache };
