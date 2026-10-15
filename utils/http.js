'use strict';

/** True when the client expects a JSON response (fetch/AJAX calls). */
function wantsJson(req) {
  if (req.xhr) return true;
  const accept = req.get('accept') || '';
  if (accept.includes('application/json') && !accept.includes('text/html')) return true;
  return (req.get('content-type') || '').includes('application/json');
}

/**
 * Serializes data for embedding in a <script type="application/json"> block.
 * Escapes characters that could close the script tag or break HTML parsing.
 */
function safeJson(data) {
  return JSON.stringify(data ?? null)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Escapes text for insertion into HTML (used when a translated template contains markup). */
function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

module.exports = { wantsJson, safeJson, escapeRegex, escapeHtml };
