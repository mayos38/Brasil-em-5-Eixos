/* ============================================================
 * Suíte V8 do MÓDULO 11 — js/screens/results.js
 * Roda em V8 real via py-mini-racer (tests/run_results_v8.py), usando os
 * módulos REAIS config/util/storage/bank/engine e as telas reais de setup
 * e play. O Node não está disponível no ambiente; este runner é o
 * equivalente de tests/run_results.js.
 * Cobre: render solo, revisão com explicações, desempenho por eixo,
 * histórico ≤ 60 idempotente via storage.getJSON/setJSON, replay→setup.start()
 * real e desfecho multiplayer somente com dado explícito.
 * ============================================================ */

var __r11Expected = null; // score da partida real (partilhado entre testes)
var __r11SyntheticReview = [
  { q: { txt: 'Quest\u00e3o sintética 1', o: ['A', 'B', 'C', 'D'], a: 0, e: 'Explica\u00e7\u00e3o síntese.', t: 'cultura' }, choice: 0, ok: true },
  { q: { txt: 'Quest\u00e3o sintética 2', o: ['A', 'B', 'C', 'D'], a: 1, e: 'Explica\u00e7\u00e3o síntese 2.', t: 'economia' }, choice: 2, ok: false }
];

function clickChoice(choice) {
  var option = __r11OptionsRoot.children[choice];
  __r11OptionsRoot.fire('click', { target: option });
}

test('partida solo real termina e a tela de resultados renderiza pontuação, acertos e aproveitamento', function () {
  BQ5.screens.setup.select('theme', 'cultura');
  assert(BQ5.screens.setup.changeCount(-7) === true, 'não reduziu o count para 3');
  var st = BQ5.screens.setup.state();
  assert(st.count === 3 && st.theme === 'cultura' && st.diff === 'normal', JSON.stringify(st));
  var started = BQ5.screens.setup.start();
  assert(started.ok === true, JSON.stringify(started));
  assert(__r11CurrentScreen() === 'play', 'tela play não abriu');

  // q1 correta, q2 errada, q3 correta — relógio congelado => bônus sempre no teto (7)
  var correctFlags = [true, false, true];
  var played = [];
  for (var i = 0; i < 3; i++) {
    assert(BQ5.engine.state().index === i, 'fluxo divergiu: índice ' + BQ5.engine.state().index);
    var wantCorrect = correctFlags[i];
    var q = BQ5.engine.question();
    assert(q && typeof q.a === 'number', 'questão ausente na posição ' + i);
    clickChoice(wantCorrect ? q.a : ((q.a === 0) ? 1 : 0));
    assert(BQ5.screens.play.state().selectedChoice !== null, 'opção não foi selecionada');
    BQ5.ui.emitAction('next', {}); // confirma a resposta (engine.locked)
    played.push({ q: q, ok: wantCorrect });
    if (i < 2) {
      BQ5.ui.emitAction('next', {}); // avança para a questão seguinte
      assert(BQ5.screens.play.state().stage === 'choosing', 'questão ' + (i + 1) + ' não abriu seleção');
    }
  }
  BQ5.ui.emitAction('next', {}); // avança => finaliza e o M11 abre os resultados

  assert(__r11CurrentScreen() === 'results', 'tela de resultados não abriu');
  assert(BQ5.engine.state().finished === true, 'partida não finalizou');
  __r11Expected = played.reduce(function (s, p) { return s + (p.ok ? BQ5.config.pointsBase[p.q.d] + 7 : 0); }, 0);
  assert(__r11Expected > 0, 'score esperado deveria ser positivo');
  var res = BQ5.engine.result();
  assert(res && res.mode === 'solo' && res.total === 3 && res.right === 2 && res.pct === 67,
         'resultado oficial divergente: ' + JSON.stringify({ score: res.score, right: res.right, pct: res.pct }));
  assert(__r11UI.el('#results-title').textContent === 'Resultado da partida', 'título solo incorreto');
  assert(__r11UI.el('#results-score').textContent === String(res.score), 'pontuação renderizada diverge do engine');
  assert(String(__r11Expected) === String(res.score), 'score esperado (relógio congelado) diverge: ' + __r11Expected);
  assert(__r11UI.el('#results-right').textContent === '2', 'acertos incorretos');
  assert(__r11UI.el('#results-errors').textContent === '1', 'erros incorretos');
  assert(__r11UI.el('#results-total').textContent === '3', 'total incorreto');
  assert(__r11UI.el('#results-pct').textContent === '67%', 'aproveitamento incorreto');
  assert(__r11UI.el('#results-record').hidden === false, 'novo recorde não foi exibido');
});

