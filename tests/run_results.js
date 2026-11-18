'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; process.stdout.write('PASS ' + name + '\n'); }
  catch (error) { failed++; process.stdout.write('FAIL ' + name + ': ' + error.message + '\n'); }
}
function assert(condition, message) { if (!condition) throw new Error(message || 'assertion failed'); }

class FakeNode {
  constructor(id = '', className = '') {
    this.id = id;
    this.className = className;
    this.attrs = {};
    this.children = [];
    this.parentNode = null;
    this.hidden = false;
    this.textContent = '';
    this.classList = { contains: cls => String(this.className).split(/\s+/).includes(cls) };
  }
  get firstChild() { return this.children[0] || null; }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  removeAttribute(name) { delete this.attrs[name]; }
  appendChild(node) {
    if (node && node.__fragment) node = node.root;
    node.parentNode = this;
    this.children.push(node);
    return node;
  }
  removeChild(node) {
    const index = this.children.indexOf(node);
    if (index >= 0) this.children.splice(index, 1);
    node.parentNode = null;
    return node;
  }
  querySelector(selector) {
    const match = node => {
      if (selector[0] === '.' && node.classList.contains(selector.slice(1))) return true;
      if (selector[0] === '#' && node.id === selector.slice(1)) return true;
      const data = selector.match(/^\[data-role=["']?([^\]"']+)["']?\]$/);
      if (data && node.getAttribute('data-role') === data[1]) return true;
      return false;
    };
    const walk = node => {
      for (const child of node.children) {
        if (match(child)) return child;
        const nested = walk(child);
        if (nested) return nested;
      }
      return null;
    };
    return walk(this);
  }
}

