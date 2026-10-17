/* Landing page example map: a real (local-only) Cytoscape instance with sample data. */
(function () {
  'use strict';
  var el = document.getElementById('landingGraph');
  var __ = window.IdeaPilot.__;
  if (!el || !window.cytoscape || !window.IdeaPilotGraph) return;
  var n = function (id, type, title, x, y) { return { data: { id: id, type: type, title: title }, position: { x: x * 1.35, y: y * 1.25 } }; };
  var e = function (s, t, rel) { return { data: { id: s + t, source: s, target: t, relationship: rel, label: window.IdeaPilotGraph.RELATIONSHIPS[rel].label } }; };
  var cy = window.cytoscape({
    container: el,
    elements: [
      n('i', 'idea', __('Community garden'), 0, 0),
      n('g1', 'goal', __('Fresh food for 40 families'), -230, -110),
      n('g2', 'goal', __('Weekly volunteer group'), 230, -110),
      n('a', 'assumption', __('City lends the empty lot'), -250, 110),
      n('r', 'risk', __('Water access'), 10, 190),
      n('res', 'resource', __('Seed donations'), 250, 110),
      n('m', 'milestone', __('First harvest'), 0, -200),
      e('g1', 'i', 'supports'), e('g2', 'i', 'supports'), e('i', 'a', 'depends_on'),
      e('r', 'i', 'blocks'), e('res', 'i', 'part_of'), e('m', 'g1', 'tests')
    ],
    style: window.IdeaPilotGraph.stylesheet({ background: '#111a3a' }),
    layout: { name: 'preset', fit: true, padding: 30 },
    userZoomingEnabled: false, userPanningEnabled: false, boxSelectionEnabled: false, autoungrabify: false
  });
  window.addEventListener('resize', function () { cy.fit(undefined, 30); });
})();