test('revisão apresenta enunciado, resposta escolhida, gabarito e explicação', function () {
  var list = __r11UI.el('#results-review');
  assert(list.children.length === 3, 'esperava 3 cartões de revisão, veio ' + list.children.length);
  var review = BQ5.engine.review();
  for (var i = 0; i < 3; i++) {
    var card = list.children[i];
    var entry = review[i];
    assert(card.querySelector('.bq5-review__q').textContent.indexOf('Quest\u00e3o') >= 0, 'enunciado ausente no cartão ' + i);
    var chosenText = card.querySelector('[data-role="chosen"]').textContent;
    if (entry.choice === -1) assert(chosenText === 'Tempo esgotado', 'timeout não foi explicado: ' + chosenText);
    else assert(chosenText === entry.q.o[entry.choice], 'escolha divergente no cartão ' + i + ': ' + chosenText);
    var correctText = card.querySelector('[data-role="correct"]').textContent;
    assert(correctText === entry.q.o[entry.q.a], 'gabarito divergente no cartão ' + i);
    assert(card.querySelector('.bq5-review__expl').textContent.indexOf('Explica\u00e7\u00e3o:') === 0, 'explicação ausente no cartão ' + i);
    assert(card.getAttribute('data-ok') === (entry.ok ? 'true' : 'false'), 'data-ok divergente no cartão ' + i);
  }
});

test('desempenho por eixo agrega acertos/erros do resultado real', function () {
  var items = __r11UI.el('#results-performance').children;
  assert(items.length === 1, 'esperava um único eixo (cultura), veio ' + items.length);
  assert(items[0].children[0].textContent === 'Cultura', 'nome do eixo incorreto: ' + items[0].children[0].textContent);
  var value = items[0].children[1].textContent;
  assert(value.indexOf('2/3') >= 0 && value.indexOf('67%') >= 0, 'estatística do eixo divergente: ' + value);
});

test('histórico registra via storage.getJSON/setJSON, é idempotente e limita a 60', function () {
  var raw = BQ5.storage.getJSON('bq5_match_history_v1', []);
  assert(Array.isArray(raw) && raw.length === 1, 'storage não guarda o histórico na chave padrão: ' + JSON.stringify(raw));
  var h = BQ5.screens.results.getHistory();
  assert(h.length === 1, 'partida real não registrada no histórico');
  assert(h[0].mode === 'solo' && h[0].score === __r11Expected && h[0].wrong === 1 && h[0].total === 3,
         'resumo do histórico divergente: ' + JSON.stringify(h[0]));
  assert(Array.isArray(h[0].performance) && h[0].performance.length === 1 &&
         h[0].performance[0].axis === 'cultura' && h[0].performance[0].right === 2,
         'desempenho por eixo não gravado: ' + JSON.stringify(h[0].performance));

  // Idempotência: reabrir a tela da MESMA partida (sem novo game:started) não duplica.
  var shown = BQ5.screens.results.show(BQ5.engine.result());
  assert(shown.ok === true, JSON.stringify(shown));
  assert(BQ5.screens.results.getHistory().length === 1, 'duplicou a partida ao reabrir a tela');
  assert(BQ5.screens.results.state().recorded === true, 'estado recorded não foi marcado');

  // Teto de 60 entradas (mais novas primeiro), gravado via setJSON real.
  for (var i = 1; i <= 60; i++) {
    BQ5.ui.emit('game:started', {});
    var r = BQ5.screens.results.show({ mode: 'solo', score: 100 + i, right: 1, total: 3 });
    assert(r.ok === true, 'show falhou na iteração ' + i); // o retorno é do showScreen
  }
  var h2 = BQ5.screens.results.getHistory();
  assert(h2.length === 60, 'teto de 60 violado: ' + h2.length);
  assert(BQ5.screens.results.state().historyCount === 60, 'state().historyCount divergente');
  assert(h2[0].score === 160, 'ordem mais-nova-primeiro violada: ' + h2[0].score);
  var foundOld = false;
  for (var k = 0; k < h2.length; k++) { if (h2[k].score === __r11Expected) { foundOld = true; break; } }
  assert(!foundOld, 'partida antiga deveria ter sido descartada pelo teto');
  assert(BQ5.screens.results.getHistory(5).length === 5, 'limite de consulta ignorado');
});

