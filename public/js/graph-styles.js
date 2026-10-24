/* Shared Cytoscape styling for idea maps (workspace + landing preview). */
(function () {
  'use strict';
  var __ = (window.IdeaPilot && window.IdeaPilot.__) || function (s) { return s; };

  var NODE_TYPES = {
    idea: { color: '#7c5cff', text: '#ffffff', border: '#c4b5fd', shape: 'round-rectangle', label: __('Idea'), icon: 'lightbulb' },
    goal: { color: '#059669', text: '#ffffff', border: '#6ee7b7', shape: 'round-hexagon', label: __('Goal'), icon: 'target' },
    person: { color: '#ea580c', text: '#ffffff', border: '#fed7aa', shape: 'ellipse', label: __('Person / team'), icon: 'users' },
    assumption: { color: '#f59e0b', text: '#2b1a00', border: '#fde68a', shape: 'round-rectangle', label: __('Assumption'), icon: 'circle-help' },
    risk: { color: '#dc2626', text: '#ffffff', border: '#fecaca', shape: 'round-octagon', label: __('Risk'), icon: 'triangle-alert' },
    resource: { color: '#0891b2', text: '#ffffff', border: '#a5f3fc', shape: 'barrel', label: __('Resource'), icon: 'package' },
    decision: { color: '#db2777', text: '#ffffff', border: '#fbcfe8', shape: 'round-diamond', label: __('Decision'), icon: 'git-fork' },
    milestone: { color: '#ca8a04', text: '#ffffff', border: '#fef08a', shape: 'round-tag', label: __('Milestone'), icon: 'flag' },
    task: { color: '#2563eb', text: '#ffffff', border: '#bfdbfe', shape: 'round-rectangle', label: __('Task'), icon: 'square-check-big' },
    note: { color: '#64748b', text: '#ffffff', border: '#cbd5e1', shape: 'cut-rectangle', label: __('Note'), icon: 'sticky-note' }
  };

  // Lucide icon bodies (ISC licence), drawn inside each node so its type reads without colour alone.
  var ICONS = {
    idea: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
    person: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><path d="M16 3.128a4 4 0 0 1 0 7.744"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/>',
    goal: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    assumption: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
    risk: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    resource: '<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12"/><polyline points="3.29 7 12 12 20.71 7"/><path d="m7.5 4.27 9 5.15"/>',
    decision: '<circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9"/><path d="M12 12v3"/>',
    milestone: '<path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"/>',
    task: '<path d="M21 10.656V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12.344"/><path d="m9 11 3 3L22 4"/>',
    note: '<path d="M21 9a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2z"/><path d="M15 3v5a1 1 0 0 0 1 1h5"/>'
  };

  function iconSvg(type, color) {
    var body = ICONS[type] || '';
    return '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="' + color + '" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
  }
  function iconUri(type, color) {
    var t = NODE_TYPES[type];
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(iconSvg(type, color || (t ? t.text : '#ffffff')));
  }

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
    var base = type === 'decision' ? 190 : type === 'person' ? 180 : 160;
    return Math.min(270, Math.max(base, Math.min(t.length, 30) * 8 + 48));
  }
  function nodeHeight(ele) {
    var type = ele.data('type');
    if (type === 'decision') return 104;
    if (type === 'person') return 84;
    if (type === 'idea') return 82;
    if (type === 'goal' || type === 'risk') return 80;
    return 72;
  }

  function stylesheet(opts) {
    opts = opts || {};
    var s = [
      {
        selector: 'node',
        style: {
          label: 'data(title)', 'text-wrap': 'wrap', 'text-max-width': function (e) { return nodeWidth(e) - 30; },
          'text-valign': 'center', 'text-halign': 'center', 'text-margin-y': 11, 'line-height': 1.25,
          'font-size': 14, 'font-weight': 700,
          'font-family': 'Cairo, Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          width: nodeWidth, height: nodeHeight,
          'background-width': 22, 'background-height': 22, 'background-position-x': '50%',
          'background-position-y': function (e) { return e.data('type') === 'decision' ? 22 : 10; },
          'background-clip': 'none', 'background-image-containment': 'over', 'background-image-smoothing': 'yes',
          'border-width': 2.5, 'border-opacity': 0.9,
          'overlay-padding': 6, 'overlay-opacity': 0,
          'transition-property': 'border-color, border-width, opacity, background-color', 'transition-duration': '150ms'
        }
      },
      { selector: 'node[type="idea"]', style: { 'font-size': 16, 'border-width': 3 } },
      // Risks always carry a red halo so they stand out from goals at a glance.
      { selector: 'node[type="risk"]', style: { 'border-width': 3, 'outline-width': 6, 'outline-color': '#ef4444', 'outline-opacity': 0.4, 'outline-offset': 3 } },
      { selector: 'node[type="goal"]', style: { 'border-width': 3, 'outline-width': 4, 'outline-color': '#10b981', 'outline-opacity': 0.3, 'outline-offset': 3 } },
      { selector: 'node[type="assumption"]', style: { 'border-style': 'dashed', 'border-width': 3 } },
      { selector: 'node[status="invalidated"]', style: { opacity: 0.6, 'border-style': 'dashed', 'border-color': '#f87171', 'border-width': 3 } },
      { selector: 'node[status="validated"]', style: { 'border-color': '#4ade80', 'border-width': 4, 'border-style': 'solid' } },
      { selector: 'node[status="done"]', style: { 'border-color': '#e2e8f0', 'border-width': 3, 'background-opacity': 0.75 } },
      { selector: 'node[status="in_progress"]', style: { 'border-color': '#93c5fd', 'border-width': 3 } },
      { selector: 'node[priority="high"]', style: { 'border-width': 4 } },
      { selector: 'node[priority="critical"]', style: { 'border-width': 4, 'outline-width': 9, 'outline-color': '#f43f5e', 'outline-opacity': 0.55, 'outline-offset': 3 } },
      { selector: 'node:selected', style: { 'border-color': '#ffffff', 'border-width': 4, 'underlay-color': '#a78bfa', 'underlay-opacity': 0.4, 'underlay-padding': 10 } },
      { selector: 'node.connect-source', style: { 'border-color': '#fde047', 'border-width': 5, 'border-style': 'double' } },
      { selector: 'node.dimmed', style: { opacity: 0.18 } },
      { selector: 'node.match', style: { 'underlay-color': '#fde047', 'underlay-opacity': 0.5, 'underlay-padding': 10 } },
      {
        selector: 'edge',
        style: {
          width: 3, 'curve-style': 'bezier', 'arrow-scale': 1.6, 'target-distance-from-node': 4,
          label: opts.edgeLabels === false ? '' : 'data(label)', 'font-size': 13, 'font-weight': 700,
          'font-family': 'Cairo, Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          'text-background-color': opts.background || '#0f1630', 'text-background-opacity': 1,
          'text-background-padding': 4, 'text-background-shape': 'round-rectangle',
          'text-border-width': 1, 'text-border-opacity': 0.7,
          'text-rotation': 'none', 'overlay-padding': 6, 'overlay-opacity': 0
        }
      },
      { selector: 'edge[relationship="blocks"]', style: { width: 4.5, 'arrow-scale': 1.8 } },
      { selector: 'edge:selected', style: { width: 5, 'underlay-color': '#a78bfa', 'underlay-opacity': 0.35, 'underlay-padding': 5 } },
      { selector: 'edge.dimmed', style: { opacity: 0.1 } }
    ];
    Object.keys(NODE_TYPES).forEach(function (k) {
      var t = NODE_TYPES[k];
      s.push({ selector: 'node[type="' + k + '"]', style: { 'background-color': t.color, 'border-color': t.border, color: t.text, shape: t.shape, 'background-image': iconUri(k) } });
    });
    Object.keys(RELATIONSHIPS).forEach(function (k) {
      var r = RELATIONSHIPS[k];
      s.push({ selector: 'edge[relationship="' + k + '"]', style: { 'line-color': r.color, 'target-arrow-color': r.color, 'target-arrow-shape': r.arrow, 'line-style': r.style, color: r.color, 'text-border-color': r.color } });
    });
    // Keep later per-status/selected rules winning over per-type colours.
    s.push({ selector: 'node[status="validated"]', style: { 'border-color': '#4ade80' } });
    s.push({ selector: 'node[status="invalidated"]', style: { 'border-color': '#f87171' } });
    s.push({ selector: 'node:selected', style: { 'border-color': '#ffffff', 'border-width': 4 } });
    s.push({ selector: 'node.connect-source', style: { 'border-color': '#fde047' } });
    return s;
  }

  /* Small swatch matching a node on the canvas: its colour plus its icon. */
  function typeChip(type, size) {
    var t = NODE_TYPES[type];
    var chip = document.createElement('span');
    chip.className = 'type-chip';
    if (!t) return chip;
    chip.style.background = t.color;
    chip.style.borderColor = t.border;
    if (size) { chip.style.width = chip.style.height = size + 'px'; }
    var img = document.createElement('img');
    img.src = iconUri(type);
    img.alt = '';
    chip.appendChild(img);
    return chip;
  }

  window.IdeaPilotGraph = { NODE_TYPES: NODE_TYPES, RELATIONSHIPS: RELATIONSHIPS, stylesheet: stylesheet, iconUri: iconUri, typeChip: typeChip };
})();
