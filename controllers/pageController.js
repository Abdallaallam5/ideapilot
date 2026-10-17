'use strict';

function landing(req, res) {
  res.render('pages/landing', { title: 'IdeaPilot: Turn your ideas into action', bodyClass: 'landing' });
}

function guide(req, res) {
  res.render('pages/guide', { title: 'Video guide', bodyClass: 'landing guide' });
}

module.exports = { landing, guide };
