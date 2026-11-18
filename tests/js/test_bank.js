// ============================================================
// Suíte MÓDULO 4 — js/bank.js (parte síncrona: validate/adopt/fromText/estado)
// Rodada por tests/run_bank.py em V8 real (py-mini-racer).
// ============================================================

function mkQ(id, theme, region, diff) {
  return { id: id, theme: theme, region: region, difficulty: diff,
           question: 'Pergunta ' + id + '?', options: ['A' + id, 'B' + id, 'C' + id, 'D' + id],
           answer: 1, explanation: 'Explicação da questão ' + id };
}
function mkBank(rows) {
  var questions = rows.map(function (t, i) { return mkQ(i, t[0], t[1], t[2]); });
  return { version: 1, source: 'fixture', count: questions.length, questions: questions };
}
function throws(fn, msg) {
  var threw = false; try { fn(); } catch (e) { threw = true; }
  assert(threw, msg || 'deveria lançar erro');
}

var FIX5 = mkBank([['cultura','norte',1],['economia','sul',2],['animais','centro-oeste',3],['vegetacao','nordeste',1],['cidades','sudeste',2]]);

// ---------- validate() — função pura ----------

test('validate: banco mínimo válido é aceito e normaliza explanation ausente', function () {
  var raw = { questions: [ mkQ(0,'cultura','norte',1), { id: 1, theme:'cidades', region:'sul', difficulty:2, question:'x?', options:['a','b','c','d'], answer:0 } ] };
  var v = BQ5.bank.validate(raw);
  assert(v.ok === true, 'deveria ser válido; erros: ' + JSON.stringify(v.errors));
  assert(v.data.questions.length === 2, 'data deve ter 2 questões');
  assert(v.data.questions[1].explanation === '', 'explanation ausente vira string vazia');
});

test('validate: raiz não objeto (null/array/string) → erro', function () {
  [null, undefined, [], 'abc', 42].forEach(function (bad) {
    var v = BQ5.bank.validate(bad);
    assert(v.ok === false && v.errors.length > 0, 'raiz inválida aceita: ' + JSON.stringify(bad));
  });
});

test('validate: questions ausente ou não array → erro', function () {
  assert(BQ5.bank.validate({}).ok === false, 'sem questions aceito');
  assert(BQ5.bank.validate({ questions: 'x' }).ok === false, 'questions string aceito');
});

test('validate: questions vazio → erro', function () {
  var v = BQ5.bank.validate({ questions: [] });
  assert(v.ok === false && /vazio/.test(v.errors.join(' ')), 'banco vazio aceito');
});

test('validate: id duplicado → erro', function () {
  var raw = mkBank([['cultura','norte',1],['cidades','sul',2]]);
  raw.questions[1].id = raw.questions[0].id;
  var v = BQ5.bank.validate(raw);
  assert(v.ok === false && /duplicado/.test(v.errors.join(' ')), 'id duplicado aceito: ' + JSON.stringify(v.errors));
});

test('validate: id não inteiro → erro', function () {
  var raw = mkBank([['cultura','norte',1]]);
  raw.questions[0].id = 'zero';
  assert(BQ5.bank.validate(raw).ok === false, 'id string aceito');
});

test('validate: answer fora do intervalo → erro', function () {
  var raw = mkBank([['cultura','norte',1]]);
  raw.questions[0].answer = 4;
  assert(BQ5.bank.validate(raw).ok === false, 'answer=4 aceito');
  raw.questions[0].answer = -1;
  assert(BQ5.bank.validate(raw).ok === false, 'answer=-1 aceito');
});

test('validate: tema/região desconhecidos → erro', function () {
  var r1 = mkBank([['cultura','norte',1]]); r1.questions[0].theme = 'politica';
  assert(BQ5.bank.validate(r1).ok === false, 'tema fora do config aceito');
  var r2 = mkBank([['cultura','norte',1]]); r2.questions[0].region = 'amazonas';
  assert(BQ5.bank.validate(r2).ok === false, 'região fora do config aceita');
});

test('validate: dificuldade inválida (0 ou 9) → erro', function () {
  var r1 = mkBank([['cultura','norte',1]]); r1.questions[0].difficulty = 0;
  assert(BQ5.bank.validate(r1).ok === false, 'dificuldade 0 aceita');
  var r2 = mkBank([['cultura','norte',1]]); r2.questions[0].difficulty = 9;
  assert(BQ5.bank.validate(r2).ok === false, 'dificuldade 9 aceita');
});

test('validate: question vazia → erro', function () {
  var raw = mkBank([['cultura','norte',1]]); raw.questions[0].question = '   ';
  assert(BQ5.bank.validate(raw).ok === false, 'question em branco aceita');
});

test('validate: alternativas — quantidade errada, duplicada ou vazia → erro', function () {
  var r1 = mkBank([['cultura','norte',1]]); r1.questions[0].options = ['a','b','c'];
  assert(BQ5.bank.validate(r1).ok === false, '3 alternativas aceitas');
  var r2 = mkBank([['cultura','norte',1]]); r2.questions[0].options = ['a','b','a','d'];
  assert(BQ5.bank.validate(r2).ok === false, 'alternativa duplicada aceita');
  var r3 = mkBank([['cultura','norte',1]]); r3.questions[0].options = ['a','','c','d'];
  assert(BQ5.bank.validate(r3).ok === false, 'alternativa vazia aceita');
});

