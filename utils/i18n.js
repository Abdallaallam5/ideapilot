'use strict';

/**
 * Minimal gettext-style i18n: the English text is the key, and each locale file
 * maps English strings to translations. Missing entries fall back to English.
 * Placeholders use {name}: __('Hello {name}', { name }).
 */
const fs = require('fs');
const path = require('path');

const SUPPORTED = ['en', 'ar'];
const RTL = new Set(['ar']);
const LANG_COOKIE = 'ideapilot.lang';
const INTL_LOCALE = { en: 'en-US', ar: 'ar-EG-u-nu-latn' };

const dictionaries = { en: {} };
for (const lang of SUPPORTED.filter((l) => l !== 'en')) {
  dictionaries[lang] = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'locales', `${lang}.json`), 'utf8'));
}

function interpolate(text, vars) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m));
}

const escapeRe = (s) => s.replace(/[.*+?^$()|[\]\\]/g, '\\$&');

/**
 * Keys with {placeholders} also work in reverse: a stored English sentence such as
 * an activity entry "Created task “Buy tools”" matches the key "Created task “{title}”"
 * and is rendered with the translated template.
 */
function compilePatterns(dict) {
  return Object.keys(dict)
    // Short templates ("New {type}") are forward-only, so user text is never mistaken for them.
    .filter((k) => /\{\w+\}/.test(k) && k.replace(/\{\w+\}/g, '').trim().length >= 8)
    .map((k) => {
      const names = [];
      const source = k.split(/(\{\w+\})/).map((part) => {
        const m = /^\{(\w+)\}$/.exec(part);
        if (!m) return escapeRe(part);
        names.push(m[1]);
        return '([\\s\\S]+?)';
      }).join('');
      return { re: new RegExp(`^${source}$`), names, template: dict[k] };
    });
}
const patterns = Object.fromEntries(Object.entries(dictionaries).map(([l, d]) => [l, compilePatterns(d)]));

// Placeholders that hold whole sentences are translated too when a pattern matches.
// Development aid: I18N_REPORT=1 collects strings that had no translation.
const missing = process.env.I18N_REPORT ? new Set() : null;

const NESTED = new Set(['summary', 'reason', 'message', 'detail', 'field', 'type', 'from', 'to', 'rel', 'status']);

function translator(lang) {
  const dict = dictionaries[lang] || {};
  const pats = patterns[lang] || [];
  const nested = (name, value) => {
    if (name === 'fields') return value.split(', ').map((k) => dict[`field:${k}`] ?? k).join(lang === 'ar' ? '، ' : ', ');
    return NESTED.has(name) ? __(value) : value;
  };
  const __ = (text, vars) => {
    const s = String(text ?? '');
    if (Object.prototype.hasOwnProperty.call(dict, s)) return interpolate(dict[s], vars);
    if (!vars && pats.length) {
      for (const p of pats) {
        const m = p.re.exec(s);
        if (m) return interpolate(p.template, Object.fromEntries(p.names.map((n, i) => [n, nested(n, m[i + 1])])));
      }
    }
    if (missing && lang !== 'en' && /[A-Za-z]{2}/.test(s)) missing.add(s);
    return interpolate(s, vars);
  };
  return __;
}

function readCookie(header, name) {
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** Cookie first, then the browser's Accept-Language, then English. */
function detectLanguage(req) {
  const fromCookie = readCookie(req.headers.cookie, LANG_COOKIE);
  if (SUPPORTED.includes(fromCookie)) return fromCookie;
  const accepted = String(req.headers['accept-language'] || '')
    .split(',')
    .map((s) => s.split(';')[0].trim().slice(0, 2).toLowerCase());
  return accepted.find((l) => SUPPORTED.includes(l)) || 'en';
}

module.exports = { missing, SUPPORTED, RTL, LANG_COOKIE, INTL_LOCALE, dictionaries, translator, detectLanguage };
