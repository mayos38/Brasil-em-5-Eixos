/* ============================================================
 * Suíte do MÓDULO 5 — js/engine.js (motor do jogo)
 * Roda em V8 real via py-mini-racer (tests/run_engine.py).
 * Relógio determinístico: setClock(() => __t) — os testes controlam
 * o tempo explicitamente; nenhuma dependência de Date.now/setTimeout.
 * Banco oficial (count declarado no próprio JSON) chega como
 * window.__BANK_FILE (fixture); bancos sintéticos determinísticos são
 * adotados via BQ5.bank.adopt() para cenários específicos (regras puras do
 * motor de fallback, complementação regional, banco pequeno).
 * JavaScript clássico, sem async/await, sem DOM.
 * ============================================================ */
var __t = 0; // relógio fake (ms), mutável pelos testes
// Count declarado no fixture oficial — nunca hardcodeado: acompanha o JSON.
var OFFICIAL_COUNT = JSON.parse(__BANK_FILE).count;

function mkQ(id, theme, region, difficulty, answer) {
  return { id: id, theme: theme, region: region, difficulty: difficulty,
           question: 'Pergunta sintética ' + id,
           options: ['A', 'B', 'C', 'D'], answer: answer, explanation: '' };
}

function ensureOfficialBank() {
  var r = BQ5.bank.fromText(__BANK_FILE);
  assert(r.ok === true && BQ5.bank.count() === OFFICIAL_COUNT,
         'fixture oficial falhou (count esperado ' + OFFICIAL_COUNT + '): ' + JSON.stringify(r.errors || []));
}

// Responde (corretamente ou não) e avança até o fim da partida ativa.
// Devolve [{q, res}, ...] com as questões vistas e os resultados de answer().
function playGame(useCorrect) {
  var out = [];
  for (;;) {
    var q = BQ5.engine.question();
    assert(q !== null, 'question() deveria ter questão ativa');
    var choice = useCorrect ? q.a : ((q.a === 0) ? 1 : 0);
    var a = BQ5.engine.answer(choice);
    assert(a.ok === true, 'answer falhou: ' + JSON.stringify(a));
    out.push({ q: q, res: a });
    var n = BQ5.engine.next();
    if (!n.ok) throw new Error('next falhou: ' + JSON.stringify(n));
    if (n.finished) break;
  }
  return out;
}

// ---------- banco ausente / inválido (antes de adotar o fixture) ----------

test('start sem banco => NO_BANK', function () {
  var r = BQ5.engine.start({ mode: 'solo' });
  assert(r.ok === false && r.code === 'NO_BANK', 'esperava NO_BANK, veio ' + JSON.stringify(r));
});

test('adopt inválido (SCHEMA) não carrega => engine segue NO_BANK', function () {
  var bad = BQ5.bank.adopt({ questions: [] });
  assert(bad.ok === false && bad.code === 'SCHEMA', 'adoção deveria falhar: ' + JSON.stringify(bad));
  var r = BQ5.engine.start({ mode: 'solo' });
  assert(r.ok === false && r.code === 'NO_BANK', JSON.stringify(r));
});

test('fromText com JSON inválido => code JSON e engine segue NO_BANK', function () {
  var bad = BQ5.bank.fromText('{isso nao é json');
  assert(bad.ok === false && bad.code === 'JSON', 'esperava JSON, veio ' + JSON.stringify(bad));
  var r = BQ5.engine.start({ mode: 'solo' });
  assert(r.ok === false && r.code === 'NO_BANK', JSON.stringify(r));
});

test('fixture: banco oficial é adotado via fromText (count conforme o JSON)', function () {
  var r = BQ5.bank.fromText(__BANK_FILE);
  assert(r.ok === true, 'adotar fixture falhou: ' + JSON.stringify(r.errors || []));
  assert(BQ5.bank.count() === OFFICIAL_COUNT, 'count != ' + OFFICIAL_COUNT + ': ' + BQ5.bank.count());
});