test('validate: count divergente gera AVISO, não erro', function () {
  var raw = mkBank([['cultura','norte',1],['cidades','sul',2]]);
  raw.count = 99;
  var v = BQ5.bank.validate(raw);
  assert(v.ok === true, 'aviso virou erro: ' + JSON.stringify(v.errors));
  assert(v.warnings.length >= 1 && /diverge/.test(v.warnings.join(' ')), 'sem aviso de divergência');
});

// ---------- estado inicial (antes de qualquer adoção) ----------

test('estado inicial: loaded=false, count=0, stats zerado, list vazio', function () {
  assert(BQ5.bank.loaded() === false, 'já carregado no início?');
  assert(BQ5.bank.count() === 0, 'count != 0 no início');
  var st = BQ5.bank.stats();
  assert(st.total === 0, 'stats.total != 0');
  assert(BQ5.bank.list().length === 0, 'list não vazio no início');
  assert(BQ5.bank.getQuestion(0) === null, 'getQuestion deveria ser null');
});

// ---------- adopt() e estado ----------

test('adopt válido: carrega, stats dinâmico e cópias isoladas', function () {
  var r = BQ5.bank.adopt(FIX5);
  assert(r.ok === true, 'adopt falhou: ' + JSON.stringify(r.errors));
  assert(BQ5.bank.loaded() === true && BQ5.bank.count() === FIX5.questions.length, 'count diverge');
  var exp = {};
  FIX5.questions.forEach(function (q) { exp[q.theme] = (exp[q.theme] || 0) + 1; });
  var st = BQ5.bank.stats();
  assert(st.total === FIX5.questions.length, 'stats.total diverge');
  for (var t in exp) assert(st.byTheme[t] === exp[t], 'byTheme[' + t + ']=' + st.byTheme[t] + ' esperado ' + exp[t]);
  var g = BQ5.bank.getQuestion(0);
  assert(g && g.theme === FIX5.questions[0].theme, 'getQuestion(0) errado');
  // cópias: mutar o resultado não pode afetar o banco
  var l = BQ5.bank.list(); l[0].question = 'MUTADO'; l.push({ id: 999 });
  assert(BQ5.bank.count() === FIX5.questions.length, 'list().push alterou o banco');
  assert(BQ5.bank.getQuestion(0).question !== 'MUTADO', 'mutação externa atingiu o banco interno');
});

test('adopt inválido: ok=false com code SCHEMA e estado anterior preservado', function () {
  var prev = BQ5.bank.count();
  var r = BQ5.bank.adopt({ questions: 'x' });
  assert(r.ok === false && r.code === 'SCHEMA' && r.errors.length > 0, 'resultado inesperado: ' + JSON.stringify(r));
  assert(BQ5.bank.count() === prev, 'estado mudou após adopt inválido');
});

test('adopt substitui o banco anterior', function () {
  BQ5.bank.adopt(mkBank([['cultura','norte',1]]));
  assert(BQ5.bank.count() === 1, 'count != 1 após re-adoção');
  assert(BQ5.bank.getQuestion(4) === null, 'questão do banco antigo ainda visível');
});

// ---------- fromText() ----------

test('fromText: JSON válido carrega e devolve stats', function () {
  var r = BQ5.bank.fromText(JSON.stringify(FIX5));
  assert(r.ok === true, 'fromText falhou: ' + JSON.stringify(r.errors));
  assert(BQ5.bank.count() === FIX5.questions.length, 'count diverge');
  assert(BQ5.bank.meta().source === 'fixture', 'meta.source não propagado');
});

test('fromText: JSON malformado → code JSON, ok=false', function () {
  var r = BQ5.bank.fromText('{"questions": [oops');
  assert(r.ok === false && r.code === 'JSON' && /inválido/i.test(r.errors.join(' ')), 'resultado inesperado: ' + JSON.stringify(r));
});

// ---------- banco oficial do projeto (injetado pelo runner como window.__BANK_FILE) ----------

test('banco oficial data/questions.json carrega via fromText e é internamente consistente', function () {
  assert(typeof window.__BANK_FILE === 'string', '__BANK_FILE não injetado pelo runner');
  var r = BQ5.bank.fromText(window.__BANK_FILE);
  assert(r.ok === true, 'banco oficial inválido: ' + JSON.stringify(r.errors));
  var raw = JSON.parse(window.__BANK_FILE);
  assert(r.count === raw.questions.length, 'count diverge do arquivo');
  assert(raw.count === r.count, '"count" do arquivo diverge do tamanho real');
  assert(r.warnings.length === 0, 'avisos inesperados: ' + JSON.stringify(r.warnings));
  var st = BQ5.bank.stats();
  function sum(o) { var s = 0; for (var k in o) s += o[k]; return s; }
  assert(st.total === r.count, 'stats.total != count');
  assert(sum(st.byTheme) === st.total && sum(st.byRegion) === st.total && sum(st.byDifficulty) === st.total,
         'somas das distribuições não batem com o total (quantidades calculadas dinamicamente)');
});
