/* ============================================================
 * Testes do MÓDULO 12 — js/campaign.js (Campanha v2, GDD "campanha v1.1")
 * Roda em V8 real via tests/run_campaign.py (py-mini-racer), com relógio e
 * RNG injetados para determinismo. Banco oficial do projeto como fixture +
 * bancos sintéticos mínimos para regras de conteúdo/desbloqueio.
 * ============================================================ */
var __t = 0; // relógio fake (ms)

function advance(ms) { __t += ms; }
function rngConst(v) { return function () { return v; }; }
var OFFICIAL_COUNT = JSON.parse(__BANK_FILE).count;

function C() { return BQ5.campaign; }
function resetAll() {
  C().abortFight();
  BQ5.storage.resetCampaignV2();
  C().setRng(null);
}
function officialBank() {
  var r = BQ5.bank.fromText(__BANK_FILE);
  assert(r.ok === true && BQ5.bank.count() === OFFICIAL_COUNT, 'fixture oficial falhou: ' + JSON.stringify(r));
}
function mkQ(id, theme, region, difficulty, answer) {
  return { id: id, theme: theme, region: region, difficulty: difficulty,
           question: 'Pergunta sintética ' + id, options: ['A', 'B', 'C', 'D'],
           answer: answer, explanation: '' };
}

// ---------- helpers de luta (driver determinístico) ----------

function revealedCard(snap) {
  for (var k = 0; k < snap.hand.length; k++) if (snap.hand[k].revealed) return snap.hand[k];
  return null;
}

/** Seleciona um cartão, verifica TOO_EARLY, avança a pausa e responde.
 *  correct=true => acerta (usa o índice certo); false => erra de propósito. */
function doHand(correct, idx) {
  var cc = C();
  assert(cc.fightSnapshot().phase === 'choosing', 'esperava fase choosing');
  var sel = cc.selectCard(idx === undefined ? 0 : idx);
  assert(sel.ok === true, 'selectCard falhou: ' + JSON.stringify(sel));
  advance(1);
  var early = cc.answer(correct ? 0 : 1); // qualquer índice: ainda na pausa => TOO_EARLY
  assert(early.ok === false && early.code === 'TOO_EARLY',
    'esperava TOO_EARLY, veio ' + JSON.stringify(early));
  advance(cc.remainingMs() + 1);
  var card = revealedCard(cc.fightSnapshot());
  assert(card && card.question, 'pergunta revelada ausente do snapshot');
  var choice = correct ? card.question.a : ((card.question.a + 1) % 4);
  return cc.answer(choice);
}

/** Aguarda o intervalo de sistema e sorteia a próxima mão. */
function nextHand() {
  var cc = C();
  if (cc.fightSnapshot().over) return { ok: false, code: 'OVER' }; // desfecho já decidido
  assert(cc.fightSnapshot().phase === 'gap', 'esperava fase gap');
  advance(1);
  if (cc.remainingMs() > 0) {
    var te = cc.nextHand();
    assert(te.ok === false && te.code === 'TOO_EARLY', 'nextHand cedo demais deveria falhar: ' + JSON.stringify(te));
  }
  advance(cc.remainingMs() + 1);
  return cc.nextHand();
}

function distinctThemes(hand) {
  var seen = {};
  for (var k = 0; k < hand.length; k++) seen[hand[k].theme] = true;
  return Object.keys(seen).length;
}

// ============================================================
// §2 — Estrutura por região/tier
// ============================================================
test('estrutura: Fácil/Padrão/Difícil com 5 pontos temáticos (10 qts) + desafio', function () {
  ['edu', 'normal', 'dificil'].forEach(function (tier) {
    var pts = C().pointsForRegion('norte', tier);
    assert(pts.length === 5, tier + ': esperava 5 pontos temáticos, veio ' + pts.length);
    BQ5.config.themes.forEach(function (th) {
      var found = false;
      for (var i = 0; i < pts.length; i++) if (pts[i].theme === th) found = true;
      assert(found, tier + ': falta eixo ' + th);
    });
    assert(C().questionsPerRegionPoints(tier) === 50, tier + ': total esperado 50');
  });
});

test('estrutura: Geógrafo com 3 pontos misturados (30 qts) por região', function () {
  var pts = C().pointsForRegion('sul', 'geografo');
  assert(pts.length === 3, 'esperava 3 pontos mistos');
  for (var i = 0; i < pts.length; i++) assert(pts[i].theme === 'all', 'ponto misto deve ter theme "all"');
  assert(C().questionsPerRegionPoints('geografo') === 30, 'total esperado 30');
});

