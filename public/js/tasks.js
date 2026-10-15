/* Task interactions: inline edits (list), drag-and-drop (Kanban + roadmap), task form helpers. */
(function () {
  'use strict';
  var IP = window.IdeaPilot;
  var __ = IP.__;
  var WS = window.IdeaPilotWorkspace || { setSaveState: function () {} };
  var projectId = document.body.getAttribute('data-project-id');
  var base = '/projects/' + projectId + '/tasks';

  function saving(promise) {
    WS.setSaveState('saving');
    return promise.then(function (res) {
      WS.setSaveState('saved');
      if (res && res.progress) updateProgress(res.progress);
      return res;
    }, function (err) {
      WS.setSaveState('error', err.message);
      IP.toast(err.message, 'danger');
      throw err;
    });
  }

  function updateProgress(p) {
    document.querySelectorAll('[data-progress-text]').forEach(function (el) {
      el.textContent = __(el.closest('[data-roadmap]') ? '{done} of {total} tasks' : '{done} of {total} completed', { done: p.completed, total: p.total }) + ' · ' + p.percent + '%';
    });
    document.querySelectorAll('[data-progress-bar]').forEach(function (el) { el.style.width = p.percent + '%'; });
    var headerBar = document.querySelector('.ws-progress-bar span');
    if (headerBar) headerBar.style.width = p.percent + '%';
    var headerLabel = document.querySelector('[data-progress-label]');
    if (headerLabel) headerLabel.textContent = p.percent + '%';
  }

  // ---------- List view: inline status / priority / deadline ----------
  document.querySelectorAll('tr[data-task-id] [data-task-field]').forEach(function (input) {
    var previous = input.value;
    input.addEventListener('change', function () {
      var row = input.closest('tr');
      var field = input.getAttribute('data-task-field');
      var body = {};
      body[field] = input.value || null;
      saving(IP.api(base + '/' + row.getAttribute('data-task-id'), { method: 'PATCH', body: body })).then(function (res) {
        previous = input.value;
        var link = row.querySelector('a.fw-semibold');
        if (field === 'status' && link) link.classList.toggle('task-title-done', res.task.status === 'completed');
        if (res.flags) {
          row.classList.toggle('is-overdue', res.flags.isOverdue);
          row.classList.toggle('is-blocked', res.flags.isBlocked && res.task.status !== 'completed');
        }
        IP.toast(__('Task updated.'));
      }, function () { input.value = previous; });
    });
  });

  // ---------- Kanban ----------
  var kanban = document.querySelector('[data-kanban]');
  if (kanban) {
    var dragged = null;
    var lists = kanban.querySelectorAll('[data-kanban-list]');

    var refreshCounts = function () {
      kanban.querySelectorAll('.kanban-col').forEach(function (col) {
        col.querySelector('[data-col-count]').textContent = String(col.querySelectorAll('.k-card').length);
      });
    };
    var persistColumn = function (list, card, fromList, nextSibling) {
      var status = list.getAttribute('data-status');
      if (fromList === list) return Promise.resolve();
      return saving(IP.api(base + '/' + card.getAttribute('data-task-id'), { method: 'PATCH', body: { status: status } })).then(function (res) {
        card.querySelector('.k-card-title').classList.toggle('task-title-done', status === 'completed');
        if (res.flags) {
          card.classList.toggle('is-overdue', res.flags.isOverdue);
          card.classList.toggle('is-blocked', res.flags.isBlocked && status !== 'completed');
        }
        refreshCounts();
      }, function () {
        // Revert the move when the server rejects it (for example unfinished dependencies).
        if (fromList) fromList.insertBefore(card, nextSibling && nextSibling.parentNode === fromList ? nextSibling : null);
        refreshCounts();
        throw new Error('reverted');
      });
    };

    kanban.addEventListener('dragstart', function (e) {
      var card = e.target.closest('.k-card');
      if (!card) return;
      dragged = { card: card, from: card.parentNode, next: card.nextElementSibling };
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', card.getAttribute('data-task-id'));
    });
    kanban.addEventListener('dragend', function (e) {
      var card = e.target.closest('.k-card');
      if (card) card.classList.remove('dragging');
      lists.forEach(function (l) { l.classList.remove('drag-over'); });
    });
    lists.forEach(function (list) {
      list.addEventListener('dragover', function (e) {
        if (!dragged) return;
        e.preventDefault();
        list.classList.add('drag-over');
        var after = Array.prototype.find.call(list.querySelectorAll('.k-card:not(.dragging)'), function (c) {
          var box = c.getBoundingClientRect();
          return e.clientY < box.top + box.height / 2;
        });
        list.insertBefore(dragged.card, after || null);
      });
      list.addEventListener('dragleave', function (e) { if (!list.contains(e.relatedTarget)) list.classList.remove('drag-over'); });
      list.addEventListener('drop', function (e) {
        e.preventDefault();
        list.classList.remove('drag-over');
        if (!dragged) return;
        var d = dragged;
        dragged = null;
        persistColumn(list, d.card, d.from, d.next).catch(function () {});
      });
    });
    // Keyboard / touch alternative: move buttons on each card.
    kanban.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-move-status]');
      if (!btn) return;
      var card = btn.closest('.k-card');
      var target = kanban.querySelector('[data-kanban-list][data-status="' + btn.getAttribute('data-move-status') + '"]');
      var from = card.parentNode;
      var next = card.nextElementSibling;
      target.appendChild(card);
      persistColumn(target, card, from, next).then(function () { window.location.reload(); }, function () {});
    });
  }

  // ---------- Roadmap: complete toggles and drag-to-reorder across phases ----------
  var roadmap = document.querySelector('[data-roadmap]');
  if (roadmap) {
    roadmap.addEventListener('click', function (e) {
      var toggle = e.target.closest('[data-toggle-complete]');
      if (toggle) {
        var row = toggle.closest('[data-task-id]');
        var next = row.getAttribute('data-task-status') === 'completed' ? 'todo' : 'completed';
        saving(IP.api(base + '/' + row.getAttribute('data-task-id'), { method: 'PATCH', body: { status: next } })).then(function () {
          window.location.reload();
        }).catch(function () {});
        return;
      }
      var mover = e.target.closest('[data-move-task]');
      if (mover) {
        var r = mover.closest('[data-task-id]');
        var zone = r.parentNode;
        if (mover.getAttribute('data-move-task') === 'up' && r.previousElementSibling) zone.insertBefore(r, r.previousElementSibling);
        else if (mover.getAttribute('data-move-task') === 'down' && r.nextElementSibling) zone.insertBefore(r.nextElementSibling, r);
        persistZone(zone);
      }
    });

    var draggedRow = null;
    var persistZone = function (zone) {
      var ids = Array.prototype.map.call(zone.querySelectorAll('[data-task-id]'), function (r) { return r.getAttribute('data-task-id'); });
      if (!ids.length) return Promise.resolve();
      var phaseId = zone.getAttribute('data-phase-id') || null;
      return saving(IP.api(base + '/reorder', { method: 'POST', body: { orderedIds: ids, phaseId: phaseId } })).catch(function () { window.location.reload(); });
    };
    roadmap.addEventListener('dragstart', function (e) {
      var row = e.target.closest('.roadmap-task');
      if (!row) return;
      draggedRow = { row: row, from: row.parentNode };
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', row.getAttribute('data-task-id'));
    });
    roadmap.addEventListener('dragend', function (e) {
      var row = e.target.closest('.roadmap-task');
      if (row) row.classList.remove('dragging');
      roadmap.querySelectorAll('[data-dropzone]').forEach(function (z) { z.classList.remove('drag-over'); });
    });
    roadmap.querySelectorAll('[data-dropzone]').forEach(function (zone) {
      zone.addEventListener('dragover', function (e) {
        if (!draggedRow) return;
        e.preventDefault();
        zone.classList.add('drag-over');
        var after = Array.prototype.find.call(zone.querySelectorAll('.roadmap-task:not(.dragging)'), function (c) {
          var box = c.getBoundingClientRect();
          return e.clientY < box.top + box.height / 2;
        });
        zone.insertBefore(draggedRow.row, after || null);
      });
      zone.addEventListener('dragleave', function (e) { if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over'); });
      zone.addEventListener('drop', function (e) {
        e.preventDefault();
        zone.classList.remove('drag-over');
        if (!draggedRow) return;
        var from = draggedRow.from;
        draggedRow = null;
        persistZone(zone).then(function () {
          if (from !== zone) window.location.reload();
        });
      });
    });
  }

  // ---------- Task form helpers ----------
  var statusSelect = document.querySelector('[data-status-select]');
  var blocked = document.querySelector('[data-blocked-reason]');
  if (statusSelect && blocked) {
    statusSelect.addEventListener('change', function () { blocked.hidden = statusSelect.value !== 'blocked'; });
  }
  var phaseSelect = document.querySelector('[data-phase-select]');
  var milestoneSelect = document.querySelector('[data-milestone-select]');
  if (phaseSelect && milestoneSelect) {
    var syncMilestones = function () {
      Array.prototype.forEach.call(milestoneSelect.options, function (opt) {
        if (!opt.value) return;
        var match = opt.getAttribute('data-phase') === phaseSelect.value;
        opt.hidden = !match;
        opt.disabled = !match;
        if (!match && opt.selected) milestoneSelect.value = '';
      });
    };
    phaseSelect.addEventListener('change', syncMilestones);
    syncMilestones();
  }

})();
