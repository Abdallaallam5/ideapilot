/* Workspace shell: inline project title/description editing and save status. */
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
})();