// ============================================================
// §3 — Desbloqueio do desafio por % de acertos (50/60/70/70)
// ============================================================
function setPoints(tier, arr) {
  var pts = C().pointsForRegion('norte', tier);
  var rec = { tiers: {} };
  rec.tiers[tier] = { points: {}, bosses: {} };
  for (var i = 0; i < pts.length && i < arr.length; i++) {
    if (arr[i] > 0) rec.tiers[tier].points[pts[i].id] = { best: arr[i] };
  }
  BQ5.storage.saveCampaignV2(rec);
}

// Distribui um total de acertos em até 5 paradas (máx. 10 por parada — §4).
function dist5(n) { var o = [0, 0, 0, 0, 0], r = n; for (var i = 4; i >= 0 && r > 0; i--) { o[i] = Math.min(r, 10); r -= o[i]; } return o; }

test('desbloqueio do chefe: limiares exatos por tier (50/60/70/70%)', function () {
  var cases = [ ['edu', 50], ['normal', 60], ['dificil', 70] ];
  cases.forEach(function (cs) {
    var tier = cs[0], pct = cs[1];
    setPoints(tier, []);
    // total 50; needed = ceil(50*pct/100)
    var needed = Math.ceil(50 * pct / 100);
    var arrBelow = dist5(needed - 1); // uma parada nunca tem >10 acertos (§4)
    setPoints(tier, arrBelow);
    var p1 = C().bossUnlockProgress('norte', tier);
    assert(p1.needed === needed && p1.unlocked === false,
      tier + ': ' + (needed - 1) + '/' + needed + ' deveria estar bloqueado: ' + JSON.stringify(p1));
    setPoints(tier, dist5(needed));
    var p2 = C().bossUnlockProgress('norte', tier);
    assert(p2.unlocked === true && p2.right === needed, tier + ': ' + needed + '/' + needed + ' deveria desbloquear');
  });
  // Geógrafo: total 30, pct 70 => ceil(21) = 21
  setPoints('geografo', []);
  var g1 = C().bossUnlockProgress('norte', 'geografo');
  assert(g1.total === 30 && g1.needed === 21, 'geografo: esperado total 30/needed 21, veio ' + JSON.stringify(g1));
  setPoints('geografo', [10, 10, 1]); // soma 21 em 3 pontos mistos
  assert(C().bossUnlockProgress('norte', 'geografo').unlocked === true, 'geografo: 21/30 deve desbloquear');
});

// ============================================================
// §4 — Nova tentativa: só maior pontuação substitui; nada parcial é gravado
// ============================================================
test('nova tentativa: maior substitui; igual/inferior não altera', function () {
  resetAll();
  var r1 = C().recordStage('norte', 'normal', 'norte:cultura', { score: 700, right: 6, total: 10 });
  assert(r1.ok && r1.replaced === true && r1.point.best === 6, JSON.stringify(r1));
  var r2 = C().recordStage('norte', 'normal', 'norte:cultura', { score: 400, right: 4, total: 10 });
  assert(r2.ok && r2.replaced === false && r2.point.best === 6, 'menor não substitui: ' + JSON.stringify(r2));
  var r3 = C().recordStage('norte', 'normal', 'norte:cultura', { score: 700, right: 6, total: 10 });
  assert(r3.ok && r3.replaced === false && r3.point.best === 6, 'empate não substitui: ' + JSON.stringify(r3));
  var r4 = C().recordStage('norte', 'normal', 'norte:cultura', { score: 900, right: 8, total: 10 });
  assert(r4.ok && r4.replaced === true && r4.point.best === 8, JSON.stringify(r4));
});

test('abandonar parada não grava nada; resultado inválido é rejeitado', function () {
  resetAll();
  var before = JSON.stringify(BQ5.storage.getCampaignV2());
  // "abandono" = simplesmente não chamar recordStage: estado deve permanecer intacto
  assert(JSON.stringify(BQ5.storage.getCampaignV2()) === before, 'estado mudou sem registro');
  var bad1 = C().recordStage('norte', 'normal', 'norte:cultura', { score: 700 }); // sem right
  assert(bad1.ok === false && bad1.code === 'BAD_RESULT', JSON.stringify(bad1));
  var bad2 = C().recordStage('norte', 'normal', 'ponto:inexistente', { right: 5, total: 10 });
  assert(bad2.ok === false && bad2.code === 'BAD_POINT', JSON.stringify(bad2));
  assert(JSON.stringify(BQ5.storage.getCampaignV2()) === before, 'erro não deve gravar');
});

