'use strict';

const LABELS = {
  idea: 'Idea', mapping: 'Mapping', planning: 'Planning', executing: 'Executing',
  reviewing: 'Reviewing', done: 'Done',
  active: 'Active', on_hold: 'On hold', completed: 'Completed', archived: 'Archived',
  todo: 'To do', in_progress: 'In progress', blocked: 'Blocked',
  low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical',
  person: 'Person / team',
};

function label(value) {
  if (!value) return '';
  return LABELS[value] || String(value).replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function formatDate(date, opts = {}, locale = 'en-US') {
  if (!date) return '';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC', ...opts });
}

function formatDateTime(date, locale = 'en-US') {
  if (!date) return '';
  const d = new Date(date);
  return d.toLocaleString(locale, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
}

function isoDate(date) {
  if (!date) return '';
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

function timeAgo(date, locale = 'en-US') {
  if (!date) return '';
  const seconds = Math.round((Date.now() - new Date(date).getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (seconds < 45) return rtf.format(0, 'second');
  const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [name, secs] of units) {
    const n = Math.floor(seconds / secs);
    if (n >= 1) return rtf.format(-n, name);
  }
  return rtf.format(0, 'second');
}

/** Splits textarea input (one item per line) into a clean list. */
function linesToList(text, { max = 50, maxLength = 500 } = {}) {
  if (Array.isArray(text)) text = text.join('\n');
  return String(text || '')
    .split(/\r?\n/)
    .map((s) => s.trim().slice(0, maxLength))
    .filter(Boolean)
    .slice(0, max);
}

module.exports = { label, formatDate, formatDateTime, isoDate, timeAgo, linesToList };
