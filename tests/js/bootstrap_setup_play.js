(function () {
  'use strict';
  function FakeClassList() { this.items = []; }
  FakeClassList.prototype.add = function (v) { if (this.items.indexOf(v) < 0) this.items.push(v); };
  FakeClassList.prototype.remove = function (v) { var i = this.items.indexOf(v); if (i >= 0) this.items.splice(i, 1); };
  FakeClassList.prototype.contains = function (v) { return this.items.indexOf(v) >= 0; };

  function FakeElement(id, className) {
    this.id = id || '';
    this.className = className || '';
    this.attrs = {};
    this.children = [];
    this.listeners = {};
    this.textContent = '';
    this.value = '';
    this.disabled = false;
    this.hidden = false;
    this.parentNode = null;
    this.nodeType = 1;
    this.style = { setProperty: function (name, value) { this[name] = String(value); } };
    this.classList = new FakeClassList();
    var self = this;
    String(this.className).split(/\s+/).forEach(function (v) { if (v) self.classList.add(v); });
  }
  Object.defineProperty(FakeElement.prototype, 'firstChild', { get: function () { return this.children[0] || null; } });
  FakeElement.prototype.setAttribute = function (n, v) { this.attrs[n] = String(v); };
  FakeElement.prototype.getAttribute = function (n) { return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null; };
  FakeElement.prototype.removeAttribute = function (n) { delete this.attrs[n]; };
  FakeElement.prototype.hasAttribute = function (n) { return Object.prototype.hasOwnProperty.call(this.attrs, n); };
  FakeElement.prototype.appendChild = function (node) {
    if (node && node.__fragment) node = node.root;
    node.parentNode = this;
    this.children.push(node);
    return node;
  };
  FakeElement.prototype.removeChild = function (node) {
    var i = this.children.indexOf(node);
    if (i >= 0) this.children.splice(i, 1);
    node.parentNode = null;
    return node;
  };
  FakeElement.prototype.addEventListener = function (n, fn) {
    (this.listeners[n] || (this.listeners[n] = [])).push(fn);
  };
  FakeElement.prototype.fire = function (n, event) {
    (this.listeners[n] || []).slice().forEach(function (fn) { fn(event || {}); });
  };
  FakeElement.prototype.querySelector = function (selector) {
    var cls = selector.charAt(0) === '.' ? selector.slice(1).split(/[\\[: ]/)[0] : '';
    for (var i = 0; i < this.children.length; i++) {
      var node = this.children[i];
      if (selector.charAt(0) === '#' && node.id === selector.slice(1)) return node;
      if (cls && node.classList.contains(cls)) return node;
    }
    return null;
  };
  FakeElement.prototype.querySelectorAll = function (selector) {
    if (selector === '.bq5-option') return this.children.filter(function (n) { return n.classList.contains('bq5-option'); });
    if (selector === '[role="radio"]') return this.children.filter(function (n) { return n.getAttribute('role') === 'radio'; });
    return [];
  };
  FakeElement.prototype.closest = function (selector) {
    if (selector.indexOf('.bq5-option') >= 0 && this.classList.contains('bq5-option')) return this;
    if (selector.indexOf('[role="radio"]') >= 0 && this.getAttribute('role') === 'radio') return this;
    return null;
  };
  FakeElement.prototype.click = function () { this.fire('click', { target: this, preventDefault: function () {} }); };
  FakeElement.prototype.focus = function () { this.focused = true; };

  var registry = {};
  function getElement(selector) {
    var key = selector.replace(/^#/, '');
    if (!registry[key]) registry[key] = new FakeElement(key);
    return registry[key];
  }
  var ids = [
    'setup-modes', 'setup-themes', 'setup-tiers', 'setup-mode-hint', 'setup-tier-hint',
    'setup-count-value', 'setup-count-hint', 'setup-count-dec', 'setup-count-inc',
    'setup-start', 'setup-rules', 'setup-lead', 'bq5-back',
    'play-index', 'play-total', 'play-score', 'play-progress', 'play-timer', 'play-time-left',
    'play-tag-theme', 'play-tag-region', 'play-tag-diff', 'play-question', 'play-feedback',
    'play-feedback-title', 'play-feedback-points', 'play-feedback-text', 'play-live',
    'play-next', 'play-cast', 'play-bubble', 'screen-play'
  ];
  ids.forEach(function (id) { getElement('#' + id); });
  var optionsRoot = getElement('#play-options');
  for (var i = 0; i < 4; i++) {
    var button = new FakeElement('option-' + i, 'bq5-option');
    button.setAttribute('data-index', i);
    button.appendChild(new FakeElement('option-text-' + i, 'bq5-option__text'));
    optionsRoot.appendChild(button);
  }

  var eventMap = {}, actionMap = {}, currentScreen = 'boot', lastModal = null, reduced = false;
  var api = {
    el: getElement,
    all: function (selector, scope) { return scope && scope.querySelectorAll ? scope.querySelectorAll(selector) : []; },
    text: function (selector, value) { var n = getElement(selector); n.textContent = value == null ? '' : String(value); return n; },
    hidden: function (selector, value) { var n = getElement(selector); n.hidden = !!value; return n; },
    cloneTemplate: function (name) {
      if (name !== 'tpl-choice') return null;
      var root = new FakeElement('choice', 'bq5-choice');
      root.setAttribute('role', 'radio');
      root.appendChild(new FakeElement('', 'bq5-choice__label'));
      root.appendChild(new FakeElement('', 'bq5-choice__hint'));
      return { __fragment: true, root: root, querySelector: function (selector) { return selector === '.bq5-choice' ? root : null; } };
    },
    on: function (name, fn) { (eventMap[name] || (eventMap[name] = [])).push(fn); return function () {}; },
    emit: function (name, detail) { var a = (eventMap[name] || []).slice(); a.forEach(function (fn) { fn(detail || {}); }); return a.length; },
    onAction: function (name, fn) { (actionMap[name] || (actionMap[name] = [])).push(fn); return function () {}; },
    showScreen: function (name) { var prev = currentScreen; currentScreen = name; api.emit('screen:change', { from: prev, to: name }); return { ok: true, screen: name }; },
    currentScreen: function () { return currentScreen; },
    toast: function (message, kind) { api.lastToast = { message: message, kind: kind }; return true; },
    openModal: function (options) { lastModal = options; return { ok: true }; },
    closeModal: function () { lastModal = null; return true; },
    isReducedMotion: function () { return reduced; },
    setReducedMotion: function (v) { reduced = !!v; return true; },
    emitAction: function (name, detail) { (actionMap[name] || []).slice().forEach(function (fn) { fn(detail || {}); }); }
  };

  globalThis.document = { createElement: function (tag) { return new FakeElement('created-' + tag); } };
  globalThis.setTimeout = function (fn) { fn(); return 0; };
  globalThis.__m9Timers = {};
  globalThis.__m9NextTimer = 1;
  globalThis.setInterval = function (fn) { var id = globalThis.__m9NextTimer++; globalThis.__m9Timers[id] = fn; return id; };
  globalThis.clearInterval = function (id) { delete globalThis.__m9Timers[id]; };
  globalThis.__m9Now = 100000;
  globalThis.__m9LastModal = function () { return lastModal; };
  globalThis.__m9CurrentScreen = function () { return currentScreen; };
  globalThis.__m9OptionsRoot = optionsRoot;
  globalThis.__m9UI = api;
  globalThis.BQ5 = globalThis.BQ5 || {};
  globalThis.BQ5.ui = api;
  globalThis.BQ5.config.tiers.geografo = [4];
  globalThis.BQ5.config.tierLabels.geografo = 'Geógrafo';
  globalThis.BQ5.config.pointsBase[4] = 80;
  globalThis.BQ5.engine.setClock(function () { return globalThis.__m9Now; });

  var questions = [], id = 1, diff, j;
  for (diff = 1; diff <= 4; diff++) {
    for (j = 0; j < 8; j++) {
      var theme = j < 5 ? 'cultura' : 'economia';
      questions.push({
        id: id++, theme: theme, region: 'norte', difficulty: diff,
        question: 'Questão ' + id + ' de teste',
        options: ['Opção A ' + id, 'Opção B ' + id, 'Opção C ' + id, 'Opção D ' + id],
        answer: 0, explanation: 'Explicação ' + id
      });
    }
  }
  var adopted = globalThis.BQ5.bank.adopt({ version: 1, source: 'fixture-m9-m10', questions: questions });
  if (!adopted.ok) throw new Error('fixture bank rejeitado: ' + adopted.errors.join('; '));
})();