test('migração de registro legado {score,maxRight} => conta como acertos (best)', function () {
  resetAll();
  BQ5.storage.saveCampaignV2({ tiers: { normal: { points: { 'norte:cultura': { score: 700, maxRight: 7 } }, bosses: {} } } });
  var p = C().bossUnlockProgress('norte', 'normal');
  assert(p.right === 7, 'legado maxRight=7 deve contar como 7 acertos: ' + JSON.stringify(p));
});

// ============================================================
// §3/§1 — Desbloqueio de tiers e sequência regional
// ============================================================
test('tiers: dificil só após normal completo; geografo só após dificil', function () {
  resetAll();
  assert(C().tierUnlocked('edu') === true && C().tierUnlocked('normal') === true, 'edu/normal sempre livres');
  assert(C().tierUnlocked('dificil') === false, 'dificil bloqueado no início');
  var stages = BQ5.config.campaignStages;
  var allDone = {};
  for (var i = 0; i < stages.length; i++) allDone[stages[i]] = true;
  BQ5.storage.saveCampaignV2({ tiers: { normal: { points: {}, bosses: allDone } } });
  assert(C().tierUnlocked('dificil') === true, 'normal completo libera dificil');
  assert(C().tierUnlocked('geografo') === false, 'geografo ainda bloqueado');
  BQ5.storage.saveCampaignV2({ tiers: { normal: { points: {}, bosses: allDone }, dificil: { points: {}, bosses: allDone } } });
  assert(C().tierUnlocked('geografo') === true, 'dificil completo libera geografo');
});

test('regiões em sequência: norte -> sul por tier; chefe anterior é o gatilho', function () {
  resetAll();
  assert(C().regionUnlocked('norte', 'normal') === true, 'norte livre no normal');
  assert(C().regionUnlocked('nordeste', 'normal') === false, 'nordeste bloqueado sem chefe do norte');
  BQ5.storage.saveCampaignV2({ tiers: { normal: { points: {}, bosses: { norte: true } } } });
  assert(C().regionUnlocked('nordeste', 'normal') === true && C().regionUnlocked('centro-oeste', 'normal') === false,
    'só a região imediatamente seguinte desbloqueia');
});

// ============================================================
// §6/§8 — Luta do chefe: fluxo, tempo (não dobra), fases e relógio
// ============================================================
test('startBoss: mão de 3 temas distintos, HPs por tier, tempo = solo da dificuldade', function () {
  resetAll(); officialBank();
  C().setClock(function () { return __t; });
  var r = C().startBoss('norte', 'normal');
  assert(r.ok === true, JSON.stringify(r));
  var s = r.fight;
  assert(s.hand.length === 3 && distinctThemes(s.hand) === 3, 'mão deve ter 3 temas distintos: ' + JSON.stringify(s.hand));
  for (var k = 0; k < s.hand.length; k++) assert(!s.hand[k].question, 'carta não revelada não expõe pergunta');
  assert(s.bossHp === 1500 && s.playerHp === 1000, 'HP normal: chefe 1500 / jogador 1000');
  var solo = BQ5.config.questionTimeMs.normal;
  assert(s.limitMs === solo, 'tempo da luta deve ser o tempo SOLO do tier (' + solo + '), veio ' + s.limitMs);
  assert(s.boss.name !== null && s.boss.vulnTheme !== null, 'identidade regional presente no snapshot');
  C().abortFight();
});

test('fluxo: escolha -> pausa de revelação (3s) -> resposta; TOO_EARLY e BAD_PHASE', function () {
  resetAll(); officialBank();
  C().setClock(function () { return __t; });
  assert(C().startBoss('norte', 'normal').ok === true, 'startBoss');
  var res = doHand(true); // já valida TOO_EARLY e a pausa de revelação
  assert(res.ok === true && res.correct === true, JSON.stringify(res));
  assert(res.dealtToPlayer === 0 && res.bossHp < 1500, 'acerto causa dano ao chefe');
  var s = C().fightSnapshot();
  assert(s.phase === 'gap', 'após desfecho, fase gap (intervalo de sistema)');
  var nh = nextHand(); // valida TOO_EARLY do intervalo
  assert(nh.ok === true && C().fightSnapshot().phase === 'choosing' && distinctThemes(C().fightSnapshot().hand) === 3,
    'próxima mão com 3 temas distintos: ' + JSON.stringify(nh));
  // BAD_PHASE: responder sem escolher carta
  var bp = C().answer(0);
  assert(bp.ok === false && bp.code === 'BAD_PHASE', JSON.stringify(bp));
  C().abortFight();
});

