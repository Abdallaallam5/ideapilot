'use strict';

/**
 * Per-request context (currently the UI language) for code that has no `req`,
 * such as services that generate text which is stored, like replan task titles.
 */
const { AsyncLocalStorage } = require('async_hooks');
const { translator } = require('./i18n');

const storage = new AsyncLocalStorage();

function runWithContext(ctx, fn) {
  return storage.run(ctx, fn);
}

function currentLang() {
  return storage.getStore()?.lang || 'en';
}

/** Translates into the current request's language (English outside a request). */
function tr(text, vars) {
  return translator(currentLang())(text, vars);
}

module.exports = { runWithContext, currentLang, tr };
