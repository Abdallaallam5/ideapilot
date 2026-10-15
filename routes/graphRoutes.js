'use strict';

const express = require('express');
const graph = require('../controllers/graphController');
const { requireAuth } = require('../middleware/requireAuth');
const { requireProjectOwner } = require('../middleware/requireProjectOwner');
const { validateRequest } = require('../middleware/validateRequest');
const { validateObjectId } = require('../middleware/validateObjectId');
const v = require('../validators/graphValidators');

// JSON endpoints used by the map (public/js/graph.js). All are owner-scoped.
const router = express.Router();
const owner = [requireAuth, requireProjectOwner];
const base = '/projects/:projectId/graph';

router.get(base, owner, graph.getGraph);
router.post(`${base}/nodes`, owner, validateRequest(v.createNodeSchema), graph.createNode);
router.post(`${base}/positions`, owner, validateRequest(v.positionsSchema), graph.updatePositions);
router.patch(`${base}/nodes/:nodeId`, owner, validateObjectId('nodeId'), validateRequest(v.updateNodeSchema), graph.updateNode);
router.delete(`${base}/nodes/:nodeId`, owner, validateObjectId('nodeId'), graph.deleteNode);
router.post(`${base}/edges`, owner, validateRequest(v.createEdgeSchema), graph.createEdge);
router.patch(`${base}/edges/:edgeId`, owner, validateObjectId('edgeId'), validateRequest(v.updateEdgeSchema), graph.updateEdge);
router.delete(`${base}/edges/:edgeId`, owner, validateObjectId('edgeId'), graph.deleteEdge);

module.exports = router;