test('limitMs/remainingMs: revelação parada conta a pausa; depois o tempo do tier', function () {
  resetAll(); officialBank();
  C().setClock(function () { return __t; });
  assert(C().startBoss('norte', 'normal').ok === true, 'startBoss');
  var sel = C().selectCard(0);
  assert(sel.ok === true && C().fightSnapshot().phase === 'revealing');
  advance(1000);
  assert(Math.abs(C().remainingMs() - (BQ5.config.campaignV2.boss.revealDelayMs - 1000)) <= 1,
    'pausa de revelação deve contar ~3000ms: ' + C().remainingMs());
  advance(BQ5.config.campaignV2.boss.revealDelayMs - 1000); // completa a pausa (já avançamos 1000ms)
  var solo = BQ5.config.questionTimeMs.normal;
  assert(Math.abs(C().remainingMs() - solo) <= 1, 'após a pausa o relógio é o tempo do tier: ' + C().remainingMs());
  C().abortFight();
});

// ============================================================
// §8.4 — Strike (acertos consecutivos): 1.0/1.1/1.2/1.3, sem vulnerável
// ============================================================
test('strike: dano ao chefe cresce por acerto consecutivo e zerra no erro', function () {
  resetAll(); officialBank();
  C().setClock(function () { return __t; });
  C().setRng(rngConst(0.99)); // rolagem de vulnerabilidade nunca aciona (>=20%)
  assert(C().startBoss('norte', 'normal').ok === true, 'startBoss');
  var expected = [100, 110, 120, 130, 130]; // base 100 × {1.0,1.1,1.2,1.3,1.3}
  for (var h = 0; h < 5; h++) {
    var res = doHand(true);
    assert(res.ok === true && res.correct === true, 'mão ' + (h + 1) + ': ' + JSON.stringify(res));
    assert(res.dealtToBoss === expected[h],
      'mão ' + (h + 1) + ': dano esperado ' + expected[h] + ', veio ' + res.dealtToBoss);
    assert(res.strike === h + 1, 'strike deveria ser ' + (h + 1));
    nextHand(); // intervalo de sistema -> próxima mão
  }
  var before = C().fightSnapshot();
  var wrong = doHand(false);
  assert(wrong.ok === true && wrong.correct === false && wrong.strike === 0, 'erro zera o strike: ' + JSON.stringify(wrong));
  assert(wrong.dealtToPlayer === BQ5.config.campaignV2.boss.danoAoJogador.normal, 'dano fixo ao jogador (padrão)');
  nextHand();
  var next = doHand(true);
  assert(next.strike === 1 && next.dealtToBoss === expected[0], 'após erro o strike recomeça em 1');
  C().abortFight();
});

// ============================================================
// §8.3 — Vulnerabilidade: 20% por mão, exatamente uma carta do tema fraco
// ============================================================
test('vulnerabilidade NÃO acionada (rng>=0.2): nenhuma carta vulnerável em 10 mãos', function () {
  resetAll(); officialBank();
  C().setClock(function () { return __t; });
  C().setRng(rngConst(0.99));
  assert(C().startBoss('norte', 'normal').ok === true, 'startBoss');
  for (var h = 0; h < 10; h++) {
    var s = C().fightSnapshot();
    var vulns = 0;
    for (var k = 0; k < s.hand.length; k++) if (s.hand[k].vulnerable) vulns++;
    assert(vulns === 0, 'mão ' + (h + 1) + ': rolagem alta não deve acionar vulnerabilidade');
    doHand(true);
    nextHand();
  }
  C().abortFight();
});

