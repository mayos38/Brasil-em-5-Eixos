// ============================================================
// Suíte MÓDULO 4 — js/bank.js (parte assíncrona: BQ5.bank.load com fetch fake)
// Rodada por tests/run_bank.py via run_tests_async (checkpoint de microtarefas).
// ============================================================

var GOOD = { version: 2, source: 'fixture-fetch', questions: [
  { id: 0, theme: 'cultura', region: 'norte', difficulty: 1, question: 'P0?', options: ['a','b','c','d'], answer: 0, explanation: '' },
  { id: 1, theme: 'cidades', region: 'sul', difficulty: 2, question: 'P1?', options: ['e','f','g','h'], answer: 1, explanation: '' },
  { id: 2, theme: 'animais', region: 'sudeste', difficulty: 3, question: 'P2?', options: ['i','j','k','l'], answer: 2, explanation: '' }
] };
var BADSCHEMA = { questions: [ { id: 1, theme: 'cultura', region: 'norte', difficulty: 1, question: 'x?', options: ['a','b','c'], answer: 0 } ] }; // 3 alternativas
window.__GOOD_JSON = JSON.stringify(GOOD);
window.__BAD_JSON = JSON.stringify(BADSCHEMA);
window.__prevCount = BQ5.bank.count();

// fetch fake: comportamento por padrão de URL (determinístico, sem rede real)
globalThis.fetch = function (url) {
  var u = String(url);
  if (u.indexOf('404') !== -1) return Promise.resolve({ ok: false, status: 404 });
  if (u.indexOf('badjson') !== -1) return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(JSON.parse(window.__BAD_JSON)); } });
  if (u.indexOf('reject') !== -1) return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.reject(new Error('parse boom')); } });
  return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(JSON.parse(window.__GOOD_JSON)); } });
};

testAsync('load: HTTP 200 + JSON válido adota o banco e devolve count/stats', function () {
  return BQ5.bank.load('data/ok.json').then(function (res) {
    assert(res.ok === true, 'res.ok != true: ' + JSON.stringify(res));
    assert(res.count === GOOD.questions.length, 'count diverge: ' + res.count);
    assert(BQ5.bank.loaded() === true && BQ5.bank.count() === GOOD.questions.length, 'banco não adotado no estado');
  });
});

testAsync('load: HTTP 404 → code HTTP com status e estado preservado', function () {
  return BQ5.bank.load('data/404.json').then(function (res) {
    assert(res.ok === false && res.code === 'HTTP' && res.status === 404, JSON.stringify(res));
    assert(BQ5.bank.count() === GOOD.questions.length, 'estado mudou após falha HTTP');
  });
});

testAsync('load: HTTP 200 com schema inválido → code SCHEMA e lista de erros', function () {
  return BQ5.bank.load('data/badjson.json').then(function (res) {
    assert(res.ok === false && res.code === 'SCHEMA', JSON.stringify(res));
    assert(Array.isArray(res.errors) && res.errors.length > 0, 'sem lista de erros');
    assert(BQ5.bank.count() === GOOD.questions.length, 'estado mudou após schema inválido');
  });
});

testAsync('load: json() rejeita → code JSON, ok=false', function () {
  return BQ5.bank.load('data/reject.json').then(function (res) {
    assert(res.ok === false && res.code === 'JSON', JSON.stringify(res));
  });
});
