/* ============================================================
 * Bootstrap do runner V8 do MÓDULO 11 (tests/run_results_v8.py)
 * Adaptador DOM mínimo para js/screens/results.js (+ setup/play reais),
 * no mesmo espírito do bootstrap_setup_play.js. Adiciona os templates
 * tpl-review-item / tpl-ranking-item exigidos pelo Módulo 11.
 * Relógio determinístico (__r11Now) e banco sintético fixo (32 questões).
 * JavaScript clássico, sem async/await.
 * ============================================================ */
(function () {
  'use strict';

  function FakeClassList() { this.items = []; }
  FakeClassList.prototype.add = function (v) { if (this.items.indexOf(v) < 0) this.items.push(v); };
  FakeClassList.prototype.remove = function (v) { var i = this.items.indexOf(v); if (i >= 0) this.items.splice(i, 1); };
  FakeClassList.prototype.contains = function (v) { return this.items.indexOf(v) >= 0; };

  function nodeMatches(node, selector) {
    if (!node || !selector) return false;
    if (selector.charAt(0) === '#' && node.id === selector.slice(1)) return true;
    var data = selector.match(/^\[([\w-]+)="?([^"'\]]+)"?\]$/);
    if (data && node.getAttribute(data[1]) === data[2]) return true;
    if (selector.charAt(0) === '.') {
      var cls = selector.slice(1).split(/[\\[: ]/)[0];
      return node.classList.contains(cls);
    }
    return false;
  }

  function FakeElement(id, className) {
    this.id = id || '';
    this.attrs = {};
    this.children = [];
    this.parentNode = null;
    this.textContent = '';
    this.value = '';
    this.disabled = false;
    this.hidden = false;
    this.nodeType = 1;
    this.style = { setProperty: function (name, value) { this[name] = String(value); } };
    this.classList = new FakeClassList();
    var self = this;
    if (className) {
      this._cls = String(className);
      String(this._cls).split(/\s+/).forEach(function (v) { if (v) self.classList.add(v); });
    } else { this._cls = ''; }
  }
  Object.defineProperty(FakeElement.prototype, 'className', {
    get: function () { return this._cls || ''; },
    set: function (v) {
      this._cls = String(v == null ? '' : v);
      var self = this;
      this.classList = new FakeClassList();
      this._cls.split(/\s+/).forEach(function (c) { if (c) self.classList.add(c); });
    }
  });
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
  FakeElement.prototype.addEventListener = function () {};
  FakeElement.prototype.fire = function (n, event) {
    var self = this;
    Object.keys(self.__listeners || {}).forEach(function (name) { if (name === n) self.__listeners[name].slice().forEach(function (fn) { fn(event || {}); }); });
  };
  // play.js registra o clique das alternativas via addEventListener; suportamos de fato:
  FakeElement.prototype.addEventListener = function (n, fn) {
    (this.__listeners || (this.__listeners = {}));
    var map = this.__listeners;
    (map[n] || (map[n] = [])).push(fn);
  };
  FakeElement.prototype.click = function () { this.fire('click', { target: this, preventDefault: function () {} }); };
  FakeElement.prototype.focus = function () { this.focused = true; };
  FakeElement.prototype.querySelector = function (selector) {
    var self = this;
    function walk(node) {
      for (var i = 0; i < node.children.length; i++) {
        if (nodeMatches(node.children[i], selector)) return node.children[i];
        var nested = walk(node.children[i]);
        if (nested) return nested;
      }
      return null;
    }
    return walk(self);
  };
  FakeElement.prototype.querySelectorAll = function (selector) {
    var out = [];
    for (var i = 0; i < this.children.length; i++) if (nodeMatches(this.children[i], selector)) out.push(this.children[i]);
    return out;
  };
  FakeElement.prototype.closest = function (selector) {
    if (this.classList && nodeMatches(this, selector)) return this;
    var parent = this.parentNode;
    while (parent) { if (nodeMatches(parent, selector)) return parent; parent = parent.parentNode; }
    return null;
  };

  var registry = {};
  function getElement(selector) {
    var key = String(selector).replace(/^#/, '');
    if (!registry[key]) registry[key] = new FakeElement(key);
    return registry[key];
  }

  // Templates do Módulo 11 (revisão e ranking)
  function fragmentOf(root) {
    return { __fragment: true, root: root, querySelector: function (sel) {
      var m = root.querySelector(sel);
      if (m) return m;
      if (sel.charAt(0) === '.' && root.classList.contains(sel.slice(1))) return root;
      return null; } };
  }
  function makeReviewTemplate() {
    var article = new FakeElement('', 'bq5-review');
    article.appendChild(new FakeElement('', 'bq5-review__q'));
    var chosen = new FakeElement(''); chosen.setAttribute('data-role', 'chosen'); article.appendChild(chosen);
    var correct = new FakeElement(''); correct.setAttribute('data-role', 'correct'); article.appendChild(correct);
    article.appendChild(new FakeElement('', 'bq5-review__expl'));
    return fragmentOf(article);
  }
  function makeRankingTemplate() {
    var item = new FakeElement('', 'bq5-ranking__item');
    item.appendChild(new FakeElement('', 'bq5-ranking__pos'));
    item.appendChild(new FakeElement('', 'bq5-ranking__name'));
    item.appendChild(new FakeElement('', 'bq5-ranking__score'));
    return fragmentOf(item);
  }
  function makeChoiceTemplate() {
    var root = new FakeElement('choice', 'bq5-choice');
    root.setAttribute('role', 'radio');
    root.appendChild(new FakeElement('', 'bq5-choice__label'));
    root.appendChild(new FakeElement('', 'bq5-choice__hint'));
    return fragmentOf(root);
  }

  var eventMap = {}, actionMap = {}, currentScreen = 'boot', lastModal = null, reduced = false;
  var api = {
    el: getElement,
    all: function (selector, scope) { return scope && scope.querySelectorAll ? scope.querySelectorAll(selector) : []; },
    text: function (selector, value) { var n = getElement(selector); n.textContent = value == null ? '' : String(value); return n; },
    hidden: function (selector, value) { var n = getElement(selector); n.hidden = !!value; return n; },
    cloneTemplate: function (name) {
      if (name === 'tpl-choice') return makeChoiceTemplate();
      if (name === 'tpl-review-item') return makeReviewTemplate();
      if (name === 'tpl-ranking-item') return makeRankingTemplate();
      return null;
    },
    on: function (name, fn) {
      var list = eventMap[name] || (eventMap[name] = []);
      list.push(fn);
      return function () { var i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); };
    },
    emit: function (name, detail) { var a = (eventMap[name] || []).slice(); a.forEach(function (fn) { fn(detail || {}); }); return a.length; },
    onAction: function (name, fn) { (actionMap[name] || (actionMap[name] = [])).push(fn); return function () {}; },
    emitAction: function (name, detail) { (actionMap[name] || []).slice().forEach(function (fn) { fn(detail || {}); }); },
    showScreen: function (name) { var prev = currentScreen; currentScreen = name; api.emit('screen:change', { from: prev, to: name }); return { ok: true, screen: name }; },
    currentScreen: function () { return currentScreen; },
    toast: function (message, kind) { api.lastToast = { message: message, kind: kind }; return true; },
    openModal: function (options) { lastModal = options; return { ok: true }; },
    closeModal: function () { lastModal = null; return true; },
    isReducedMotion: function () { return reduced; },
    setReducedMotion: function (v) { reduced = !!v; return true; }
  };

  globalThis.document = { createElement: function (tag) { return new FakeElement('created-' + tag); } };
  // Timers visuais: setTimeout executa na hora; setInterval fica registrado em __r11Timers.
  globalThis.setTimeout = function (fn) { if (typeof fn === 'function') fn(); return 0; };
  globalThis.__r11Timers = {};
  globalThis.__r11NextTimer = 1;
  globalThis.setInterval = function (fn) { var id = globalThis.__r11NextTimer++; globalThis.__r11Timers[id] = fn; return id; };
  globalThis.clearInterval = function (id) { delete globalThis.__r11Timers[id]; };

  // Relógio determinístico do engine (mesmo padrão da suíte M9–M10)
  globalThis.__r11Now = 100000;
  BQ5.engine.setClock(function () { return globalThis.__r11Now; });

  // Banco sintético determinístico: 32 questões (4 dificuldades x 8),
  // temas cultura/economia, região norte — mesmo formato do fixture M9–M10.
  var questions = [], id = 1;
  for (var diff = 1; diff <= 4; diff++) {
    for (var j = 0; j < 8; j++) {
      questions.push({
        id: id, theme: (j < 5 ? 'cultura' : 'economia'), region: 'norte', difficulty: diff,
        question: 'Quest\u00e3o ' + id + ' de teste',
        options: ['Op\u00e7\u00e3o A ' + id, 'Op\u00e7\u00e3o B ' + id, 'Op\u00e7\u00e3o C ' + id, 'Op\u00e7\u00e3o D ' + id],
        answer: 0, explanation: 'Explica\u00e7\u00e3o ' + id
      });
      id++;
    }
  }
  var adopted = BQ5.bank.adopt({ version: 1, source: 'fixture-m11-results', questions: questions });
  if (!adopted.ok) throw new Error('fixture bank rejeitado: ' + (adopted.errors || []).join('; '));

  // Raiz das alternativas da tela de jogo (4 bot\u00f5es .bq5-option)
  var optionsRoot = getElement('#play-options');
  for (var i = 0; i < 4; i++) {
    var button = new FakeElement('option-' + i, 'bq5-option');
    button.setAttribute('data-index', String(i));
    button.appendChild(new FakeElement('option-text-' + i, 'bq5-option__text'));
    optionsRoot.appendChild(button);
  }

  globalThis.__r11UI = api;
  globalThis.__r11OptionsRoot = optionsRoot;
  globalThis.__r11CurrentScreen = function () { return currentScreen; };
  globalThis.__r11LastModal = function () { return lastModal; };
  BQ5.ui = api;
})();