// ---------- inicialização e rejeições ----------

test('inicialização solo válida com opções padrão', function () {
  var r = BQ5.engine.start({ mode: 'solo' });
  assert(r.ok === true, JSON.stringify(r));
  var s = r.game;
  assert(s.mode === 'solo' && s.theme === 'all' && s.diff === 'normal', 'padrões errados: ' + JSON.stringify(s));
  assert(s.total === BQ5.config.soloQuestionCount, 'total != soloQuestionCount: ' + s.total);
  assert(s.index === 0 && s.score === 0 && s.right === 0, 'estado inicial errado: ' + JSON.stringify(s));
  assert(s.locked === false && s.finished === false, 'bandeihas iniciais erradas: ' + JSON.stringify(s));
});

test('inicialização solo válida com tema/dificuldade/count', function () {
  var r = BQ5.engine.start({ mode: 'solo', theme: 'cultura', diff: 'normal', count: 6 });
  assert(r.ok === true, JSON.stringify(r));
  assert(r.game.total === 6 && r.game.theme === 'cultura' && r.game.diff === 'normal', JSON.stringify(r.game));
});

test('modo inválido é rejeitado (INVALID_MODE)', function () {
  ['coop', 'SOLO', '', undefined].forEach(function (m) {
    var r = BQ5.engine.start({ mode: m });
    assert(r.ok === false && r.code === 'INVALID_MODE', 'mode ' + JSON.stringify(m) + ' => ' + JSON.stringify(r));
  });
});

test('tema inválido é rejeitado (BAD_THEME)', function () {
  var r = BQ5.engine.start({ mode: 'solo', theme: 'gastronomia' });
  assert(r.ok === false && r.code === 'BAD_THEME', JSON.stringify(r));
});

test('dificuldade inválida é rejeitada (BAD_DIFF)', function () {
  var r = BQ5.engine.start({ mode: 'solo', diff: 'extrema' });
  assert(r.ok === false && r.code === 'BAD_DIFF', JSON.stringify(r));
});

test('campanha sem região ou com região inválida => BAD_REGION', function () {
  var a = BQ5.engine.start({ mode: 'campaign' });
  assert(a.ok === false && a.code === 'BAD_REGION', JSON.stringify(a));
  var b = BQ5.engine.start({ mode: 'campaign', region: 'amazonas' });
  assert(b.ok === false && b.code === 'BAD_REGION', JSON.stringify(b));
});

test('count inválido é rejeitado (BAD_COUNT)', function () {
  [0, -1, 2.5, 'x'].forEach(function (c) {
    var r = BQ5.engine.start({ mode: 'solo', count: c });
    assert(r.ok === false && r.code === 'BAD_COUNT', 'count ' + JSON.stringify(c) + ' => ' + JSON.stringify(r));
  });
});

// ---------- seleção de pool / fallback / embaralhamento ----------

test('seleção por tema+tier (pool >= 5): todas do tema e dentro da faixa', function () {
  var r = BQ5.engine.start({ mode: 'solo', theme: 'cultura', diff: 'normal', count: 10 });
  assert(r.ok === true, JSON.stringify(r));
  var played = playGame(true);
  assert(played.length === 10, 'total esperado 10, veio ' + played.length);
  played.forEach(function (p) {
    assert(p.q.t === 'cultura', 'tema errado: ' + JSON.stringify({ id: p.q.id, t: p.q.t }));
    assert(BQ5.config.tiers.normal.indexOf(p.q.d) !== -1, 'dificuldade fora do tier normal: d=' + p.q.d);
  });
});