test('vulnerabilidade SEMPRE acionada (rng<0.2): exatamente uma carta do tema fraco; bônus +0,5', function () {
  resetAll(); officialBank();
  C().setClock(function () { return __t; });
  C().setRng(rngConst(0.01));
  var r = C().startBoss('norte', 'normal');
  assert(r.ok === true, JSON.stringify(r));
  var vulnTheme = BQ5.config.campaignV2.bosses.norte.vulnTheme;
  for (var h = 0; h < 8; h++) {
    var s = C().fightSnapshot();
    var vulns = [], idxVuln = -1;
    for (var k = 0; k < s.hand.length; k++) {
      if (s.hand[k].vulnerable) { vulns.push(s.hand[k]); idxVuln = k; }
    }
    assert(vulns.length === 1, 'mão ' + (h + 1) + ': exatamente UMA carta vulnerável');
    assert(idxVuln >= 0 && s.hand[idxVuln].theme === vulnTheme, 'carta vulnerável deve ser do tema fraco (' + vulnTheme + ')');
    // as outras duas: temas distintos entre si e diferentes do vulnerável
    var others = [];
    for (var m = 0; m < s.hand.length; m++) if (m !== idxVuln) others.push(s.hand[m].theme);
    assert(others[0] !== others[1] && others[0] !== vulnTheme && others[1] !== vulnTheme,
      'demais cartas com temas distintos e diferentes do vulnerável: ' + JSON.stringify(others));
    if (h === 0) {
      // acerta A carta vulnerável: dano = base × (strike 1.0 + bônus 0,5)
      var res = doHand(true, idxVuln);
      assert(res.ok && res.correct && res.dealtToBoss === Math.round(100 * 1.5),
        'carta vulnerável deve dar base×1.5: ' + JSON.stringify(res));
    } else {
      doHand(true);
    }
    nextHand();
  }
  C().abortFight();
});

// ============================================================
// §8.6 — Proteção anti-repetição (reaparecimento)
// ============================================================
test('reappearChance: tabela exata (0% próxima mão, +5pp/mão, teto 100%)', function () {
  var rc = C().reappearChance;
  assert(rc(1, 1) === 1, 'mesma mão => 1');
  assert(rc(1, 2) === 0, 'próxima mão => 0%');
  assert(Math.abs(rc(1, 3) - 0.05) < 1e-9, 'segunda mão => 5%');
  assert(Math.abs(rc(1, 4) - 0.10) < 1e-9, 'terceira mão => 10%');
  assert(Math.abs(rc(1, 21) - 0.95) < 1e-9 && rc(1, 22) === 1 && rc(1, 30) === 1,
    'teto de 100% na 21ª mão APÓS a escolha (mão absoluta c+21): ' + JSON.stringify([rc(1, 21), rc(1, 22)]));
  assert(rc(1.5, 3) === null && rc('a', 3) === null, 'entradas não inteiras => null');
});

test('proteção integrada: pergunta escolhida NUNCA reaparece na mão seguinte; mão sempre completa', function () {
  resetAll();
  var smallBank = [];
  var nq = 1; // ids inteiros (validação do banco)
  ['animais', 'cidades', 'cultura'].forEach(function (th) {
    smallBank.push(mkQ(nq++, th, 'norte', 2, 0));
    smallBank.push(mkQ(nq++, th, 'norte', 2, 1));
  });
  assert(BQ5.bank.adopt({ questions: smallBank }).ok === true, 'banco sintético');
  C().setClock(function () { return __t; });
  C().setRng(rngConst(0.5));
  var r = C().startBoss('norte', 'normal');
  assert(r.ok === true, JSON.stringify(r));
  var prevId = null, prevTheme = null, checked = 0;
  for (var h = 0; h < 8; h++) {
    var s = C().fightSnapshot();
    // com 3 temas × 2 perguntas, toda mão contém os 3 temas => o tema anterior sempre volta
    if (prevTheme) {
      var idxSame = -1;
      for (var k = 0; k < s.hand.length; k++) if (s.hand[k].theme === prevTheme) { idxSame = k; break; }
      assert(idxSame !== -1, 'mão ' + (h + 1) + ': tema anterior deveria estar presente');
      var res = doHand(true, idxSame);
      var card = revealedCard(C().fightSnapshot());
      assert(card.question.id !== prevId,
        'pergunta escolhida na mão anterior NÃO pode reaparecer na seguinte (0%): ' + card.question.id);
      checked++;
    } else {
      doHand(true);
    }
    var rev = revealedCard(C().fightSnapshot());
    prevId = rev.question.id; prevTheme = rev.theme;
    nextHand();
  }
  assert(checked >= 7, 'verificações de não-reaparecimento realizadas: ' + checked);
  C().abortFight();
});

test('proteção esgotada relaxa (nunca bloqueia): banco com 1 pergunta por tema', function () {
  resetAll();
  var tiny = [ mkQ(1, 'animais', 'norte', 2, 0), mkQ(2, 'cidades', 'norte', 2, 1), mkQ(3, 'cultura', 'norte', 2, 2) ];
  assert(BQ5.bank.adopt({ questions: tiny }).ok === true, 'banco mínimo');
  C().setClock(function () { return __t; });
  var r = C().startBoss('norte', 'normal');
  assert(r.ok === true, 'mão completa mesmo com proteção esgotada: ' + JSON.stringify(r));
  for (var h = 0; h < 5; h++) {
    doHand(true);
    var nh = nextHand();
    assert(nh.ok === true && C().fightSnapshot().hand.length === 3, 'mão sempre completa (relaxamento)');
  }
  C().abortFight();
});

