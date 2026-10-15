'use strict';

const { z } = require('zod');

/**
 * Converts a Zod schema to the JSON Schema subset accepted by Gemini's
 * `responseJsonSchema`. Array size limits (minItems/maxItems) are left out:
 * live testing showed Gemini rejects larger schemas that use them with
 * 400 INVALID_ARGUMENT. Sizes are enforced afterwards by clampArrays + Zod.
 */
function toProviderSchema(schema) {
  const json = z.toJSONSchema(schema, { target: 'draft-7', unrepresentable: 'any' });
  const KEEP = new Set(['type', 'properties', 'required', 'items', 'enum', 'description', 'maxLength', 'minLength', 'anyOf', 'additionalProperties', 'const']);
  const clean = (node) => {
    if (Array.isArray(node)) return node.map(clean);
    if (!node || typeof node !== 'object') return node;
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (!KEEP.has(k)) continue;
      if (k === 'properties') out[k] = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, clean(pv)]));
      else if (k === 'additionalProperties') out[k] = typeof v === 'boolean' ? v : clean(v);
      else out[k] = clean(v);
    }
    return out;
  };
  return clean(json);
}

/**
 * Trims arrays in model output to the schema's maxItems, so a model that returns
 * one item too many still yields a usable proposal instead of a rejected one.
 */
function clampArrays(data, schema) {
  const walk = (value, node) => {
    if (!node || typeof node !== 'object') return value;
    if (Array.isArray(value)) {
      const items = typeof node.maxItems === 'number' ? value.slice(0, node.maxItems) : value;
      return items.map((v) => walk(v, node.items));
    }
    if (value && typeof value === 'object' && node.properties) {
      const out = { ...value };
      for (const [k, sub] of Object.entries(node.properties)) if (k in out) out[k] = walk(out[k], sub);
      return out;
    }
    return value;
  };
  return walk(data, z.toJSONSchema(schema, { target: 'draft-7', unrepresentable: 'any' }));
}

/**
 * Google Gemini provider using the official @google/genai SDK.
 * Returns { text, usage } or throws; the caller handles validation.
 */
function createGoogleProvider({ apiKey }) {
  const { GoogleGenAI } = require('@google/genai');
  const client = new GoogleGenAI({ apiKey });
  return {
    name: 'google',
    async generate({ model, system, prompt, schema, maxOutputTokens, timeoutMs, signal }) {
      const response = await client.models.generateContent({
        model,
        contents: prompt,
        config: {
          systemInstruction: system,
          responseMimeType: 'application/json',
          responseJsonSchema: toProviderSchema(schema),
          maxOutputTokens,
          temperature: 0.4,
          abortSignal: signal,
          httpOptions: { timeout: timeoutMs },
        },
      });
      const candidate = response.candidates?.[0];
      return {
        text: response.text,
        finishReason: candidate?.finishReason,
        blocked: response.promptFeedback?.blockReason,
        usage: {
          inputTokens: response.usageMetadata?.promptTokenCount,
          outputTokens: response.usageMetadata?.candidatesTokenCount,
        },
      };
    },
  };
}

const FACTORIES = { google: createGoogleProvider };

function createProvider(config) {
  const factory = FACTORIES[config.provider];
  if (!factory) throw new Error(`Unsupported AI provider: ${config.provider}`);
  return factory(config);
}

module.exports = { createProvider, toProviderSchema, clampArrays };