test('fallback: pool de tier < 5 cai para o filtro só por tema', function () {
  // Banco sintético determinístico: cultura+dificil tem apenas 4 (< MIN_POOL=5);
  // pool só-tema = 10. Regra pura do motor, independente da distribuição
  // do banco oficial (que hoje tem todos os pools tema+tier >= 20).
  var qs = [];
  for (var i = 0; i < 4; i++) qs.push(mkQ(i, 'cultura', 'norte', 3, i % 4));      // tier dificil: 4 (< 5)
  for (var j = 4; j < 10; j++) qs.push(mkQ(j, 'cultura', 'sudeste', 1, j % 4));   // fora do tier: 6
  var r0 = BQ5.bank.adopt({ questions: qs });
  assert(r0.ok === true && r0.count === 10, 'fixture sintético falhou: ' + JSON.stringify(r0.errors || []));
  __t = 0;
  var r = BQ5.engine.start({ mode: 'solo', theme: 'cultura', diff: 'dificil', count: 10 });
  assert(r.ok === true, JSON.stringify(r));
  var played = playGame(true);
  assert(played.length === 10, 'total esperado 10 (pool só-tema=10), veio ' + played.length);
  var outsideTier = 0;
  played.forEach(function (p) {
    assert(p.q.t === 'cultura', 'tema errado: ' + JSON.stringify({ id: p.q.id, t: p.q.t }));
    if (BQ5.config.tiers.dificil.indexOf(p.q.d) === -1) outsideTier++;
  });
  assert(outsideTier > 0, 'fallback não ocorreu — todas saíram do tier dificil');
});

test('pool de tier exatamente 5 NÃO cai para fallback e limita o total', function () {
  // Banco sintético determinístico: animais+dificil tem EXATAMENTE 5 (= MIN_POOL);
  // pool só-tema = 9 — se houvesse fallback indevido, o total seria maior que 5.
  var qs = [];
  for (var i = 0; i < 5; i++) qs.push(mkQ(i, 'animais', 'sul', 3, i % 4));        // tier dificil: exatamente 5
  for (var j = 5; j < 9; j++) qs.push(mkQ(j, 'animais', 'norte', 1, j % 4));       // fora do tier: 4
  var r0 = BQ5.bank.adopt({ questions: qs });
  assert(r0.ok === true && r0.count === 9, 'fixture sintético falhou: ' + JSON.stringify(r0.errors || []));
  __t = 0;
  var r = BQ5.engine.start({ mode: 'solo', theme: 'animais', diff: 'dificil', count: 10 });
  assert(r.ok === true, JSON.stringify(r));
  var played = playGame(true);
  assert(played.length === 5, 'total esperado 5 (pool exausto), veio ' + played.length);
  played.forEach(function (p) {
    assert(p.q.t === 'animais' && p.q.d === 3, 'fora do pool: ' + JSON.stringify({ id: p.q.id, t: p.q.t, d: p.q.d }));
  });
});

test('alternativas embaralhadas preservam a resposta correta e sem repetição na partida', function () {
  ensureOfficialBank(); // os testes anteriores adotaram bancos sintéticos
  var r = BQ5.engine.start({ mode: 'solo' }); // count padrão 10
  assert(r.ok === true, JSON.stringify(r));
  var played = playGame(true);
  assert(played.length === 10, 'total esperado 10, veio ' + played.length);
  var seen = {};
  played.forEach(function (p) {
    var orig = BQ5.bank.getQuestion(p.q.id);
    assert(orig !== null && typeof orig.answer === 'number', 'id não existe no banco: ' + p.q.id);
    assert(p.q.o[p.q.a] === orig.options[orig.answer],
           'associação correta perdida na q' + p.q.id + ': ' + JSON.stringify(p.q));
    assert(seen[p.q.id] === undefined, 'questão repetida na partida: id ' + p.q.id);
    seen[p.q.id] = true;
  });
});

// ---------- relógio determinístico e pontuação ----------

test('setClock valida o argumento e now() reflete o relógio fake', function () {
  var threw = false;
  try { BQ5.engine.setClock(123); } catch (e) { threw = true; }
  assert(threw, 'setClock(123) deveria lançar');
  __t = 0;
  BQ5.engine.setClock(function () { return __t; });
  assert(BQ5.engine.now() === 0, 'now() != 0 com relógio fake em 0');
});