// ============================================================
// §8.6/§8.7 — Checkpoint da sequência e nova tentativa
// ============================================================
test('checkpoint: chefe <=75% marca a sequência; retry começa no % exato com jogador cheio', function () {
  resetAll();
  var smallBank = [];
  var nq = 1; // ids inteiros (validação do banco)
  ['animais', 'cidades', 'cultura'].forEach(function (th) {
    smallBank.push(mkQ(nq++, th, 'norte', 2, 0));
    smallBank.push(mkQ(nq++, th, 'norte', 2, 1));
  });
  assert(BQ5.bank.adopt({ questions: smallBank }).ok === true, 'banco sintético');
  C().setClock(function () { return __t; });
  C().setRng(rngConst(0.5));
  var r = C().startBoss('norte', 'normal');
  assert(r.ok === true, JSON.stringify(r));
  var threshold = Math.round(1500 * BQ5.config.campaignV2.boss.checkpointPct.normal / 100); // 1125
  var hitCp = null;
  for (var h = 0; h < 6 && !hitCp; h++) {
    var res = doHand(true);
    if (res.over === 'win') throw new Error('chefe morreu antes do teste de checkpoint');
    if (res.checkpointHit) hitCp = res;
    else nextHand(); // intervalo de sistema entre mãos (§6)
  }
  assert(hitCp, 'checkpoint deveria ter sido atingido (limiar ' + threshold + ')');
  assert(hitCp.bossHp <= threshold, 'HP abaixo do limiar: ' + hitCp.bossHp);
  nextHand(); // checkpoint atingido durante a resposta => fase gap; volta para choosing
  // agora derrota o jogador (erros até loss)
  var guard = 0;
  while (!C().fightSnapshot().over && guard++ < 40) { doHand(false); nextHand(); }
  assert(C().fightSnapshot().over === 'loss', 'jogador deveria ter perdido');
  // retry: jogador cheio, chefe exatamente no checkpoint
  var rt = C().retry();
  assert(rt.ok === true, JSON.stringify(rt));
  var s = C().fightSnapshot();
  assert(s.playerHp === 1000, 'nova tentativa com HP cheio: ' + s.playerHp);
  assert(s.bossHp === threshold, 'chefe começa exatamente no checkpoint (' + threshold + '): ' + s.bossHp);
  assert(s.checkpointHit === true && s.phase === 'choosing', JSON.stringify({ cp: s.checkpointHit, ph: s.phase }));
  var res2 = doHand(true);
  assert(res2.strike === 1 && res2.dealtToBoss === 100, 'strike reinicia na nova tentativa');
  // sair descarta a sequência: novo startBoss volta ao HP cheio
  C().abortFight();
  var r2 = C().startBoss('norte', 'normal');
  assert(r2.ok === true && r2.fight.bossHp === 1500 && r2.fight.checkpointHit === false,
    'sair do desafio descarta o estado da sequência: ' + JSON.stringify({ hp: r2.fight.bossHp }));
  C().abortFight();
});

test('sem checkpoint atingido: retry volta com chefe a 100%', function () {
  resetAll();
  var smallBank = [];
  var nq = 7; // ids inteiros (validação do banco), distintos dos testes anteriores
  ['animais', 'cidades', 'cultura'].forEach(function (th) {
    smallBank.push(mkQ(nq++, th, 'norte', 2, 0));
    smallBank.push(mkQ(nq++, th, 'norte', 2, 1));
  });
  assert(BQ5.bank.adopt({ questions: smallBank }).ok === true, 'banco sintético');
  C().setClock(function () { return __t; });
  var r = C().startBoss('norte', 'normal');
  assert(r.ok === true, JSON.stringify(r));
  var guard = 0;
  while (!C().fightSnapshot().over && guard++ < 40) { doHand(false); nextHand(); }
  assert(C().fightSnapshot().over === 'loss' && C().fightSnapshot().checkpointHit === false, 'derrota sem checkpoint');
  var rt = C().retry();
  assert(rt.ok === true && C().fightSnapshot().bossHp === 1500, 'sem checkpoint => chefe a 100%: ' + C().fightSnapshot().bossHp);
  C().abortFight();
});

