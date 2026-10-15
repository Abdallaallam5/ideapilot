'use strict';

const graphService = require('../services/graphService');

async function getGraph(req, res) {
  res.json(await graphService.getGraph(req.project._id));
}

async function createNode(req, res) {
  const node = await graphService.createNode(req.project, req.validated, req.user);
  res.status(201).json({ node: graphService.serializeNode(node) });
}

async function updateNode(req, res) {
  const node = await graphService.updateNode(req.project, req.params.nodeId, req.validated, req.user);
  res.json({ node: graphService.serializeNode(node) });
}

async function updatePositions(req, res) {
  const updated = await graphService.updatePositions(req.project, req.validated.positions);
  res.json({ updated });
}

async function deleteNode(req, res) {
  const result = await graphService.deleteNode(req.project, req.params.nodeId, req.user);
  res.json({ deleted: true, ...result });
}

async function createEdge(req, res) {
  const edge = await graphService.createEdge(req.project, req.validated, req.user);
  res.status(201).json({ edge: graphService.serializeEdge(edge) });
}

async function updateEdge(req, res) {
  const edge = await graphService.updateEdge(req.project, req.params.edgeId, req.validated, req.user);
  res.json({ edge: graphService.serializeEdge(edge) });
}

async function deleteEdge(req, res) {
  await graphService.deleteEdge(req.project, req.params.edgeId, req.user);
  res.json({ deleted: true });
}

module.exports = { getGraph, createNode, updateNode, updatePositions, deleteNode, createEdge, updateEdge, deleteEdge };
