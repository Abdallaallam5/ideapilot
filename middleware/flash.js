'use strict';

/** Minimal session flash messages for redirect-after-POST flows. */
function flash(req, res, next) {
  req.flash = (type, message) => {
    if (!req.session) return;
    req.session.flash = req.session.flash || [];
    req.session.flash.push({ type, message: String(message).slice(0, 500) });
  };
  res.locals.consumeFlash = () => {
    if (!req.session || !req.session.flash) return [];
    const messages = req.session.flash;
    delete req.session.flash;
    return messages;
  };
  next();
}

module.exports = { flash };
