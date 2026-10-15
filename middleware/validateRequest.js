'use strict';

const { wantsJson } = require('../utils/http');

function formatIssues(error) {
  const fieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join('.') : '_form';
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return fieldErrors;
}

/**
 * Validates req[source] with a Zod schema and stores the parsed value on req.validated.
 * On failure: JSON clients get 422 + field errors; form posts call `onError`
 * (to re-render the form) or fall back to flash + redirect.
 */
function validateRequest(schema, { source = 'body', onError, redirect } = {}) {
  return async (req, res, next) => {
    const result = await schema.safeParseAsync(req[source] ?? {});
    if (result.success) {
      req.validated = result.data;
      return next();
    }
    const errors = formatIssues(result.error);
    if (wantsJson(req)) {
      return res.status(422).json({ error: 'Please correct the highlighted fields.', errors });
    }
    if (onError) return onError(req, res, errors, next);
    const first = Object.values(errors)[0];
    req.flash('danger', first || 'Please check your input.');
    const target = typeof redirect === 'function' ? redirect(req) : redirect;
    return res.redirect(target || req.get('referer') || '/dashboard');
  };
}

module.exports = { validateRequest, formatIssues };
