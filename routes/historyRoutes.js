'use strict';

const express = require('express');
const history = require('../controllers/historyController');
const { requireAuth } = require('../middleware/requireAuth');
const { requireProjectOwner } = require('../middleware/requireProjectOwner');
const { validateRequest } = require('../middleware/validateRequest');
const { validateObjectId } = require('../middleware/validateObjectId');
const v = require('../validators/planValidators');

const router = express.Router();
const owner = [requireAuth, requireProjectOwner];
const p = '/projects/:projectId';

router.get(`${p}/review`, owner, history.review);
// The old History page became Review.
router.get(`${p}/history`, owner, (req, res) => res.redirect(`/projects/${req.params.projectId}/review`));
router.get(`${p}/plan/versions/:planId`, owner, validateObjectId('planId'), history.viewVersion);
router.post(`${p}/plan/versions/:planId/restore`, owner, validateObjectId('planId'), history.restoreVersion);
router.post(`${p}/replan`, owner, validateRequest(v.replanSchema, { redirect: (req) => `/projects/${req.params.projectId}/map` }), history.replan);
router.get(`${p}/proposals/:proposalId`, owner, validateObjectId('proposalId'), history.showProposal);
router.post(`${p}/proposals/:proposalId/accept`, owner, validateObjectId('proposalId'), validateRequest(v.proposalAcceptSchema, { redirect: (req) => `/projects/${req.params.projectId}/proposals/${req.params.proposalId}` }), history.acceptProposal);
router.post(`${p}/proposals/:proposalId/reject`, owner, validateObjectId('proposalId'), history.rejectProposal);

module.exports = router;