test('resposta correta pontua base + bônus limitado a timeBonusMax', function () {
  __t = 0; // relógio zero ANTES do start (tEnd = clock()+prazo da dificuldade) => rem integral > cap 7
  BQ5.engine.start({ mode: 'solo', count: 1 });
  var q = BQ5.engine.question();
  var a = BQ5.engine.answer(q.a);
  assert(a.ok === true && a.correct === true, JSON.stringify(a));
  var expected = BQ5.config.pointsBase[q.d] + Math.min(15, BQ5.config.timeBonusMax);
  assert(a.points === expected, 'points ' + a.points + ', esperado ' + expected);
  assert(a.score === expected && a.right === 1, JSON.stringify(a));
});

test('resposta incorreta vale 0 e não altera score/right', function () {
  __t = 0;
  BQ5.engine.start({ mode: 'solo', count: 2 });
  var q = BQ5.engine.question();
  var wrong = (q.a === 0) ? 1 : 0;
  var a = BQ5.engine.answer(wrong);
  assert(a.ok === true && a.correct === false && a.points === 0, JSON.stringify(a));
  assert(a.score === 0 && a.right === 0, JSON.stringify(a));
});

test('pontuação determinística: bônus exato e arredondamento dos segundos', function () {
  __t = 0; // ANTES do start (o tEnd é calculado com o relógio atual)
  BQ5.engine.start({ mode: 'solo', count: 3 });
  var T = BQ5.engine.state().timeLimitMs;
  assert(typeof T === 'number' && T > 7000, 'state().timeLimitMs ausente/inválido: ' + T);
  // q0: rem = prazo integral (por dificuldade) -> bônus no teto (cap)
  var q0 = BQ5.engine.question();
  var a0 = BQ5.engine.answer(q0.a);
  assert(a0.points === BQ5.config.pointsBase[q0.d] + 7, 'q0 (rem integral, cap): ' + a0.points);
  var n0 = BQ5.engine.next();
  assert(n0.ok && !n0.finished && n0.index === 1, JSON.stringify(n0));

  // q1: rem = 2500ms -> round(2.5) = 3s
  __t = T - 2500;
  var q1 = BQ5.engine.question();
  assert(BQ5.engine.remainingMs() === 2500, 'remainingMs ' + BQ5.engine.remainingMs());
  var a1 = BQ5.engine.answer(q1.a);
  assert(a1.points === BQ5.config.pointsBase[q1.d] + 3, 'q1 (rem=2.5s -> round 3): ' + a1.points);
  var n1 = BQ5.engine.next();
  assert(n1.ok && !n1.finished && n1.index === 2, JSON.stringify(n1));

  // q2: tEnd reiniciado para (T-2500)+T; rem = 1499ms -> round(1.499) = 1s
  __t = 2 * T - 2500 - 1499;
  var q2 = BQ5.engine.question();
  assert(BQ5.engine.remainingMs() === 1499, 'remainingMs ' + BQ5.engine.remainingMs());
  var a2 = BQ5.engine.answer(q2.a);
  assert(a2.points === BQ5.config.pointsBase[q2.d] + 1, 'q2 (rem=1.499s -> round 1): ' + a2.points);
  var n2 = BQ5.engine.next();
  assert(n2.ok && n2.finished === true, 'deveria finalizar: ' + JSON.stringify(n2));
});

test('timeout (answer -1) vale 0, marca timedOut e trava a questão', function () {
  __t = 0; // ANTES do start (o tEnd é calculado com o relógio atual)
  BQ5.engine.start({ mode: 'solo', count: 2 });
  var T = BQ5.engine.state().timeLimitMs;
  var q = BQ5.engine.question();
  assert(q !== null && typeof q.a === 'number', 'questão ausente');
  __t = T - 200; // rem = 200ms (prazo por dificuldade)
  assert(BQ5.engine.remainingMs() === 200, 'remainingMs ' + BQ5.engine.remainingMs());
  var a = BQ5.engine.answer(-1);
  assert(a.ok === true && a.correct === false && a.timedOut === true && a.points === 0, JSON.stringify(a));
  assert(BQ5.engine.state().locked === true, 'questão não ficou travada');
  var rv = BQ5.engine.review();
  assert(rv.length === 1 && rv[0].choice === -1 && rv[0].ok === false, JSON.stringify(rv));
  var n = BQ5.engine.next();
  assert(n.ok && !n.finished, 'next após timeout: ' + JSON.stringify(n));
});