// ============================================================
// §7/§8 — Vitória: persistência isolada, próxima região, recompensa reservada
// ============================================================
test('vitória: grava chefe vencido (chave própria), indica próxima região, não toca recorde solo', function () {
  resetAll(); officialBank();
  C().setClock(function () { return __t; });
  C().setRng(rngConst(0.99)); // sem vulnerável => dano determinístico
  var soloBefore = JSON.stringify(BQ5.storage.getJSON(BQ5.config.storageKeys.bestSolo, 0));
  var r = C().startBoss('norte', 'normal');
  assert(r.ok === true, JSON.stringify(r));
  var guard = 0;
  while (!C().fightSnapshot().over && guard++ < 60) { doHand(true); nextHand(); }
  assert(C().fightSnapshot().over === 'win', 'chefe deveria ter caído');
  var cf = C().completeFight();
  assert(cf.ok === true, JSON.stringify(cf));
  assert(cf.result.over === 'win' && cf.result.reward === null, 'recompensa reservada (null): ' + JSON.stringify(cf.result));
  assert(cf.result.nextRegion === 'nordeste', 'próxima região liberada: ' + cf.result.nextRegion);
  assert(cf.result.allDone === false, 'ainda há chefes no tier');
  var data = BQ5.storage.getCampaignV2();
  assert(data.tiers.normal.bosses.norte === true, 'chefe persistido na chave da campanha v2');
  assert(C().regionUnlocked('nordeste', 'normal') === true, 'região seguinte desbloqueada');
  assert(JSON.stringify(BQ5.storage.getJSON(BQ5.config.storageKeys.bestSolo, 0)) === soloBefore, 'recorde solo não tocado');
  // estado limpo após completeFight
  assert(C().completeFight().ok === false && C().fightSnapshot() === null, 'luta encerrada e liberada');
});

// ============================================================
// §8 — Erros estruturados (sem loop, sem mão duplicada)
// ============================================================
test('startBoss: erros estruturados de conteúdo e desbloqueio', function () {
  resetAll(); officialBank();
  var r1 = C().startBoss('luna', 'normal');
  assert(r1.ok === false && r1.code === 'BAD_REGION', JSON.stringify(r1));
  var r2 = C().startBoss('norte', 'pro');
  assert(r2.ok === false && r2.code === 'BAD_TIER', JSON.stringify(r2));
  var r3 = C().startBoss('norte', 'dificil'); // tier bloqueado (estado zerado)
  assert(r3.ok === false && r3.code === 'TIER_LOCKED', JSON.stringify(r3));
  var r4 = C().startBoss('sul', 'normal'); // região fora de sequência
  assert(r4.ok === false && r4.code === 'REGION_LOCKED', JSON.stringify(r4));

  BQ5.bank.adopt({ questions: [ mkQ(1, 'animais', 'norte', 2, 0), mkQ(2, 'animais', 'norte', 2, 1) ] });
  var r5 = C().startBoss('norte', 'normal'); // <3 perguntas / <3 temas
  assert(r5.ok === false && r5.code === 'NO_QUESTIONS' && /mínimo/.test((r5.errors || []).join(' ')), JSON.stringify(r5));

  BQ5.bank.adopt({ questions: [ mkQ(1, 'animais', 'norte', 2, 0), mkQ(2, 'animais', 'norte', 2, 1), mkQ(3, 'animais', 'norte', 2, 2) ] });
  var r6 = C().startBoss('norte', 'normal'); // 3 perguntas mas 1 tema
  assert(r6.ok === false && r6.code === 'NO_QUESTIONS', JSON.stringify(r6));

  officialBank();
});

test('luta ativa: ACTIVE_FIGHT, INVALID_CHOICE, retry/completeFight em fase errada', function () {
  resetAll(); officialBank();
  C().setClock(function () { return __t; });
  assert(C().startBoss('norte', 'normal').ok === true, 'startBoss');
  var dup = C().startBoss('norte', 'normal');
  assert(dup.ok === false && dup.code === 'ACTIVE_FIGHT', JSON.stringify(dup));

  assert(C().retry().ok === false && C().retry().code === 'NOT_LOST', 'retry sem derrota');
  assert(C().completeFight().ok === false && C().completeFight().code === 'NOT_WIN', 'completeFight antes do desfecho');

  var sel = C().selectCard(0);
  assert(sel.ok === true, JSON.stringify(sel));
  advance(BQ5.config.campaignV2.boss.revealDelayMs + 1);
  var badChoice = C().answer(5);
  assert(badChoice.ok === false && badChoice.code === 'INVALID_CHOICE', JSON.stringify(badChoice));
  var badTimeout = C().answer(-2);
  assert(badTimeout.ok === false && badTimeout.code === 'INVALID_CHOICE', JSON.stringify(badTimeout));
  // primeira resposta válida (errada de propósito) => fase gap; e a segunda => BAD_PHASE
  var cardL = revealedCard(C().fightSnapshot());
  var first = C().answer(cardL.question.a === 0 ? 1 : 0);
  assert(first.ok === true && first.correct === false, 'primeira resposta válida: ' + JSON.stringify(first));
  // responder de novo a mesma questão já respondida => fase gap => BAD_PHASE
  var again = C().answer(0);
  assert(again.ok === false && again.code === 'BAD_PHASE', JSON.stringify(again));
  C().abortFight();
});

