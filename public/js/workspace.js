/* Workspace shell: inline project title/description editing, save status, AI copilot panel. */
(function () {
  'use strict';
  var IP = window.IdeaPilot;
  var __ = IP.__;
  var projectId = document.body.getAttribute('data-project-id');

  var statusEl = document.querySelector('[data-save-status]');
  var STATES = {
    saved: { icon: 'cloud', text: __('All changes saved') },
    saving: { icon: 'loader', text: __('Saving…') },
    error: { icon: 'cloud-off', text: __('Save failed') }
  };
  function setSaveState(state, message) {
    if (!statusEl) return;
    var s = STATES[state] || STATES.saved;
    statusEl.setAttribute('data-state', state);
    statusEl.textContent = '';
    var i = document.createElement('i');
    i.setAttribute('data-lucide', s.icon);
    i.className = 'icon-sm';
    var span = document.createElement('span');
    span.textContent = state === 'error' && message ? __('Save failed: {reason}', { reason: message.slice(0, 60) }) : s.text;
    statusEl.appendChild(i);
    statusEl.appendChild(span);
    IP.refreshIcons(statusEl);
  }
  window.IdeaPilotWorkspace = { setSaveState: setSaveState, projectId: projectId };

  // ----- Inline project title + description -----
  var editor = document.querySelector('[data-project-editor]');
  if (editor) {
    var url = editor.getAttribute('data-update-url');
    var titleInput = editor.querySelector('input[name="title"]');
    var descInput = document.querySelector('[data-description-input]');
    var save = function (body) {
      setSaveState('saving');
      return IP.api(url, { method: 'POST', body: body }).then(function (res) {
        setSaveState('saved');
        return res;
      }, function (err) {
        setSaveState('error', err.message);
        IP.toast(err.message, 'danger');
        throw err;
      });
    };
    var commitTitle = function () {
      var value = titleInput.value.trim();
      if (!value) { titleInput.value = titleInput.getAttribute('data-original'); return; }
      if (value === titleInput.getAttribute('data-original')) return;
      save({ title: value }).then(function (res) {
        titleInput.setAttribute('data-original', res.project.title);
        document.title = document.title.replace(/^[^·]*/, res.project.title + ' ');
      }).catch(function () { titleInput.value = titleInput.getAttribute('data-original'); });
    };
    titleInput.addEventListener('blur', commitTitle);
    titleInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); titleInput.blur(); }
      if (e.key === 'Escape') { titleInput.value = titleInput.getAttribute('data-original'); titleInput.blur(); }
    });
    var saveDesc = document.querySelector('[data-save-description]');
    if (saveDesc && descInput) {
      saveDesc.addEventListener('click', function () {
        var value = descInput.value.trim();
        if (!value) { IP.toast(__('The description cannot be empty.'), 'danger'); return; }
        save({ description: value }).then(function () { IP.toast(__('Description saved.')); }).catch(function () {});
      });
    }
  }

  // AI buttons outside the copilot panel: show progress while the request runs.
  document.querySelectorAll('[data-ai-inline]').forEach(function (form) {
    form.addEventListener('submit', function () {
      var b = form.querySelector('button');
      setTimeout(function () { b.disabled = true; b.textContent = __('Working… this can take up to a minute'); }, 0);
    });
  });

  // ----- AI copilot -----
  var panel = document.querySelector('[data-ai-panel]');
  if (!panel || panel.getAttribute('data-ai-enabled') !== 'true') return;

  // Action buttons are regular form posts (they redirect to the proposal review page).
  panel.querySelectorAll('[data-ai-form]').forEach(function (form) {
    form.addEventListener('submit', function () {
      var btn = form.querySelector('button');
      panel.querySelectorAll('.ai-action').forEach(function (b) { b.disabled = true; });
      var small = btn.querySelector('small');
      if (small) small.textContent = __('Working on it. This can take up to a minute…');
    });
  });

  var messages = panel.querySelector('[data-ai-messages]');
  var chatForm = panel.querySelector('[data-ai-chat-form]');
  var question = panel.querySelector('#aiQuestion');
  function addMsg(text, cls) {
    var div = document.createElement('div');
    div.className = 'ai-msg ' + cls;
    div.textContent = text;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    return div;
  }
  function ask(mode, text) {
    var q = text || question.value.trim();
    if (!q) { question.focus(); return; }
    addMsg(q, 'user');
    question.value = '';
    var thinking = addMsg(__('Thinking…'), 'bot');
    chatForm.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
    IP.api('/projects/' + projectId + '/ai/chat', { method: 'POST', body: { question: q, mode: mode } })
      .then(function (res) {
        thinking.textContent = res.answer;
        (res.followUps || []).forEach(function (f) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'btn btn-sm btn-outline-light mt-1 me-1';
          b.textContent = f;
          b.addEventListener('click', function () { ask('ask', f); });
          thinking.appendChild(document.createElement('br'));
          thinking.appendChild(b);
        });
      }, function (err) {
        thinking.className = 'ai-msg error';
        thinking.textContent = err.message;
      })
      .then(function () { chatForm.querySelectorAll('button').forEach(function (b) { b.disabled = false; }); });
  }
  chatForm.addEventListener('submit', function (e) { e.preventDefault(); ask('ask'); });
  panel.querySelectorAll('[data-ai-preset]').forEach(function (b) {
    b.addEventListener('click', function () {
      var mode = b.getAttribute('data-ai-preset');
      ask(mode, mode === 'explain' ? __('Explain the key relationships in my map.') : __('What alternative approaches could reach the same outcome?'));
    });
  });

  // Load recent conversation history once the panel opens.
  var loaded = false;
  panel.addEventListener('show.bs.offcanvas', function () {
    if (loaded) return;
    loaded = true;
    IP.api('/projects/' + projectId + '/ai/conversations').then(function (res) {
      res.items.slice().reverse().forEach(function (c) {
        addMsg(c.prompt, 'user');
        if (c.status === 'succeeded') addMsg(c.answer, 'bot'); else addMsg(__('Failed: {reason}', { reason: __(c.error) }), 'error');
      });
    }).catch(function () {});
  });
})();
