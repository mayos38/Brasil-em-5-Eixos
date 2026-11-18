'use strict';
/*
 * Testes de integração dos Módulos 9 e 10 em Node/V8.
 * Usa os módulos de domínio reais e um adaptador DOM mínimo para os contratos
 * usados pela UI. Não substitui validação visual/funcional em navegador.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');

class FakeClassList {
  constructor() { this.items = new Set(); }
  add(value) { this.items.add(value); }
  remove(value) { this.items.delete(value); }
  contains(value) { return this.items.has(value); }
}

class FakeElement {
  constructor(id, className) {
    this.id = id || '';
    this.className = className || '';
    this.attrs = Object.create(null);
    this.children = [];
    this.listeners = Object.create(null);
    this.textContent = '';
    this.value = '';
    this.disabled = false;
    this.hidden = false;
    this.parentNode = null;
    this.nodeType = 1;
    this.style = { setProperty(name, value) { this[name] = String(value); } };
    this.classList = new FakeClassList();
    String(this.className).split(/\s+/).filter(Boolean).forEach(c => this.classList.add(c));
  }
  get firstChild() { return this.children[0] || null; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; }
  removeAttribute(name) { delete this.attrs[name]; }
  hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name); }
  appendChild(child) {
    if (child && child.__fragment) {
      const node = child.root;
      node.parentNode = this;
      this.children.push(node);
      return node;
    }
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }
  addEventListener(name, fn) {
    (this.listeners[name] || (this.listeners[name] = [])).push(fn);
  }
  fire(name, event) { (this.listeners[name] || []).forEach(fn => fn(event || {})); }
  querySelector(selector) {
    if (selector[0] === '#') return this.children.find(n => n.id === selector.slice(1)) || null;
    if (selector[0] === '.') return this.children.find(n => n.classList.contains(selector.slice(1).split(/[\[: ]/)[0])) || null;
    if (selector === '[data-art]') return this.children.find(n => n.hasAttribute('data-art')) || null;
    return null;
  }
  querySelectorAll(selector) {
    if (selector === '.bq5-option') return this.children.filter(n => n.classList.contains('bq5-option'));
    if (selector === '[role="radio"]') return this.children.filter(n => n.getAttribute('role') === 'radio');
    return [];
  }
  closest(selector) {
    if (selector.indexOf('.bq5-option') >= 0 && this.classList.contains('bq5-option')) return this;
    if (selector.indexOf('[role="radio"]') >= 0 && this.getAttribute('role') === 'radio') return this;
    return null;
  }
  click() { this.fire('click', { target: this, preventDefault() {} }); }
  focus() { this.focused = true; }
}

const registry = Object.create(null);
function el(selector) {
  const key = selector.replace(/^#/, '');
  if (!registry[key]) registry[key] = new FakeElement(key);
  return registry[key];
}

// Campos usados pelo setup.
[
  'setup-modes', 'setup-themes', 'setup-tiers', 'setup-mode-hint', 'setup-tier-hint',
  'setup-count-value', 'setup-count-hint', 'setup-count-dec', 'setup-count-inc',
  'setup-start', 'setup-rules', 'setup-lead', 'bq5-back'
].forEach(el);

// Campos usados pela partida.
[
  'play-index', 'play-total', 'play-score', 'play-progress', 'play-timer', 'play-time-left',
  'play-tag-theme', 'play-tag-region', 'play-tag-diff', 'play-question', 'play-feedback',
  'play-feedback-title', 'play-feedback-points', 'play-feedback-text', 'play-live',
  'play-next', 'play-cast', 'play-bubble', 'screen-play'
].forEach(el);
const optionsRoot = el('#play-options');
for (let i = 0; i < 4; i++) {
  const button = new FakeElement('option-' + i, 'bq5-option');
  button.setAttribute('data-index', String(i));
  const text = new FakeElement('option-text-' + i, 'bq5-option__text');
  button.appendChild(text);
  optionsRoot.appendChild(button);
}

const events = Object.create(null);
const actions = Object.create(null);
let currentScreen = 'boot';
let lastModal = null;
let reducedMotion = false;
const api = {
  el,
  all(selector, scope) { return scope && typeof scope.querySelectorAll === 'function' ? scope.querySelectorAll(selector) : []; },
  text(selector, value) { const node = el(selector); node.textContent = value == null ? '' : String(value); return node; },
  hidden(selector, value) { const node = el(selector); node.hidden = !!value; return node; },
  cloneTemplate(name) {
    if (name !== 'tpl-choice') return null;
    const rootNode = new FakeElement('choice', 'bq5-choice');
    rootNode.setAttribute('role', 'radio');
    rootNode.appendChild(new FakeElement('', 'bq5-choice__label'));
    rootNode.appendChild(new FakeElement('', 'bq5-choice__hint'));
    return { __fragment: true, root: rootNode, querySelector(selector) { return selector === '.bq5-choice' ? rootNode : null; } };
  },
  on(name, fn) {
    (events[name] || (events[name] = [])).push(fn);
    return () => { const a = events[name] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); };
  },
  emit(name, detail) { const a = (events[name] || []).slice(); a.forEach(fn => fn(detail || {})); return a.length; },
  onAction(name, fn) { (actions[name] || (actions[name] = [])).push(fn); return () => {}; },
  showScreen(name) {
    const prev = currentScreen;
    currentScreen = name;
    this.emit('screen:change', { from: prev, to: name });
    return { ok: true, screen: name };
  },
  currentScreen() { return currentScreen; },
  toast(message, kind) { this.lastToast = { message, kind }; return true; },
  openModal(options) { lastModal = options; return { ok: true }; },
  closeModal() { lastModal = null; return true; },
  isReducedMotion() { return reducedMotion; },
  setReducedMotion(value) { reducedMotion = !!value; return true; }
};
api.emitAction = function (name, detail) { (actions[name] || []).slice().forEach(fn => fn(detail || {})); };

let now = 100000;
let nextTimer = 1;
const timers = new Map();
const sandbox = {
  console,
  document: { createElement(tag) { return new FakeElement('created-' + tag); } },
  localStorage: {
    data: Object.create(null),
    getItem(k) { return Object.prototype.hasOwnProperty.call(this.data, k) ? this.data[k] : null; },
    setItem(k, v) { this.data[k] = String(v); },
    removeItem(k) { delete this.data[k]; }
  },
  setInterval(fn) { const id = nextTimer++; timers.set(id, fn); return id; },
  clearInterval(id) { timers.delete(id); },
  setTimeout,
  Date,
  Math,
  JSON,
  Promise
};
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
sandbox.BQ5 = { ui: api };
vm.createContext(sandbox);
function load(rel) {
  const file = path.join(root, rel);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
}

// Carrega as APIs reais de domínio do checkpoint recuperado.
['config.js', 'util.js', 'storage.js', 'bank.js', 'engine.js'].forEach(f => load(path.join('brasil-quiz/js', f)));
sandbox.BQ5.ui = api;
// Simula uma configuração 5.6: tier Geógrafo e pontos de dificuldade 4.
sandbox.BQ5.config.tiers.geografo = [4];
sandbox.BQ5.config.tierLabels.geografo = 'Geógrafo';
sandbox.BQ5.config.pointsBase[4] = 80;
sandbox.BQ5.engine.setClock(() => now);
const questions = [];
let id = 1;
for (let difficulty = 1; difficulty <= 4; difficulty++) {
  for (let i = 0; i < 8; i++) {
    const theme = i < 5 ? 'cultura' : 'economia';
    questions.push({
      id: id++, theme, region: 'norte', difficulty,
      question: 'Questão ' + id + ' de teste',
      options: ['Opção A ' + id, 'Opção B ' + id, 'Opção C ' + id, 'Opção D ' + id],
      answer: 0,
      explanation: 'Explicação ' + id
    });
  }
}
const adopted = sandbox.BQ5.bank.adopt({ version: 1, source: 'fixture-m9-m10', questions });
if (!adopted.ok) throw new Error('fixture bank rejeitado: ' + adopted.errors.join('; '));

// Carrega os módulos de tela reais.
load('brasil-quiz/js/screens/setup.js');
load('brasil-quiz/js/screens/play.js');
const BQ5 = sandbox.BQ5;
const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (error) { results.push({ name, ok: false, error: error.message || String(error) }); }
}
function assert(condition, message) { if (!condition) throw new Error(message || 'assertion failed'); }

// O menu publica intenção; o setup deve recebê-la e abrir a tela de configuração.
test('a intenção Solo abre o módulo 9', () => {
  api.emit('intent:solo', { source: 'menu' });
  assert(currentScreen === 'setup', 'tela setup não abriu');
  assert(BQ5.screens.setup.state().mode === 'solo', 'modalidade inicial não é solo');
});

test('eixos, dificuldade Geógrafo e modalidade futura são tratados dinamicamente', () => {
  const before = BQ5.screens.setup.state();
  assert(before.maxCount > 0, 'não calculou disponibilidade inicial');
  assert(BQ5.screens.setup.select('diff', 'geografo') === true, 'não selecionou chave de dificuldade nova');
  assert(BQ5.screens.setup.select('theme', 'cultura') === true, 'não selecionou eixo Cultura');
  assert(BQ5.screens.setup.select('mode', 'campaign') === false, 'modalidade futura foi habilitada indevidamente');
  const state = BQ5.screens.setup.state();
  assert(state.diff === 'geografo' && state.theme === 'cultura', 'configuração não foi preservada');
  assert(state.maxCount === 5, 'limite não acompanhou o pool disponível do eixo');
  assert(state.count <= state.maxCount, 'quantidade excede disponibilidade');
  assert(el('#setup-rules').textContent.indexOf('Não existe pausa') >= 0, 'regra de ausência de pausa não está clara');
});

test('bloqueia config M5.6 quando o engine carregado não oferece timeLimitMs', () => {
  const previous = BQ5.config.questionTimeMs;
  BQ5.config.questionTimeMs = { edu: 30000, normal: 20000, medio: 18000, dificil: 17000, geografo: 20000 };
  const result = BQ5.screens.setup.start();
  assert(result && result.code === 'ENGINE_TIMER_VERSION_MISMATCH', 'deveria sinalizar incompatibilidade de versão');
  assert(BQ5.engine.state() === null, 'partida incompatível não foi descartada');
  BQ5.config.questionTimeMs = previous;
});

test('início da partida usa o engine real e abre a tela de jogo', () => {
  BQ5.screens.setup.changeCount(-1);
  const started = BQ5.screens.setup.start();
  assert(started.ok, 'engine.start falhou');
  assert(currentScreen === 'play', 'tela play não abriu');
  assert(BQ5.engine.state() && BQ5.engine.state().mode === 'solo', 'engine não iniciou solo');
  assert(el('#play-question').textContent.indexOf('Questão') === 0, 'enunciado não foi apresentado');
  assert(el('#play-index').textContent === '1', 'indicador da primeira questão incorreto');
  assert(el('#play-total').textContent === '4', 'quantidade inicial não refletiu config');
  assert(BQ5.screens.play.state().stage === 'choosing', 'estado inicial não é choosing');
});

test('seleção e confirmação travam respostas e exibem pontos/feedback', () => {
  let sounds = 0;
  const offSound = api.on('sfx:play', detail => { if (detail.cue === 'correct') sounds++; });
  const q = BQ5.engine.question();
  const option = optionsRoot.children[q.a];
  optionsRoot.fire('click', { target: option });
  assert(BQ5.screens.play.state().selectedChoice === q.a, 'opção não foi selecionada');
  assert(el('#play-next').disabled === false, 'confirmar não habilitou');
  api.emitAction('next', {});
  assert(BQ5.engine.state().locked === true, 'engine não travou a questão');
  assert(BQ5.screens.play.state().stage === 'revealed', 'estado não passou para revealed');
  assert(el('#play-feedback').hidden === false, 'feedback não apareceu');
  assert(el('#play-feedback').getAttribute('data-kind') === 'correct', 'feedback de acerto incorreto');
  assert(Number(BQ5.engine.state().score) > 0, 'pontuação não foi atualizada');
  assert(optionsRoot.children.every(node => node.disabled), 'alternativas não foram bloqueadas');
  assert(sounds === 1, 'evento de áudio futuro não foi emitido exatamente uma vez');
  offSound();
});

test('próxima pergunta renova a apresentação e o timeout é registrado uma única vez', () => {
  api.emitAction('next', {});
  assert(BQ5.engine.state().index === 1, 'não avançou para a segunda pergunta');
  assert(BQ5.screens.play.state().stage === 'choosing', 'nova pergunta não liberou seleção');
  now += 15000;
  const callback = Array.from(timers.values())[0];
  assert(typeof callback === 'function', 'timer visual não está ativo');
  callback();
  assert(BQ5.engine.state().locked === true, 'timeout não bloqueou questão');
  assert(el('#play-feedback').getAttribute('data-kind') === 'timeout', 'feedback de timeout não apareceu');
  assert(el('#play-feedback-title').textContent === 'Tempo esgotado!', 'título de timeout incorreto');
  assert(BQ5.engine.review().length === 2, 'timeout não foi registrado exatamente uma vez');
  callback();
  assert(BQ5.engine.review().length === 2, 'timeout duplicou a resposta');
});

test('estado de erro apresenta feedback e humor negativo', () => {
  api.emitAction('next', {});
  const q = BQ5.engine.question();
  const wrong = (q.a + 1) % 4;
  optionsRoot.fire('click', { target: optionsRoot.children[wrong] });
  api.emitAction('next', {});
  assert(el('#play-feedback').getAttribute('data-kind') === 'wrong', 'feedback de erro não apareceu');
  assert(el('#play-cast').getAttribute('data-mood') === 'sad', 'personagem não reagiu ao erro');
  assert(el('#play-feedback-points').textContent === '0 pontos', 'erro concedeu pontos');
});

test('sair abandona a partida e não há API ou fluxo de pausa', () => {
  assert(typeof BQ5.screens.play.pause === 'undefined', 'API pause não deve existir');
  assert(typeof BQ5.screens.play.resume === 'undefined', 'API resume não deve existir');
  assert(!actions['pause-game'] && !actions['resume-game'], 'ações de pausa não devem existir');
  api.emitAction('next', {}); // avança para uma nova pergunta ainda sem resposta
  assert(BQ5.screens.play.state().stage === 'choosing', 'precisava estar em uma pergunta ativa');
  api.emitAction('quit-game', {});
  assert(lastModal && typeof lastModal.onConfirm === 'function', 'confirmação de saída não abriu');
  assert(BQ5.screens.play.state().timerActive === true, 'abrir modal interrompeu/pausou o timer');
  lastModal.onConfirm();
  assert(BQ5.engine.state() === null, 'engine não descartou a partida ao sair');
  assert(currentScreen === 'menu', 'não retornou ao menu');
  assert(BQ5.screens.play.state().timerActive === false, 'timer ficou ativo após abandono');
});

const failed = results.filter(r => !r.ok);
console.log('--- Módulos 9–10: ' + (results.length - failed.length) + '/' + results.length + ' passaram ---');
results.forEach(r => console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : ' -> ' + r.error)));
console.log('RESULT: ' + (failed.length ? 'FAIL' : 'OK'));
if (failed.length) process.exitCode = 1;