// ============================================================
// §5 — engine.stage(): pool regional por prioridade + paradas mistas com os 5 eixos
// ============================================================
function collectStageQuiz(opts) {
  var E = BQ5.engine;
  var r = E.stage(opts);
  assert(r.ok === true, 'stage falhou: ' + JSON.stringify(r));
  var qs = [];
  for (var k = 0; k < r.game.total; k++) {
    var q = E.question();
    assert(q && q.id, 'questão ausente no índice ' + k);
    qs.push(q);
    var ar = E.answer(0);
    if (!ar.last) { var nx = E.next(); assert(nx.ok === true, JSON.stringify(nx)); }
  }
  return qs;
}

test('stage temático: só questões da região+tier (fallback regional permitido)', function () {
  resetAll(); officialBank();
  var tierDs = BQ5.config.tiers.normal;
  var qs = collectStageQuiz({ region: 'norte', tier: 'normal', theme: 'animais' });
  assert(qs.length === BQ5.config.campaignV2.questionsPerPoint, 'parada com 10 questões');
  for (var k = 0; k < qs.length; k++) {
    assert(qs[k].reg === 'norte', 'questão fora da região: ' + qs[k].id);
    assert(tierDs.indexOf(qs[k].d) !== -1, 'questão fora do tier: ' + qs[k].id + ' (d=' + qs[k].d + ')');
  }
});

test('stage misto (Geógrafo): parada usa os cinco eixos da região', function () {
  resetAll(); officialBank();
  var qs = collectStageQuiz({ region: 'sul', tier: 'geografo' }); // theme padrão "all"
  assert(qs.length === BQ5.config.campaignV2.questionsPerPoint, 'parada mista com 10 questões');
  var seen = {};
  for (var k = 0; k < qs.length; k++) { seen[qs[k].t] = true; assert(qs[k].reg === 'sul', 'fora da região: ' + qs[k].id); }
  BQ5.config.themes.forEach(function (th) { assert(seen[th], 'eixo ausente na parada mista: ' + th); });
});

test('stage: erros estruturados (BAD_COUNT / NO_QUESTIONS sem outra região)', function () {
  resetAll(); officialBank();
  var E = BQ5.engine;
  var e1 = E.stage({ region: 'norte', tier: 'normal', theme: 'animais', count: 0 });
  assert(e1.ok === false && e1.code === 'BAD_COUNT', JSON.stringify(e1));
  BQ5.bank.adopt({ questions: [ mkQ(1, 'animais', 'sul', 2, 0) ] });
  var e2 = E.stage({ region: 'norte', tier: 'normal', theme: 'animais' });
  assert(e2.ok === false && e2.code === 'NO_QUESTIONS' && /GDD v1\.1 §5/.test((e2.errors || []).join(' ')), JSON.stringify(e2));
  officialBank();
});

// ---------- hub (visão por tier para a UI) ----------
test('hub: resume pontos, chefes e identidade do chefe por região', function () {
  resetAll();
  BQ5.storage.saveCampaignV2({ tiers: { normal: { points: { 'norte:cultura': { best: 9 } }, bosses: {} } } });
  var h = C().hub('normal');
  assert(h.unlocked === true && h.allDone === false, JSON.stringify({ u: h.unlocked, d: h.allDone }));
  var norte = null;
  for (var i = 0; i < h.regions.length; i++) if (h.regions[i].region === 'norte') norte = h.regions[i];
  assert(norte && norte.points.some(function (p) { return p.id === 'norte:cultura' && p.best === 9; }), 'melhor pontuação visível no hub');
  assert(norte.boss.name !== null && norte.boss.vulnTheme !== null, 'identidade do chefe no hub');
  assert(norte.bossProgress.right === 9 && norte.bossProgress.unlocked === false, JSON.stringify(norte.bossProgress));
});
