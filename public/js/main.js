/* Site-wide behaviour: icons, confirm dialogs, CSRF-aware fetch helper, auto-submit filters. */
(function () {
  'use strict';

  var strings = {};
  try {
    var el = document.getElementById('i18n-strings');
    strings = el ? JSON.parse(el.textContent || '{}') : {};
  } catch (e) { strings = {}; }

  function fill(s, vars) {
    return vars ? s.replace(/\{(\w+)\}/g, function (m, k) { return k in vars ? String(vars[k]) : m; }) : s;
  }

  // Keys with {placeholders} also match finished English sentences (e.g. server error messages).
  var patterns = Object.keys(strings).filter(function (k) { return /\{\w+\}/.test(k) && k.replace(/\{\w+\}/g, '').trim().length >= 8; }).map(function (k) {
    var names = [];
    var source = k.split(/(\{\w+\})/).map(function (part) {
      var m = /^\{(\w+)\}$/.exec(part);
      if (!m) return part.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&');
      names.push(m[1]);
      return '([\\s\\S]+?)';
    }).join('');
    return { re: new RegExp('^' + source + '$'), names: names, template: strings[k] };
  });

  /** Translates an English UI string; {name} placeholders are filled from vars. */
  function __(text, vars) {
    var s = String(text);
    if (Object.prototype.hasOwnProperty.call(strings, s)) return fill(strings[s], vars);
    if (!vars) {
      for (var i = 0; i < patterns.length; i++) {
        var m = patterns[i].re.exec(s);
        if (m) {
          var v = {};
          patterns[i].names.forEach(function (n, j) { v[n] = n === 'fields'
            ? m[j + 1].split(', ').map(function (k) { return strings['field:' + k] || k; }).join('، ')
            : /^(summary|reason|message|detail|field|type|from|to|rel|status)$/.test(n) ? __(m[j + 1]) : m[j + 1]; });
          return fill(patterns[i].template, v);
        }
      }
    }
    return fill(s, vars);
  }

  function csrfToken() {
    var meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute('content') : '';
  }

  /** JSON fetch with CSRF header; rejects with a readable message on HTTP errors. */
  function api(url, options) {
    options = options || {};
    var headers = Object.assign({ Accept: 'application/json', 'X-CSRF-Token': csrfToken() }, options.headers || {});
    var body = options.body;
    if (body !== undefined && typeof body !== 'string') {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    return fetch(url, { method: options.method || 'GET', headers: headers, body: body, credentials: 'same-origin' })
      .then(function (res) {
        return res.text().then(function (text) {
          var data = {};
          try { data = text ? JSON.parse(text) : {}; } catch (e) { data = {}; }
          if (res.status === 401) {
            window.location.href = '/login';
            throw new Error(__('Your session has expired. Please log in again.'));
          }
          if (!res.ok) {
            var err = new Error(data.error ? __(data.error) : __('Request failed ({status})', { status: res.status }));
            err.status = res.status;
            err.errors = data.errors;
            throw err;
          }
          return data;
        });
      });
  }

  function refreshIcons(root) {
    if (window.lucide) window.lucide.createIcons({ attrs: { 'aria-hidden': 'true' }, root: root || document });
  }

  function toast(message, tone) {
    var container = document.querySelector('[data-toast-container]');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container position-fixed bottom-0 end-0 p-3';
      container.setAttribute('data-toast-container', '');
      document.body.appendChild(container);
    }
    var el = document.createElement('div');
    el.className = 'toast align-items-center border-0 text-bg-' + (tone || 'dark');
    el.setAttribute('role', tone === 'danger' ? 'alert' : 'status');
    el.setAttribute('aria-live', 'polite');
    var wrap = document.createElement('div');
    wrap.className = 'd-flex';
    var body = document.createElement('div');
    body.className = 'toast-body';
    body.textContent = message;
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn-close btn-close-white me-2 m-auto';
    close.setAttribute('data-bs-dismiss', 'toast');
    close.setAttribute('aria-label', __('Close'));
    wrap.appendChild(body);
    wrap.appendChild(close);
    el.appendChild(wrap);
    container.appendChild(el);
    var t = new window.bootstrap.Toast(el, { delay: tone === 'danger' ? 7000 : 3500 });
    el.addEventListener('hidden.bs.toast', function () { el.remove(); });
    t.show();
  }

  // Confirmation modal: <button data-confirm="message" data-confirm-form="#formId">
  function setupConfirm() {
    var modalEl = document.getElementById('confirmModal');
    if (!modalEl) return;
    var modal = new window.bootstrap.Modal(modalEl);
    var pending = null;
    document.addEventListener('click', function (e) {
      var trigger = e.target.closest('[data-confirm]');
      if (!trigger) return;
      e.preventDefault();
      modalEl.querySelector('[data-confirm-message]').textContent = trigger.getAttribute('data-confirm');
      var accept = modalEl.querySelector('[data-confirm-accept]');
      accept.textContent = trigger.getAttribute('data-confirm-label') || __('Confirm');
      accept.className = 'btn ' + (trigger.getAttribute('data-confirm-tone') === 'primary' ? 'btn-primary' : 'btn-danger');
      pending = trigger;
      modal.show();
    });
    modalEl.querySelector('[data-confirm-accept]').addEventListener('click', function () {
      if (!pending) return;
      var selector = pending.getAttribute('data-confirm-form');
      var form = selector ? document.querySelector(selector) : pending.closest('form');
      var handler = pending.__confirmHandler;
      modal.hide();
      if (handler) handler();
      else if (form) form.submit();
      pending = null;
    });
  }

  function setupAutosubmit() {
    document.querySelectorAll('[data-autosubmit]').forEach(function (el) {
      el.addEventListener('change', function () { if (el.form) el.form.submit(); });
    });
  }

  // Prevent double-submits on regular forms.
  function setupSubmitGuard() {
    document.addEventListener('submit', function (e) {
      var form = e.target;
      if (form.hasAttribute('data-no-guard')) return;
      if (form.dataset.submitting === '1') { e.preventDefault(); return; }
      form.dataset.submitting = '1';
      setTimeout(function () { form.dataset.submitting = '0'; }, 4000);
    });
  }

  window.IdeaPilot = { api: api, csrfToken: csrfToken, refreshIcons: refreshIcons, toast: toast, __: __, lang: document.documentElement.lang || 'en' };

  document.addEventListener('DOMContentLoaded', function () {
    refreshIcons();
    setupConfirm();
    setupAutosubmit();
    setupSubmitGuard();
  });
})();
