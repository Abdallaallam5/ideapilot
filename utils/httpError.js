'use strict';

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.expose = true;
    if (details) this.details = details;
  }
}

const badRequest = (msg = 'Bad request', details) => new HttpError(400, msg, details);
const forbidden = (msg = 'You do not have access to this resource.') => new HttpError(403, msg);
const notFound = (msg = 'Not found.') => new HttpError(404, msg);
const conflict = (msg, details) => new HttpError(409, msg, details);
const unprocessable = (msg = 'Validation failed.', details) => new HttpError(422, msg, details);

module.exports = { HttpError, badRequest, forbidden, notFound, conflict, unprocessable };
