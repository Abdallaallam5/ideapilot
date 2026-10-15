'use strict';

const mongoose = require('mongoose');
const { notFound } = require('../utils/httpError');

/** Rejects malformed ids in route params with a 404 before hitting the database. */
function validateObjectId(...names) {
  return (req, res, next) => {
    for (const name of names) {
      if (req.params[name] !== undefined && !mongoose.isValidObjectId(req.params[name])) {
        return next(notFound('Not found.'));
      }
    }
    return next();
  };
}

module.exports = { validateObjectId };