test('tempo esgotado clampa remainingMs em 0 (nunca negativo)', function () {
  __t = 0;
  BQ5.engine.start({ mode: 'solo', count: 1 });
  __t = 999999; // muito além do tEnd
  assert(BQ5.engine.remainingMs() === 0, 'remainingMs ' + BQ5.engine.remainingMs());
});

// ---------- bloqueios e avanço ----------

test('segunda resposta na mesma questão => LOCKED sem alterar estado', function () {
  __t = 0;
  BQ5.engine.start({ mode: 'solo', count: 1 });
  var q = BQ5.engine.question();
  assert(BQ5.engine.answer(q.a).ok === true, 'primeira answer falhou');
  var sBefore = JSON.stringify(BQ5.engine.state());
  var a2 = BQ5.engine.answer((q.a === 0) ? 1 : 0);
  assert(a2.ok === false && a2.code === 'LOCKED', 'esperava LOCKED: ' + JSON.stringify(a2));
  assert(JSON.stringify(BQ5.engine.state()) === sBefore, 'estado mudou após LOCKED');
});

test('INVALID_CHOICE não trava nem altera estado; resposta válida ainda é aceita', function () {
  __t = 0;
  BQ5.engine.start({ mode: 'solo', count: 1 });
  var q = BQ5.engine.question();
  [4, -2, 1.5, 'x'].forEach(function (c) {
    var r = BQ5.engine.answer(c);
    assert(r.ok === false && r.code === 'INVALID_CHOICE', 'choice ' + JSON.stringify(c) + ' => ' + JSON.stringify(r));
  });
  assert(BQ5.engine.state().locked === false, 'deveria seguir desbloqueada após INVALID_CHOICE');
  var a = BQ5.engine.answer(q.a);
  assert(a.ok === true && a.correct === true, JSON.stringify(a));
});

test('next sem responder => NOT_ANSWERED e estado inalterado', function () {
  __t = 0;
  BQ5.engine.start({ mode: 'solo', count: 2 });
  var sBefore = JSON.stringify(BQ5.engine.state());
  var n = BQ5.engine.next();
  assert(n.ok === false && n.code === 'NOT_ANSWERED', JSON.stringify(n));
  assert(JSON.stringify(BQ5.engine.state()) === sBefore, 'estado mudou após NOT_ANSWERED');
});

test('next após responder avança e reinicia o prazo integral', function () {
  __t = 0;
  BQ5.engine.start({ mode: 'solo', count: 2 });
  var q = BQ5.engine.question();
  assert(BQ5.engine.answer(q.a).ok === true, 'answer falhou');
  __t = 9000; // consumiu 9s da primeira questão
  var n = BQ5.engine.next();
  assert(n.ok && !n.finished && n.index === 1, JSON.stringify(n));
  assert(BQ5.engine.remainingMs() === BQ5.engine.state().timeLimitMs,
         'prazo não reiniciado: ' + BQ5.engine.remainingMs());
});

// ---------- finalização solo e recorde (banco sintético de 3 questões d=2) ----------

