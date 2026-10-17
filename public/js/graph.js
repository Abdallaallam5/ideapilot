/* Interactive idea map (Cytoscape.js, no framework). All changes persist via the JSON API. */
(function () {
  'use strict';

  var dataEl = document.getElementById('graphData');
  var container = document.getElementById('cy');
  if (!dataEl || !container || !window.cytoscape) return;

  var G = window.IdeaPilotGraph;
  var IP = window.IdeaPilot;
  var __ = IP.__;
  var WS = window.IdeaPilotWorkspace || { setSaveState: function () {} };
  var initial = JSON.parse(dataEl.textContent);
  var projectId = initial.projectId;
  var apiBase = '/projects/' + projectId + '/graph';
  var storageKey = 'ideapilot:map:' + projectId;
  var linkedTasks = initial.linkedTasks || [];

  function relLabel(rel) { return (G.RELATIONSHIPS[rel] || { label: rel }).label; }
  function nodeEl(n) {
    return { group: 'nodes', data: { id: n.id, type: n.type, title: n.title, description: n.description, status: n.status, priority: n.priority, source: n.source }, position: { x: n.position.x, y: n.position.y } };
  }
  function edgeEl(e) {
    return { group: 'edges', data: { id: e.id, source: e.source, target: e.target, relationship: e.relationship, description: e.description, label: relLabel(e.relationship) } };
  }

  var style = G.stylesheet();
  style.push({ selector: '.filtered', style: { display: 'none' } });

  var cy = window.cytoscape({
    container: container,
    elements: initial.nodes.map(nodeEl).concat(initial.edges.map(edgeEl)),
    style: style,
    layout: { name: 'preset' },
    wheelSensitivity: 0.25,
    minZoom: 0.15,
    maxZoom: 3,
    boxSelectionEnabled: false,
    selectionType: 'single'
  });

  // ---------- Persistence helpers ----------
  var pending = 0;
  function track(promise) {
    pending++;
    WS.setSaveState('saving');
    return promise.then(function (res) {
      pending--;
      if (!pending) WS.setSaveState('saved');
      return res;
    }, function (err) {
      pending--;
      WS.setSaveState('error', err.message);
      IP.toast(err.message, 'danger');
      throw err;
    });
  }

  function loadPrefs() {
    try { return JSON.parse(window.localStorage.getItem(storageKey) || '{}'); } catch (e) { return {}; }
  }
  function savePrefs(patch) {
    try {
      var prefs = loadPrefs();
      Object.assign(prefs, patch);
      window.localStorage.setItem(storageKey, JSON.stringify(prefs));
    } catch (e) { /* storage unavailable: ignore */ }
  }

  // ---------- Viewport restore ----------
  var prefs = loadPrefs();
  if (prefs.zoom && prefs.pan && cy.nodes().length) {
    cy.viewport({ zoom: prefs.zoom, pan: prefs.pan });
  } else {
    cy.fit(undefined, 60);
    if (cy.zoom() > 1.2) cy.zoom(1.2), cy.center();
  }
  var viewportTimer;
  cy.on('viewport', function () {
    clearTimeout(viewportTimer);
    viewportTimer = setTimeout(function () { savePrefs({ zoom: cy.zoom(), pan: cy.pan() }); }, 300);
  });

  // ---------- Position saving (debounced, batched) ----------
  var movedIds = new Set();
  var moveTimer;
  function flushPositions() {
    if (!movedIds.size) return;
    var positions = [];
    movedIds.forEach(function (id) {
      var n = cy.getElementById(id);
      if (n.nonempty()) positions.push({ id: id, x: Math.round(n.position('x')), y: Math.round(n.position('y')) });
    });
    movedIds.clear();
    for (var i = 0; i < positions.length; i += 400) {
      track(IP.api(apiBase + '/positions', { method: 'POST', body: { positions: positions.slice(i, i + 400) } })).catch(function () {});
    }
  }
  cy.on('dragfree', 'node', function (evt) {
    movedIds.add(evt.target.id());
    clearTimeout(moveTimer);
    moveTimer = setTimeout(flushPositions, 500);
  });
  window.addEventListener('beforeunload', function (e) {
    if (movedIds.size) { flushPositions(); }
    if (pending) { e.preventDefault(); e.returnValue = ''; }
  });

  // ---------- Inspector ----------
  var inspector = document.querySelector('[data-inspector]');
  var emptyPanel = inspector.querySelector('[data-inspector-empty]');
  var nodeForm = inspector.querySelector('[data-node-form]');
  var edgeForm = inspector.querySelector('[data-edge-form]');
  var replanForm = inspector.querySelector('[data-replan-form]');
  var selectedId = null;

  function show(panel) {
    emptyPanel.hidden = panel !== 'empty';
    nodeForm.hidden = panel !== 'node';
    replanForm.hidden = panel !== 'node';
    edgeForm.hidden = panel !== 'edge';
  }

  function typeBadge(type) {
    var t = G.NODE_TYPES[type] || G.NODE_TYPES.note;
    var span = document.createElement('span');
    span.className = 'type-badge';
    span.style.background = t.color;
    span.style.color = t.text;
    var img = document.createElement('img');
    img.src = G.iconUri(type in G.NODE_TYPES ? type : 'note');
    img.alt = '';
    span.appendChild(img);
    span.appendChild(document.createTextNode(t.label));
    return span;
  }

  function renderCounts() {
    var grid = inspector.querySelector('[data-type-counts]');
    grid.textContent = '';
    Object.keys(G.NODE_TYPES).forEach(function (type) {
      var count = cy.nodes('[type="' + type + '"]').length;
      var cell = document.createElement('div');
      cell.appendChild(G.typeChip(type, 22));
      var strong = document.createElement('strong');
      strong.textContent = String(count);
      cell.appendChild(strong);
      cell.appendChild(document.createTextNode(G.NODE_TYPES[type].label));
      grid.appendChild(cell);
    });
  }

  function li(content, onClick) {
    var item = document.createElement('li');
    if (onClick) {
      item.tabIndex = 0;
      item.setAttribute('role', 'button');
      item.addEventListener('click', onClick);
      item.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } });
    }
    content.forEach(function (c) { item.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return item;
  }
  function tag(text, cls) {
    var s = document.createElement('span');
    s.className = cls || 'conn-rel';
    s.textContent = text;
    return s;
  }

  function openNode(node) {
    selectedId = node.id();
    var d = node.data();
    var badgeWrap = nodeForm.querySelector('[data-node-badge-wrap]');
    badgeWrap.textContent = '';
    badgeWrap.appendChild(typeBadge(d.type));
    nodeForm.title.value = d.title;
    nodeForm.description.value = d.description || '';
    nodeForm.type.value = d.type;
    nodeForm.status.value = d.status;
    nodeForm.priority.value = d.priority;
    nodeForm.title.classList.remove('is-invalid');

    var conns = nodeForm.querySelector('[data-node-connections]');
    conns.textContent = '';
    node.connectedEdges().forEach(function (e) {
      var outgoing = e.source().id() === node.id();
      var other = outgoing ? e.target() : e.source();
      conns.appendChild(li([tag(outgoing ? __('this {rel}', { rel: relLabel(e.data('relationship')) }) : __('{rel} this', { rel: relLabel(e.data('relationship')) })), ' ', (outgoing ? '→ ' : '← '), other.data('title')], function () { selectElement(e); }));
    });
    if (!conns.children.length) conns.appendChild(li([__('No connections yet.')]));

    var tasksList = nodeForm.querySelector('[data-node-tasks]');
    tasksList.textContent = '';
    linkedTasks.filter(function (t) { return t.nodeId === node.id(); }).forEach(function (t) {
      var a = document.createElement('a');
      a.href = '/projects/' + projectId + '/tasks/' + t.id + '/edit';
      a.className = 'text-reset text-decoration-none';
      a.textContent = t.title;
      tasksList.appendChild(li([tag(t.status.replace('_', ' ')), ' ', a]));
    });
    if (!tasksList.children.length) tasksList.appendChild(li([__('No tasks linked to this node.')]));
    nodeForm.querySelector('[data-create-task-link]').href = '/projects/' + projectId + '/tasks/new?nodeId=' + encodeURIComponent(node.id());
    replanForm.querySelector('[data-replan-node]').value = node.id();
    show('node');
  }

  function openEdge(edge) {
    selectedId = edge.id();
    edgeForm.relationship.value = edge.data('relationship');
    edgeForm.description.value = edge.data('description') || '';
    edgeForm.querySelector('[data-edge-summary]').textContent = '“' + edge.source().data('title') + '” ' + relLabel(edge.data('relationship')) + ' “' + edge.target().data('title') + '”';
    show('edge');
  }

  function closeInspector() {
    selectedId = null;
    cy.elements().unselect();
    renderCounts();
    show('empty');
  }

  function selectElement(ele) {
    cy.elements().unselect();
    ele.select();
    if (ele.isNode()) openNode(ele); else openEdge(ele);
  }

  cy.on('tap', 'node', function (evt) {
    if (connectMode) return completeConnection(evt.target);
    openNode(evt.target);
  });
  cy.on('tap', 'edge', function (evt) { if (!connectMode) openEdge(evt.target); });
  cy.on('tap', function (evt) {
    if (evt.target === cy) {
      if (connectMode) return cancelConnect();
      closeInspector();
    }
  });
  inspector.querySelectorAll('[data-inspector-close]').forEach(function (b) { b.addEventListener('click', closeInspector); });

  nodeForm.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!selectedId) return;
    var title = nodeForm.title.value.trim();
    if (!title) {
      nodeForm.title.classList.add('is-invalid');
      nodeForm.querySelector('[data-error-for="title"]').textContent = __('Title is required.');
      return;
    }
    var id = selectedId;
    var body = { title: title, description: nodeForm.description.value, type: nodeForm.type.value, status: nodeForm.status.value, priority: nodeForm.priority.value };
    track(IP.api(apiBase + '/nodes/' + id, { method: 'PATCH', body: body })).then(function (res) {
      var n = cy.getElementById(id);
      n.data({ title: res.node.title, description: res.node.description, type: res.node.type, status: res.node.status, priority: res.node.priority });
      if (selectedId === id) openNode(n);
      renderLegendFilters();
      IP.toast(__('Node saved.'));
    }).catch(function () {});
  });

  edgeForm.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!selectedId) return;
    var id = selectedId;
    track(IP.api(apiBase + '/edges/' + id, { method: 'PATCH', body: { relationship: edgeForm.relationship.value, description: edgeForm.description.value } })).then(function (res) {
      var edge = cy.getElementById(id);
      edge.data({ relationship: res.edge.relationship, description: res.edge.description, label: relLabel(res.edge.relationship) });
      openEdge(edge);
      IP.toast(__('Connection saved.'));
    }).catch(function () {});
  });

  function confirmThen(message, fn) {
    var btn = document.createElement('button');
    btn.setAttribute('data-confirm', message);
    btn.setAttribute('data-confirm-label', __('Delete'));
    btn.__confirmHandler = fn;
    btn.hidden = true;
    document.body.appendChild(btn);
    btn.click();
    setTimeout(function () { btn.remove(); }, 0);
  }

  function deleteSelected() {
    if (!selectedId) return;
    var ele = cy.getElementById(selectedId);
    if (ele.empty()) return;
    if (ele.isNode()) {
      var edgesCount = ele.connectedEdges().length;
      confirmThen(edgesCount ? __('Delete “{title}” and its {n} connection(s)? Linked tasks are kept but unlinked.', { title: ele.data('title'), n: edgesCount }) : __('Delete “{title}”? Linked tasks are kept but unlinked.', { title: ele.data('title') }), function () {
        var id = ele.id();
        track(IP.api(apiBase + '/nodes/' + id, { method: 'DELETE' })).then(function () {
          cy.getElementById(id).remove();
          linkedTasks = linkedTasks.filter(function (t) { return t.nodeId !== id; });
          closeInspector();
          updateEmptyHint();
        }).catch(function () {});
      });
    } else {
      confirmThen(__('Delete this connection?'), function () {
        var id = ele.id();
        track(IP.api(apiBase + '/edges/' + id, { method: 'DELETE' })).then(function () {
          cy.getElementById(id).remove();
          closeInspector();
        }).catch(function () {});
      });
    }
  }
  nodeForm.querySelector('[data-delete-node]').addEventListener('click', deleteSelected);
  edgeForm.querySelector('[data-delete-edge]').addEventListener('click', deleteSelected);

  // ---------- Adding nodes ----------
  /** Finds a free spot near the centre of the viewport so new nodes never overlap existing ones. */
  function freePosition() {
    var ext = cy.extent();
    var cx = (ext.x1 + ext.x2) / 2;
    var cy0 = (ext.y1 + ext.y2) / 2;
    var taken = cy.nodes().map(function (n) { return n.position(); });
    var free = function (x, y) {
      return taken.every(function (p) { return Math.abs(p.x - x) > 200 || Math.abs(p.y - y) > 90; });
    };
    for (var ring = 0; ring < 12; ring++) {
      var steps = Math.max(1, ring * 8);
      for (var i = 0; i < steps; i++) {
        var angle = (i / steps) * Math.PI * 2;
        var x = Math.round(cx + Math.cos(angle) * ring * 130);
        var y = Math.round(cy0 + Math.sin(angle) * ring * 90);
        if (free(x, y)) return { x: x, y: y };
      }
    }
    return { x: Math.round(cx), y: Math.round(cy0) };
  }
  document.querySelectorAll('[data-add-node]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var type = btn.getAttribute('data-add-node');
      var body = { type: type, title: __('New {type}', { type: G.NODE_TYPES[type].label.toLowerCase() }), position: freePosition() };
      track(IP.api(apiBase + '/nodes', { method: 'POST', body: body })).then(function (res) {
        var n = cy.add(nodeEl(res.node));
        applyFilters();
        updateEmptyHint();
        selectElement(n);
        nodeForm.title.focus();
        nodeForm.title.select();
      }).catch(function () {});
    });
  });

  // ---------- Connecting nodes ----------
  var connectMode = false;
  var connectSource = null;
  var hint = document.querySelector('[data-map-hint]');
  var connectBtn = document.querySelector('[data-connect-toggle]');
  var relSelect = document.querySelector('[data-new-edge-rel]');

  function setHint(text) { hint.textContent = text || ''; hint.hidden = !text; }
  function startConnect() {
    var sel = selectedId ? cy.getElementById(selectedId) : null;
    if (!sel || sel.empty() || !sel.isNode()) {
      IP.toast(__('Select the node you want to connect from first.'));
      return;
    }
    connectMode = true;
    connectSource = sel;
    sel.addClass('connect-source');
    connectBtn.classList.add('active');
    connectBtn.setAttribute('aria-pressed', 'true');
    setHint(__('Click the node that “{title}” {rel}. Press Esc to cancel.', { title: sel.data('title'), rel: relLabel(relSelect.value) }));
  }
  function cancelConnect() {
    connectMode = false;
    if (connectSource) connectSource.removeClass('connect-source');
    connectSource = null;
    connectBtn.classList.remove('active');
    connectBtn.setAttribute('aria-pressed', 'false');
    setHint('');
  }
  function completeConnection(target) {
    var source = connectSource;
    cancelConnect();
    if (!source || target.id() === source.id()) { IP.toast(__('A node cannot be connected to itself.')); return; }
    var body = { source: source.id(), target: target.id(), relationship: relSelect.value };
    track(IP.api(apiBase + '/edges', { method: 'POST', body: body })).then(function (res) {
      var e = cy.add(edgeEl(res.edge));
      selectElement(e);
    }).catch(function () {});
  }
  connectBtn.addEventListener('click', function () { connectMode ? cancelConnect() : startConnect(); });
  nodeForm.querySelector('[data-connect-from-panel]').addEventListener('click', startConnect);
  relSelect.addEventListener('change', function () { if (connectMode && connectSource) setHint('Click the node that “' + connectSource.data('title') + '” ' + relLabel(relSelect.value) + '. Press Esc to cancel.'); });

  // ---------- Zoom / fit / arrange ----------
  document.querySelectorAll('[data-zoom]').forEach(function (b) {
    b.addEventListener('click', function () {
      var factor = b.getAttribute('data-zoom') === 'in' ? 1.2 : 1 / 1.2;
      var ext = cy.extent();
      cy.zoom({ level: cy.zoom() * factor, position: { x: (ext.x1 + ext.x2) / 2, y: (ext.y1 + ext.y2) / 2 } });
    });
  });
  document.querySelector('[data-fit]').addEventListener('click', function () { cy.animate({ fit: { eles: cy.elements(':visible'), padding: 60 } }, { duration: 250 }); });
  document.querySelector('[data-arrange]').addEventListener('click', function () {
    var layout = cy.elements(':visible').layout({ name: 'cose', animate: true, animationDuration: 500, nodeRepulsion: function () { return 9000; }, idealEdgeLength: function () { return 140; }, padding: 60, randomize: false });
    layout.one('layoutstop', function () {
      cy.nodes().forEach(function (n) { movedIds.add(n.id()); });
      flushPositions();
    });
    layout.run();
  });

  // ---------- Filters, search, legend ----------
  var filterInputs = Array.prototype.slice.call(document.querySelectorAll('[data-type-filter]'));
  var hiddenTypes = new Set(prefs.hiddenTypes || []);
  filterInputs.forEach(function (input) {
    input.checked = !hiddenTypes.has(input.value);
    input.addEventListener('change', function () {
      if (input.checked) hiddenTypes.delete(input.value); else hiddenTypes.add(input.value);
      applyFilters();
    });
  });
  document.querySelector('[data-filter-all]').addEventListener('click', function () { hiddenTypes.clear(); filterInputs.forEach(function (i) { i.checked = true; }); applyFilters(); });
  document.querySelector('[data-filter-none]').addEventListener('click', function () { filterInputs.forEach(function (i) { i.checked = false; hiddenTypes.add(i.value); }); applyFilters(); });

  function applyFilters() {
    cy.batch(function () {
      cy.nodes().forEach(function (n) { n.toggleClass('filtered', hiddenTypes.has(n.data('type'))); });
    });
    var countEl = document.querySelector('[data-filter-count]');
    countEl.textContent = hiddenTypes.size ? '(' + (filterInputs.length - hiddenTypes.size) + '/' + filterInputs.length + ')' : '';
    savePrefs({ hiddenTypes: Array.from(hiddenTypes) });
    if (selectedId) {
      var s = cy.getElementById(selectedId);
      if (s.nonempty() && s.isNode() && s.hasClass('filtered')) closeInspector();
    }
  }

  var searchInput = document.querySelector('[data-map-search]');
  searchInput.addEventListener('input', function () {
    var q = searchInput.value.trim().toLowerCase();
    cy.batch(function () {
      cy.elements().removeClass('dimmed match');
      if (!q) return;
      var matches = cy.nodes().filter(function (n) { return (n.data('title') + ' ' + (n.data('description') || '')).toLowerCase().indexOf(q) !== -1; });
      cy.nodes().not(matches).addClass('dimmed');
      cy.edges().addClass('dimmed');
      matches.addClass('match');
    });
  });
  searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      var first = cy.nodes('.match').first();
      if (first.nonempty()) { cy.animate({ center: { eles: first }, zoom: Math.max(cy.zoom(), 1) }, { duration: 250 }); selectElement(first); }
    }
  });

  function arrowSvg(r) {
    var dash = r.style === 'dashed' ? ' stroke-dasharray="5 3"' : r.style === 'dotted' ? ' stroke-dasharray="1.5 3"' : '';
    var head = {
      triangle: '<path d="M30 6 L22 1.5 L22 10.5 Z" fill="' + r.color + '"/>',
      vee: '<path d="M22 1.5 L30 6 L22 10.5" fill="none" stroke="' + r.color + '" stroke-width="2"/>',
      tee: '<path d="M29 0.5 V11.5" stroke="' + r.color + '" stroke-width="3"/>',
      diamond: '<path d="M30 6 L25.5 2 L21 6 L25.5 10 Z" fill="' + r.color + '"/>',
      circle: '<circle cx="26" cy="6" r="3.5" fill="' + r.color + '"/>'
    }[r.arrow] || '';
    var end = r.arrow === 'none' ? 30 : 22;
    return '<svg width="32" height="12" viewBox="0 0 32 12" aria-hidden="true"><line x1="1" y1="6" x2="' + end + '" y2="6" stroke="' + r.color + '" stroke-width="2.5" stroke-linecap="round"' + dash + '/>' + head + '</svg>';
  }

  function renderLegendFilters() {
    var nodesEl = document.querySelector('[data-legend-nodes]');
    var edgesEl = document.querySelector('[data-legend-edges]');
    if (!nodesEl || nodesEl.childElementCount) return;
    Object.keys(G.NODE_TYPES).forEach(function (k) {
      var item = document.createElement('span');
      item.className = 'lg-item';
      item.appendChild(G.typeChip(k));
      item.appendChild(document.createTextNode(G.NODE_TYPES[k].label));
      nodesEl.appendChild(item);
    });
    Object.keys(G.RELATIONSHIPS).forEach(function (k) {
      var r = G.RELATIONSHIPS[k];
      var item = document.createElement('span');
      item.className = 'lg-item';
      var ln = document.createElement('span');
      ln.className = 'ln';
      ln.innerHTML = arrowSvg(r);
      item.appendChild(ln);
      item.appendChild(document.createTextNode(r.label));
      edgesEl.appendChild(item);
    });
  }
  document.querySelectorAll('[data-type-dot]').forEach(function (dot) {
    var type = dot.getAttribute('data-type-dot');
    if (G.NODE_TYPES[type]) dot.replaceWith(G.typeChip(type));
  });

  function updateEmptyHint() {
    if (!connectMode) setHint(cy.nodes().length <= 1 ? __('Start by adding goals, assumptions and risks from “Add node”.') : '');
  }

  // ---------- Keyboard shortcuts ----------
  document.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
    if (e.key === 'Escape') { if (connectMode) cancelConnect(); else closeInspector(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) { e.preventDefault(); deleteSelected(); }
    else if (e.key === 'c' || e.key === 'C') { connectMode ? cancelConnect() : startConnect(); }
    else if (e.key === 'f' || e.key === 'F') { cy.animate({ fit: { eles: cy.elements(':visible'), padding: 60 } }, { duration: 250 }); }
  });

  window.addEventListener('resize', function () { cy.resize(); });

  applyFilters();
  renderLegendFilters();
  renderCounts();
  show('empty');
  updateEmptyHint();

  // Deep link: /map#node-<id> opens that node.
  var m = /^#node-([a-f0-9]{24})$/i.exec(window.location.hash);
  if (m) {
    var target = cy.getElementById(m[1]);
    if (target.nonempty()) { selectElement(target); cy.center(target); }
  }
})();
