/* Shared Cytoscape styling for idea maps (workspace + landing preview). */
(function () {
  'use strict';
  var __ = (window.IdeaPilot && window.IdeaPilot.__) || function (s) { return s; };

  var NODE_TYPES = {
    idea: { color: '#8b5cf6', text: '#ffffff', shape: 'round-rectangle', label: __('Idea'), icon: 'lightbulb' },
    goal: { color: '#10b981', text: '#04261b', shape: 'round-hexagon', label: __('Goal'), icon: 'target' },
    assumption: { color: '#f59e0b', text: '#2b1a00', shape: 'round-rectangle', label: __('Assumption'), icon: 'help-circle' },
    risk: { color: '#ef4444', text: '#ffffff', shape: 'round-octagon', label: __('Risk'), icon: 'shield-alert' },
    resource: { color: '#06b6d4', text: '#032a31', shape: 'barrel', label: __('Resource'), icon: 'package' },
    decision: { color: '#ec4899', text: '#ffffff', shape: 'round-diamond', label: __('Decision'), icon: 'git-commit' },
    milestone: { color: '#eab308', text: '#2a2100', shape: 'round-tag', label: __('Milestone'), icon: 'flag' },
    task: { color: '#3b82f6', text: '#ffffff', shape: 'round-rectangle', label: __('Task'), icon: 'check-square' },
    note: { color: '#94a3b8', text: '#0f172a', shape: 'cut-rectangle', label: __('Note'), icon: 'sticky-note' }
  };

  var RELATIONSHIPS = {
    supports: { color: '#34d399', style: 'solid', arrow: 'triangle', label: __('supports') },
    depends_on: { color: '#60a5fa', style: 'dashed', arrow: 'triangle', label: __('depends on') },
    blocks: { color: '#f87171', style: 'solid', arrow: 'tee', label: __('blocks') },
    influences: { color: '#c084fc', style: 'dotted', arrow: 'vee', label: __('influences') },
    alternative_to: { color: '#fbbf24', style: 'dashed', arrow: 'none', label: __('alternative to') },
    part_of: { color: '#a5b4fc', style: 'solid', arrow: 'diamond', label: __('part of') },
    tests: { color: '#2dd4bf', style: 'dashed', arrow: 'circle', label: __('tests') },
    related_to: { color: '#94a3b8', style: 'dotted', arrow: 'none', label: __('related to') }
  };

  function nodeWidth(ele) {
    var t = String(ele.data('title') || '');
    var type = ele.data('type');
    var base = type === 'decision' ? 150 : 110;
    return Math.min(230, Math.max(base, Math.min(t.length, 30) * 7.2 + 36));
  }

  function stylesheet(opts) {
    opts = opts || {};
    var s = [
      {
        selector: 'node',
        style: {
          label: 'data(title)', 'text-wrap': 'wrap', 'text-max-width': function (e) { return nodeWidth(e) - 22; },
          'text-valign': 'center', 'text-halign': 'center', 'font-size': 12, 'font-weight': 600,
          'font-family': 'Cairo, Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          width: nodeWidth, height: function (e) { return e.data('type') === 'decision' ? 70 : 46; },
          'border-width': 2, 'border-color': 'rgba(255,255,255,0.28)',
          'overlay-padding': 6, 'overlay-opacity': 0,
          'transition-property': 'border-color, border-width, opacity, background-color', 'transition-duration': '150ms'
        }
      },
      { selector: 'node[type="idea"]', style: { 'font-size': 14, height: 54 } },
      { selector: 'node[status="invalidated"]', style: { opacity: 0.55, 'border-style': 'dashed', 'border-color': '#f87171', 'border-width': 3 } },
      { selector: 'node[status="validated"]', style: { 'border-color': '#4ade80', 'border-width': 3 } },
      { selector: 'node[status="done"]', style: { 'border-color': '#e2e8f0', 'border-width': 3, 'background-opacity': 0.75 } },
      { selector: 'node[status="in_progress"]', style: { 'border-color': '#93c5fd', 'border-width': 3 } },
      { selector: 'node[priority="critical"]', style: { 'underlay-color': '#f43f5e', 'underlay-opacity': 0.25, 'underlay-padding': 6 } },
      { selector: 'node:selected', style: { 'border-color': '#ffffff', 'border-width': 4, 'underlay-color': '#a78bfa', 'underlay-opacity': 0.35, 'underlay-padding': 8 } },
      { selector: 'node.connect-source', style: { 'border-color': '#fde047', 'border-width': 4, 'border-style': 'double' } },
      { selector: 'node.dimmed', style: { opacity: 0.18 } },
      { selector: 'node.match', style: { 'underlay-color': '#fde047', 'underlay-opacity': 0.45, 'underlay-padding': 8 } },
      {
        selector: 'edge',
        style: {
          width: 2, 'curve-style': 'bezier', 'arrow-scale': 1.1,
          label: opts.edgeLabels === false ? '' : 'data(label)', 'font-size': 10, color: '#cbd5e1',
          'text-background-color': opts.background || '#0f1630', 'text-background-opacity': 0.9, 'text-background-padding': 2,
          'text-rotation': 'autorotate', 'overlay-padding': 5, 'overlay-opacity': 0
        }
      },
      { selector: 'edge:selected', style: { width: 4, 'underlay-color': '#a78bfa', 'underlay-opacity': 0.3, 'underlay-padding': 4 } },
      { selector: 'edge.dimmed', style: { opacity: 0.1 } }
    ];
    Object.keys(NODE_TYPES).forEach(function (k) {
      var t = NODE_TYPES[k];
      s.push({ selector: 'node[type="' + k + '"]', style: { 'background-color': t.color, color: t.text, shape: t.shape } });
    });
    s.push({ selector: 'node[type="assumption"]', style: { 'border-style': 'dashed', 'border-color': 'rgba(43,26,0,0.45)' } });
    Object.keys(RELATIONSHIPS).forEach(function (k) {
      var r = RELATIONSHIPS[k];
      s.push({ selector: 'edge[relationship="' + k + '"]', style: { 'line-color': r.color, 'target-arrow-color': r.color, 'target-arrow-shape': r.arrow, 'line-style': r.style } });
    });
    // Keep later per-status/selected rules winning over per-type colours.
    s.push({ selector: 'node:selected', style: { 'border-color': '#ffffff', 'border-width': 4 } });
    s.push({ selector: 'node[status="invalidated"]', style: { 'border-color': '#f87171' } });
    return s;
  }

  window.IdeaPilotGraph = { NODE_TYPES: NODE_TYPES, RELATIONSHIPS: RELATIONSHIPS, stylesheet: stylesheet };
})();