test('finalização solo: score, pct e recorde persistido (só aumenta)', function () {
  BQ5.storage.setJSON(BQ5.config.storageKeys.bestSolo, 40); // linha de base determinística
  var r = BQ5.bank.adopt({ questions: [mkQ(0, 'cultura', 'norte', 2, 0),
                                       mkQ(1, 'cultura', 'norte', 2, 1),
                                       mkQ(2, 'cultura', 'norte', 2, 2)] });
  assert(r.ok === true && r.count === 3, 'fixture pequeno falhou: ' + JSON.stringify(r.errors || []));
  __t = 0;
  var g = BQ5.engine.start({ mode: 'solo' }); // count padrão 10 > pool 3 => total 3
  assert(g.ok === true && g.game.total === 3, JSON.stringify(g));
  var played = playGame(true);
  assert(played.length === 3, 'total esperado 3, veio ' + played.length);
  // todas d=2 e rem sempre 15s (relógio parado) => 3 x (20+7) = 81
  var expected = played.reduce(function (s, p) { return s + (p.res.correct ? BQ5.config.pointsBase[p.q.d] + 7 : 0); }, 0);
  assert(expected === 81, 'score esperado fixo 81, veio ' + expected);
  var st = BQ5.engine.state();
  assert(st.finished === true && st.score === 81 && st.right === 3, JSON.stringify(st));
  var res = BQ5.engine.result();
  assert(res !== null && res.mode === 'solo' && res.total === 3 && res.pct === 100, JSON.stringify(res));
  assert(res.record.prev === 40 && res.record.best === 81, 'recorde: ' + JSON.stringify(res.record));
  assert(BQ5.storage.getJSON(BQ5.config.storageKeys.bestSolo, 0) === 81, 'recorde não persistido no storage');
});

test('segunda partida com score menor NÃO reduz o recorde', function () {
  __t = 0;
  var g = BQ5.engine.start({ mode: 'solo' }); // mesmo banco de 3 questões d=2
  assert(g.ok === true && g.game.total === 3, JSON.stringify(g));
  playGame(false);
  var res = BQ5.engine.result();
  assert(res.score === 0 && res.right === 0 && res.pct === 0, JSON.stringify(res));
  assert(res.record.prev === 81 && res.record.best === 81, 'recorde deveria manter 81: ' + JSON.stringify(res.record));
});

// ---------- campanha (banco oficial) ----------

test('campanha válida: 6 perguntas da região, dificuldade fixa normal, ignora count', function () {
  ensureOfficialBank();
  var r = BQ5.engine.start({ mode: 'campaign', region: 'norte', diff: 'dificil', count: 3 });
  assert(r.ok === true, JSON.stringify(r));
  var s = r.game;
  assert(s.total === BQ5.config.campaignQuestionsPerStage,
         'total != campaignQuestionsPerStage: ' + s.total);
  assert(s.region === 'norte' && s.diff === 'normal', 'regras fixas da campanha violadas: ' + JSON.stringify(s));
});

test('campanha completa persiste progresso da região (done + best)', function () {
  ensureOfficialBank();
  BQ5.storage.resetCampaign(); // linha de base limpa e determinística
  __t = 0;
  var r = BQ5.engine.start({ mode: 'campaign', region: 'norte' });
  assert(r.ok === true, JSON.stringify(r));
  var played = playGame(true);
  assert(played.length === 6, 'total esperado 6, veio ' + played.length);
  played.forEach(function (p) { assert(p.q.reg === 'norte', 'região fora do estágio: ' + JSON.stringify({ id: p.q.id, reg: p.q.reg })); });
  var expected = played.reduce(function (s, p) { return s + (p.res.correct ? BQ5.config.pointsBase[p.q.d] + 7 : 0); }, 0);
  var res = BQ5.engine.result();
  assert(res.mode === 'campaign' && res.total === 6 && res.score === expected, JSON.stringify(res));
  assert(res.stage !== null && res.stage.region === 'norte' && res.stage.done === true,
         'stage: ' + JSON.stringify(res.stage));
  assert(res.stage.allDone === false, 'allDone cedo demais');
  assert(res.stage.best === expected, 'best regional: ' + res.stage.best + ', esperado ' + expected);
  var prog = BQ5.storage.getProgress();
  assert(prog.done.norte === true && prog.best.norte === expected, 'storage progress: ' + JSON.stringify(prog));
});

