'use strict';

const mongoose = require('mongoose');
const logger = require('../utils/logger');
const { wantsJson } = require('../utils/http');

function notFoundHandler(req, res) {
  if (wantsJson(req)) return res.status(404).json({ error: 'Not found.' });
  return res.status(404).render('errors/404', { title: 'Page not found' });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let status = err.status || err.statusCode || 500;
  let message = err.expose ? err.message : 'Something went wrong on our side. Please try again.';
  let details = err.expose ? err.details : undefined;

  if (err instanceof mongoose.Error.ValidationError) {
    status = 422;
    message = 'Some fields are invalid.';
    details = Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v.message]));
  } else if (err instanceof mongoose.Error.CastError) {
    status = 404;
    message = 'Not found.';
  } else if (err.type === 'entity.too.large') {
    status = 413;
    message = 'The request is too large.';
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    message = 'The request body is not valid JSON.';
  }

  if (status >= 500) {
    logger.error('Unhandled error', { error: err, stack: err.stack, method: req.method, path: req.path, userId: req.user?._id });
  } else {
    logger.debug('Request error', { status, message, path: req.path });
  }

  if (res.headersSent) return;
  if (wantsJson(req)) return res.status(status).json({ error: message, ...(details ? { errors: details } : {}) });

  const view = status === 404 ? 'errors/404' : status === 403 ? 'errors/403' : 'errors/500';
  return res.status(status).render(view, { title: status === 404 ? 'Page not found' : 'Error', message, status });
}

module.exports = { errorHandler, notFoundHandler };
