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
const back = (req) => `/projects/${req.params.projectId}/history`;

router.get(`${p}/history`, owner, history.history);
router.get(`${p}/plan/versions/:planId`, owner, validateObjectId('planId'), history.viewVersion);
router.post(`${p}/plan/versions/:planId/restore`, owner, validateObjectId('planId'), history.restoreVersion);
router.post(`${p}/decisions`, owner, validateRequest(v.decisionSchema, { redirect: back }), history.createDecision);
router.post(`${p}/decisions/:decisionId/update`, owner, validateObjectId('decisionId'), validateRequest(v.decisionStatusSchema, { redirect: back }), history.updateDecision);
router.post(`${p}/replan`, owner, validateRequest(v.replanSchema, { redirect: (req) => `/projects/${req.params.projectId}/map` }), history.replan);
router.get(`${p}/proposals/:proposalId`, owner, validateObjectId('proposalId'), history.showProposal);
router.post(`${p}/proposals/:proposalId/accept`, owner, validateObjectId('proposalId'), validateRequest(v.proposalAcceptSchema, { redirect: (req) => `/projects/${req.params.projectId}/proposals/${req.params.proposalId}` }), history.acceptProposal);
router.post(`${p}/proposals/:proposalId/reject`, owner, validateObjectId('proposalId'), history.rejectProposal);

module.exports = router;