test('repetir região com pontuação menor NÃO reduz o best da etapa', function () {
  ensureOfficialBank();
  var prevBest = BQ5.storage.getProgress().best.norte;
  assert(typeof prevBest === 'number' && prevBest > 0, 'linha de base ausente: ' + JSON.stringify(prevBest));
  __t = 0;
  var r = BQ5.engine.start({ mode: 'campaign', region: 'norte' });
  assert(r.ok === true, JSON.stringify(r));
  playGame(false); // score 0
  var res = BQ5.engine.result();
  assert(res.score === 0, 'score deveria ser 0: ' + res.score);
  assert(res.stage.best === prevBest, 'best deveria manter ' + prevBest + ', veio ' + res.stage.best);
});

// ---------- complementação regional (banco sintético insuficiente) ----------

test('complementação regional quando o pool da região é insuficiente', function () {
  var qs = [];
  for (var i = 0; i < 3; i++) qs.push(mkQ(i, 'cultura', 'norte', 1, i % 4));       // norte: 3 (< 6)
  for (var j = 3; j < 8; j++) qs.push(mkQ(j, 'economia', 'sudeste', 2, j % 4));   // outras regiões: 5
  var r = BQ5.bank.adopt({ questions: qs });
  assert(r.ok === true && r.count === 8, 'fixture regional falhou: ' + JSON.stringify(r.errors || []));
  __t = 0;
  var g = BQ5.engine.start({ mode: 'campaign', region: 'norte' });
  assert(g.ok === true && g.game.total === 6, JSON.stringify(g));
  var played = playGame(true);
  var fromRegion = 0, others = 0;
  var seen = {};
  played.forEach(function (p) {
    if (p.q.reg === 'norte') fromRegion++; else others++;
    assert(seen[p.q.id] === undefined, 'questão repetida: id ' + p.q.id);
    seen[p.q.id] = true;
  });
  assert(fromRegion === 3 && others === 3,
         'complementação errada: norte=' + fromRegion + ', outras=' + others);
});

// ---------- banco pequeno / sem questões para os parâmetros ----------

test('banco pequeno: total limitado ao pool disponível e a partida termina', function () {
  var r = BQ5.bank.adopt({ questions: [mkQ(0, 'animais', 'sul', 1, 0), mkQ(1, 'cidades', 'sul', 3, 2)] });
  assert(r.ok === true && r.count === 2, 'fixture falhou');
  __t = 0;
  var g = BQ5.engine.start({ mode: 'solo' }); // count padrão 10 > pool disponível
  assert(g.ok === true && g.game.total === 2, JSON.stringify(g));
  var played = playGame(true);
  assert(played.length === 2 && BQ5.engine.state().finished === true, 'partida não terminou');
});

test('tema sem questões no banco => NO_QUESTIONS', function () {
  // mesmo banco pequeno anterior (apenas animais/cidades)
  var r = BQ5.engine.start({ mode: 'solo', theme: 'vegetacao' });
  assert(r.ok === false && r.code === 'NO_QUESTIONS', JSON.stringify(r));
});

// ---------- independência de DOM e estados inconsistentes ----------

test('independência de DOM: partida funciona com document removido', function () {
  ensureOfficialBank();
  var doc = globalThis.document;
  try {
    delete globalThis.document;
    assert(typeof document === 'undefined', 'document ainda existe após delete');
    __t = 0;
    var g = BQ5.engine.start({ mode: 'solo', count: 2 });
    assert(g.ok === true, JSON.stringify(g));
    var q = BQ5.engine.question();
    var a = BQ5.engine.answer(q.a);
    assert(a.ok === true && a.correct === true, JSON.stringify(a));
    var n = BQ5.engine.next();
    assert(n.ok === true && !n.finished, JSON.stringify(n));
    BQ5.engine.abort();
  } finally {
    globalThis.document = doc;
  }
});

