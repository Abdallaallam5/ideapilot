'use strict';

function landing(req, res) {
  res.render('pages/landing', { title: 'IdeaPilot: Turn your ideas into action', bodyClass: 'landing' });
}

module.exports = { landing };
