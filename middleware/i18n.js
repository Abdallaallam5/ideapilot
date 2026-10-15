'use strict';

const format = require('../utils/format');
const { RTL, INTL_LOCALE, dictionaries, translator, detectLanguage } = require('../utils/i18n');
const { runWithContext } = require('../utils/requestContext');

/** Sets req.lang / req.__ and the view helpers for the request's language. */
function i18n(req, res, next) {
  const lang = detectLanguage(req);
  const __ = translator(lang);
  const locale = INTL_LOCALE[lang];
  req.lang = lang;
  req.__ = __;
  res.locals.lang = lang;
  res.locals.dir = RTL.has(lang) ? 'rtl' : 'ltr';
  res.locals.__ = __;
  res.locals.clientStrings = lang === 'en' ? {} : dictionaries[lang];
  res.locals.currentUrl = req.originalUrl;
  res.locals.fmt = {
    ...format,
    label: (v) => __(format.label(v)),
    formatDate: (d, opts) => format.formatDate(d, opts, locale),
    formatDateTime: (d) => format.formatDateTime(d, locale),
    timeAgo: (d) => format.timeAgo(d, locale),
  };
  runWithContext({ lang }, next);
}

module.exports = { i18n };