function fragment(root) {
  return { __fragment: true, root, querySelector: selector => root.querySelector(selector) || (selector[0] === '.' && root.classList.contains(selector.slice(1)) ? root : null) };
}
function makeReviewTemplate() {
  const article = new FakeNode('', 'bq5-review');
  article.appendChild(new FakeNode('', 'bq5-review__q'));
  const chosenLine = new FakeNode();
  const chosen = new FakeNode(); chosen.setAttribute('data-role', 'chosen'); chosenLine.appendChild(chosen); article.appendChild(chosenLine);
  const correctLine = new FakeNode();
  const correct = new FakeNode(); correct.setAttribute('data-role', 'correct'); correctLine.appendChild(correct); article.appendChild(correctLine);
  article.appendChild(new FakeNode('', 'bq5-review__expl'));
  return fragment(article);
}
function makeRankingTemplate() {
  const item = new FakeNode('', 'bq5-ranking__item');
  item.appendChild(new FakeNode('', 'bq5-ranking__pos'));
  item.appendChild(new FakeNode('', 'bq5-ranking__name'));
  item.appendChild(new FakeNode('', 'bq5-ranking__score'));
  return fragment(item);
}
function makeHarness() {
  const nodes = Object.create(null);
  const get = selector => {
    const id = String(selector).replace(/^#/, '');
    if (!nodes[id]) nodes[id] = new FakeNode(id);
    return nodes[id];
  };
  const handlers = Object.create(null);
  const actions = Object.create(null);
  const stored = Object.create(null);
  let screen = 'play';
  const ui = {
    el: get,
    text(selector, value) { const node = get(selector); node.textContent = value == null ? '' : String(value); return node; },
    hidden(selector, value) { const node = get(selector); node.hidden = !!value; return node; },
    cloneTemplate(name) {
      if (name === 'tpl-review-item') return makeReviewTemplate();
      if (name === 'tpl-ranking-item') return makeRankingTemplate();
      return null;
    },
    on(name, fn) { (handlers[name] || (handlers[name] = [])).push(fn); return () => {}; },
    emit(name, detail) { const list = (handlers[name] || []).slice(); list.forEach(fn => fn(detail || {})); return list.length; },
    onAction(name, fn) { (actions[name] || (actions[name] = [])).push(fn); return () => {}; },
    emitAction(name, detail) { (actions[name] || []).slice().forEach(fn => fn(detail || {})); },
    showScreen(name) { screen = name; return { ok: true, screen }; },
    currentScreen() { return screen; },
    toast(message, kind) { ui.lastToast = { message, kind }; return true; }
  };
  const storage = {
    getJSON(key, fallback) { return Object.prototype.hasOwnProperty.call(stored, key) ? JSON.parse(JSON.stringify(stored[key])) : fallback; },
    setJSON(key, value) { stored[key] = JSON.parse(JSON.stringify(value)); }
  };
  const document = { createElement(tag) { return new FakeNode('', tag); } };
  const sandbox = {
    console, Date, JSON, Math, Object, Array, String, Number, isFinite,
    document,
    BQ5: {
      ui,
      config: { themeLabels: { cultura: 'Cultura', economia: 'Economia' }, tierLabels: { geografo: 'Geógrafo' }, storageKeys: {} },
      storage,
      engine: { result: () => null, review: () => [], state: () => null },
      screens: { setup: { start() { sandbox.replayStarts++; return { ok: true }; } } }
    },
    replayStarts: 0
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../brasil-quiz/js/screens/results.js'), 'utf8'), sandbox, { filename: 'results.js' });
  return { sandbox, ui, nodes, stored, get screen() { return screen; } };
}

function sampleReview() {
  return [
    { q: { txt: 'Questão sobre o Brasil', o: ['Amazônia', 'Caatinga', 'Pampa', 'Cerrado'], a: 0, e: 'A Amazônia concentra grande biodiversidade.', t: 'cultura' }, choice: 0, ok: true },
    { q: { txt: 'Questão sobre a economia', o: ['A', 'B', 'C', 'D'], a: 2, e: 'Explicação econômica.', t: 'economia' }, choice: 1, ok: false },
    { q: { txt: 'Questão sem tempo', o: ['A', 'B', 'C', 'D'], a: 1, e: 'Explicação final.', t: 'cultura' }, choice: -1, ok: false }
  ];
}

const h = makeHarness();
const BQ5 = h.sandbox.BQ5;
const review = sampleReview();
let result = { mode: 'solo', score: 120, right: 1, total: 3, pct: 33, record: { prev: 80, best: 120 }, review };
BQ5.engine.result = () => result;
BQ5.engine.review = () => review;
BQ5.engine.state = () => ({ mode: result.mode, score: result.score, theme: 'all', diff: 'geografo' });
BQ5.ui.emit('game:started', {});

 test('resultado solo renderiza pontuação, acertos, erros e aproveitamento', function () {
  const shown = BQ5.screens.results.show(result);
  assert(shown.ok && h.screen === 'results', 'tela de resultados não abriu');
  assert(h.nodes['results-title'].textContent === 'Resultado da partida', 'título solo incorreto');
  assert(h.nodes['results-score'].textContent === '120', 'pontuação incorreta');
  assert(h.nodes['results-right'].textContent === '1', 'acertos incorretos');
  assert(h.nodes['results-errors'].textContent === '2', 'erros incorretos');
  assert(h.nodes['results-total'].textContent === '3', 'total incorreto');
  assert(h.nodes['results-pct'].textContent === '33%', 'aproveitamento incorreto');
  assert(h.nodes['results-record'].hidden === false, 'novo recorde não foi exibido');
});

test('revisão apresenta resposta escolhida, correta e explicação', function () {
  const list = h.nodes['results-review'];
  assert(list.children.length === 3, 'quantidade de cartões de revisão incorreta');
  const card = list.children[0];
  assert(card.querySelector('.bq5-review__q').textContent.indexOf('Questão sobre o Brasil') >= 0, 'enunciado ausente');
  assert(card.querySelector('[data-role="chosen"]').textContent === 'Amazônia', 'resposta escolhida ausente');
  assert(card.querySelector('[data-role="correct"]').textContent === 'Amazônia', 'gabarito incorreto');
  assert(card.querySelector('.bq5-review__expl').textContent.indexOf('grande biodiversidade') >= 0, 'explicação ausente');
  assert(list.children[2].querySelector('[data-role="chosen"]').textContent === 'Tempo esgotado', 'timeout não foi explicado');
});

test('desempenho por eixo agrega acertos e erros por tema', function () {
  const items = h.nodes['results-performance'].children;
  assert(items.length === 2, 'esperava dois eixos');
  const texts = items.map(item => item.children.map(child => child.textContent).join(' ')).join(' ');
  assert(texts.indexOf('Cultura') >= 0 && texts.indexOf('1/2') >= 0, 'estatística de Cultura ausente');
  assert(texts.indexOf('Economia') >= 0 && texts.indexOf('0/1') >= 0, 'estatística de Economia ausente');
});

test('histórico guarda resumo e não duplica a mesma partida ao reabrir resultados', function () {
  let history = BQ5.screens.results.getHistory();
  assert(history.length === 1, 'não registrou partida no histórico');
  assert(history[0].score === 120 && history[0].wrong === 2, 'resumo do histórico incorreto');
  BQ5.screens.results.show(result);
  history = BQ5.screens.results.getHistory();
  assert(history.length === 1, 'duplicou a partida ao reabrir a tela');
  assert(BQ5.screens.results.state().recorded === true, 'estado recorded não foi marcado');
});

test('replay solo reinicia a configuração através do módulo 9', function () {
  BQ5.ui.emitAction('replay', {});
  assert(h.sandbox.replayStarts === 1, 'setup.start não foi chamado');
});

test('retorno ao menu usa a navegação central', function () {
  BQ5.ui.emitAction('to-menu', {});
  assert(h.screen === 'menu', 'não retornou ao menu');
});

test('1x1 com desfecho de derrota exibe Você perdeu e classificação', function () {
  result = {
    mode: '1v1', score: 75, right: 2, total: 3, outcome: 'loss', playerId: 'p1', winnerId: 'p2', review,
    players: [{ id: 'p1', name: 'Você', score: 75, rank: 2 }, { id: 'p2', name: 'Rival', score: 100, rank: 1 }]
  };
  BQ5.engine.result = () => result;
  BQ5.engine.state = () => ({ mode: '1v1', score: 75 });
  BQ5.ui.emit('game:started', {});
  BQ5.screens.results.show(result);
  assert(h.nodes['results-title'].textContent === 'Você perdeu', 'não exibiu o estado de derrota');
  assert(h.nodes['results-ranking'].children.length === 2, 'ranking 1x1 não foi renderizado');
  assert(h.nodes['results-ranking'].children[0].querySelector('.bq5-ranking__name').textContent === 'Rival', 'ranking não priorizou maior posição/pontuação');
});

test('1x1 com vitória explícita exibe Vitória e delega replay ao módulo multiplayer', function () {
  result = { mode: 'multiplayer', score: 150, right: 3, total: 3, outcome: 'win', review };
  BQ5.engine.result = () => result;
  BQ5.engine.state = () => ({ mode: 'multiplayer', score: 150 });
  BQ5.ui.emit('game:started', {});
  BQ5.screens.results.show(result);
  assert(h.nodes['results-title'].textContent === 'Vitória', 'não exibiu Vitória');
  let delegated = 0;
  BQ5.ui.on('results:replay', () => { delegated++; });
  BQ5.ui.emitAction('replay', {});
  assert(delegated === 1, 'replay não foi delegado para o modo multiplayer');
});

test('resultado sem desfecho explícito não inventa vitória ou derrota', function () {
  result = { mode: '1v1', score: 90, right: 2, total: 3, review };
  BQ5.engine.result = () => result;
  BQ5.engine.state = () => ({ mode: '1v1', score: 90 });
  BQ5.ui.emit('game:started', {});
  BQ5.screens.results.show(result);
  assert(h.nodes['results-title'].textContent === 'Resultado da partida', 'inferiu vencedor sem outcome');
});

process.stdout.write('\n' + passed + '/' + (passed + failed) + ' testes passaram.\n');
if (failed) process.exitCode = 1;
