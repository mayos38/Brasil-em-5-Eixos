(function () {
  'use strict';

  var output = document.getElementById('test-output');
  var lines = [];
  var passed = 0;
  var failed = 0;

  function assert(condition, message) {
    if (!condition) throw new Error(message || 'assertion failed');
  }
  function equal(actual, expected, message) {
    assert(actual === expected, (message || 'valores diferentes') + ': esperado ' + expected + ', recebido ' + actual);
  }
  function test(name, callback) {
    try {
      callback();
      passed++;
      lines.push('PASS  ' + name);
    } catch (error) {
      failed++;
      lines.push('FAIL  ' + name + ' — ' + (error && error.message ? error.message : String(error)));
    }
  }
  function manager(pools) {
    var result = window.BQ5.hp.create({ pools: pools });
    assert(result.ok, result.message || result.code || 'não foi possível criar os pools');
    return result.manager;
  }

  if (!window.BQ5 || !BQ5.hp || typeof BQ5.hp.create !== 'function') {
    output.textContent = 'FAIL  O script do M18 não foi carregado. Confira o caminho ../js/systems/hp.js.';
    output.setAttribute('data-status', 'fail');
    return;
  }

  test('criação e consulta de pools independentes', function () {
    var hp = manager([{ id: 'player', max: 1000 }, { id: 'boss', max: 1500, current: 1125 }]);
    equal(hp.read('player').current, 1000);
    equal(hp.read('boss').current, 1125);
    equal(hp.read('boss').ratio, 0.75);
    equal(hp.read('missing'), null);
  });

  test('dano, cura e limites com valores fracionários', function () {
    var hp = manager([{ id: 'p', max: 100 }]);
    equal(hp.damage('p', 25.5).changes[0].after, 74.5);
    equal(hp.heal('p', 100).changes[0].after, 100);
    equal(hp.damage('p', 250).changes[0].after, 0);
    equal(hp.read('p').depleted, true);
  });

  test('lote simultâneo aplica dois danos a partir do mesmo estado', function () {
    var hp = manager([{ id: 'p1', max: 100 }, { id: 'p2', max: 100 }]);
    var result = hp.applyBatch([{ id: 'p1', damage: 100 }, { id: 'p2', damage: 100 }]);
    assert(result.ok);
    equal(hp.read('p1').current, 0);
    equal(hp.read('p2').current, 0);
    equal(result.changes[0].before, 100);
    equal(result.changes[1].before, 100);
  });

  test('lote inválido não altera parcialmente nenhum pool', function () {
    var hp = manager([{ id: 'p1', max: 100 }, { id: 'p2', max: 100 }]);
    var result = hp.applyBatch([{ id: 'p1', damage: 30 }, { id: 'inexistente', damage: 10 }]);
    equal(result.ok, false);
    equal(hp.read('p1').current, 100);
    equal(hp.read('p2').current, 100);
  });

  test('somas numéricas que transbordam são rejeitadas sem mutação', function () {
    var hp = manager([{ id: 'p', max: 100 }]);
    var result = hp.applyBatch([{ id: 'p', damage: Number.MAX_VALUE }, { id: 'p', damage: Number.MAX_VALUE }]);
    equal(result.ok, false);
    equal(result.code, 'BAD_AMOUNT');
    equal(hp.read('p').current, 100);
  });

  test('checkpoint do Geógrafo preserva 67% de 2.250 HP', function () {
    var bossMax = 2250;
    var checkpoint = bossMax * 0.67;
    var hp = manager([{ id: 'player', max: 1750 }, { id: 'boss', max: bossMax, current: checkpoint }]);
    equal(hp.read('player').current, 1750);
    equal(hp.read('boss').current, 1507.5);
    hp.reset({ boss: checkpoint });
    equal(hp.read('player').current, 1750);
    equal(hp.read('boss').current, 1507.5);
  });

  test('snapshot válido restaura; snapshot inválido não altera estado', function () {
    var hp = manager([{ id: 'player', max: 1000 }, { id: 'boss', max: 1500 }]);
    hp.applyBatch([{ id: 'player', damage: 56.25 }, { id: 'boss', damage: 112.5 }]);
    var snapshot = hp.snapshot();
    hp.reset();
    assert(hp.restore(snapshot).ok);
    equal(hp.read('player').current, 943.75);
    equal(hp.read('boss').current, 1387.5);
    var invalid = { schemaVersion: 1, pools: [{ id: 'player', max: 1000, current: 0 }] };
    equal(hp.restore(invalid).ok, false);
    equal(hp.read('player').current, 943.75);
  });

  test('integração M13: motor cria HP por meio de BQ5.hp', function () {
    assert(BQ5.multiplayer && BQ5.multiplayer.duel, 'duel-engine.js não carregou');
    var created = BQ5.multiplayer.duel.create({ questions: [
      { id: 1, theme: 'cultura', difficulty: 1, question: 'Q1', options: ['A', 'B', 'C', 'D'], answer: 0 },
      { id: 2, theme: 'economia', difficulty: 2, question: 'Q2', options: ['A', 'B', 'C', 'D'], answer: 1 },
      { id: 3, theme: 'animais', difficulty: 3, question: 'Q3', options: ['A', 'B', 'C', 'D'], answer: 2 }
    ], random: function () { return 0.25; } });
    assert(created.ok, created.message || created.code);
    var players = created.game.players();
    equal(players.length, 2);
    equal(players[0].hp, 1000);
    equal(players[0].hpMax, 1000);
    equal(players[1].hp, 1000);
    equal(players[1].hpRatio, 1);
  });

  lines.unshift('Resultado: ' + passed + ' aprovados; ' + failed + ' falhas; ' + (passed + failed) + ' testes.');
  output.textContent = lines.join('\n');
  output.setAttribute('data-status', failed ? 'fail' : 'pass');
})();