test('replay solo reinicia a partida através do módulo 9 (setup.start real)', function () {
  var r = BQ5.screens.results.replay();
  assert(r && r.ok === true, 'setup.start não iniciou nova partida: ' + JSON.stringify(r));
  assert(__r11CurrentScreen() === 'play', 'tela play não reabriu');
  var st = BQ5.engine.state();
  assert(st && st.mode === 'solo' && st.total === 3 && st.finished === false,
         'nova partida deveria usar a configuração do setup: ' + JSON.stringify(st));
  assert(BQ5.screens.play.state().stage === 'choosing', 'primeira questão não liberou seleção');
});

test('1x1 com desfecho explícito de derrota exibe "Você perdeu", ranking e grava o desfecho', function () {
  var result = { mode: '1v1', score: 75, right: 2, total: 3, outcome: 'loss',
                 playerId: 'p1', winnerId: 'p2', review: __r11SyntheticReview,
                 players: [ { id: 'p1', name: 'Você', score: 75, rank: 2 },
                            { id: 'p2', name: 'Rival', score: 100, rank: 1 } ] };
  BQ5.ui.emit('game:started', {});
  var shown = BQ5.screens.results.show(result);
  assert(shown.ok === true, JSON.stringify(shown));
  assert(__r11UI.el('#results-title').textContent === 'Você perdeu', 'não exibiu o estado de derrota');
  assert(__r11UI.el('#screen-results').getAttribute('data-outcome') === 'loss', 'data-outcome divergente');
  assert(__r11UI.el('#results-context').textContent.indexOf('Confronto 1x1') >= 0, 'contexto do modo ausente');
  var ranking = __r11UI.el('#results-ranking').children;
  assert(ranking.length === 2, 'ranking 1x1 não foi renderizado: ' + ranking.length);
  assert(ranking[0].querySelector('.bq5-ranking__name').textContent === 'Rival', 'maior posição/pontuação deveria vir primeiro');
  var h = BQ5.screens.results.getHistory();
  assert(h[0].outcome === 'loss' && h[0].players.length === 2,
         'desfecho/players não gravados no histórico: ' + JSON.stringify({ outcome: h[0].outcome, players: h[0].players }));
});

test('multiplayer com vitória explícita exibe Vitória e delega replay por evento', function () {
  var result = { mode: 'multiplayer', score: 150, right: 3, total: 3, outcome: 'win', review: __r11SyntheticReview };
  BQ5.ui.emit('game:started', {});
  var shown = BQ5.screens.results.show(result);
  assert(shown.ok === true && __r11UI.el('#results-title').textContent === 'Vitória', 'não exibiu Vitória');
  var delegated = 0;
  var off = BQ5.ui.on('results:replay', function () { delegated++; });
  var r = BQ5.screens.results.replay();
  assert(r && r.ok === true && r.delegated === true, 'replay não foi delegado para o modo multiplayer: ' + JSON.stringify(r));
  assert(delegated === 1, 'evento results:replay não foi emitido');
  assert(__r11CurrentScreen() === 'results', 'replay multiplayer não deve abrir o setup solo');
  off();
});

test('resultado multiplayer sem desfecho explícito NÃO inventa vitória/derrota', function () {
  var result = { mode: '1v1', score: 90, right: 2, total: 3, review: __r11SyntheticReview };
  BQ5.ui.emit('game:started', {});
  BQ5.screens.results.show(result);
  assert(__r11UI.el('#results-title').textContent === 'Resultado da partida', 'inferiu desfecho sem dado explícito');
  assert(__r11UI.el('#screen-results').getAttribute('data-outcome') === 'neutral', 'data-outcome deveria ser neutral');
});

test('retorno ao menu usa a navegação central da UI', function () {
  var r = BQ5.screens.results.toMenu();
  assert(r && r.ok === true, JSON.stringify(r));
  assert(__r11CurrentScreen() === 'menu', 'não retornou ao menu');
});