test('sem partida: state/question/remainingMs/review/result => null; answer/next => NO_GAME', function () {
  assert(BQ5.engine.state() === null, 'state deveria ser null');
  assert(BQ5.engine.question() === null, 'question deveria ser null');
  assert(BQ5.engine.remainingMs() === null, 'remainingMs deveria ser null');
  assert(BQ5.engine.review() === null, 'review deveria ser null');
  assert(BQ5.engine.result() === null, 'result deveria ser null');
  var a = BQ5.engine.answer(0);
  assert(a.ok === false && a.code === 'NO_GAME', JSON.stringify(a));
  var n = BQ5.engine.next();
  assert(n.ok === false && n.code === 'NO_GAME', JSON.stringify(n));
});

test('após finalização: answer/next => FINISHED e o resultado não muda', function () {
  ensureOfficialBank();
  __t = 0;
  var g = BQ5.engine.start({ mode: 'solo', count: 1 });
  assert(g.ok === true, JSON.stringify(g));
  var q = BQ5.engine.question();
  assert(BQ5.engine.answer(q.a).ok === true, 'answer falhou');
  var fin = BQ5.engine.next();
  assert(fin.finished === true && fin.result !== null, JSON.stringify(fin));
  var resBefore = JSON.stringify(BQ5.engine.result());
  var a = BQ5.engine.answer(0);
  assert(a.ok === false && a.code === 'FINISHED', JSON.stringify(a));
  var n = BQ5.engine.next();
  assert(n.ok === false && n.code === 'FINISHED', JSON.stringify(n));
  assert(JSON.stringify(BQ5.engine.result()) === resBefore, 'resultado mudou após FINISHED');
});

test('snapshots são cópias isoladas (mutação externa não afeta o motor)', function () {
  ensureOfficialBank();
  __t = 0;
  var g = BQ5.engine.start({ mode: 'solo', count: 1 });
  assert(g.ok === true, JSON.stringify(g));
  var q1 = BQ5.engine.question();
  q1.o[0] = 'MUTADO';
  q1.a = (q1.a === 3) ? 2 : 3; // sabota a cópia
  var q2 = BQ5.engine.question();
  assert(q2 !== q1, 'deveria devolver uma nova cópia');
  var orig = BQ5.bank.getQuestion(q2.id);
  assert(q2.o[q2.a] === orig.options[orig.answer], 'cópia diverge do banco original');
  var a = BQ5.engine.answer(q2.a);
  assert(a.ok === true && a.correct === true, 'motor afetado por mutação externa: ' + JSON.stringify(a));
});

test('abort descarta a partida sem persistir nada', function () {
  ensureOfficialBank();
  __t = 0;
  var before = BQ5.storage.getJSON(BQ5.config.storageKeys.bestSolo, 0);
  var g = BQ5.engine.start({ mode: 'solo', count: 2 });
  assert(g.ok === true, JSON.stringify(g));
  var q = BQ5.engine.question();
  assert(BQ5.engine.answer(q.a).ok === true, 'answer falhou'); // respondida mas não finalizada
  var r1 = BQ5.engine.abort();
  assert(r1.ok === true && r1.hadGame === true, JSON.stringify(r1));
  var r2 = BQ5.engine.abort();
  assert(r2.ok === true && r2.hadGame === false, JSON.stringify(r2));
  assert(BQ5.storage.getJSON(BQ5.config.storageKeys.bestSolo, 0) === before, 'abort persistiu algo');
});

test('engine.progress delega ao storage (mesmos dados)', function () {
  var p1 = BQ5.engine.progress();
  var p2 = BQ5.storage.getProgress();
  assert(JSON.stringify(p1) === JSON.stringify(p2), 'progress divergente: ' + JSON.stringify(p1));
});

test('setClock(null) restaura o relógio padrão (Date.now)', function () {
  BQ5.engine.setClock(null);
  var d = Date.now();
  assert(Math.abs(BQ5.engine.now() - d) < 60000, 'now() diverge de Date.now(): ' + BQ5.engine.now());
});