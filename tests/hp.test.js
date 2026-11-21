'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const context = { console, Math, Date, JSON, Number, String, Array, Object, isFinite };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/systems/hp.js'), 'utf8'), context);
const hpApi = context.BQ5.hp;

function make(pools) {
  const result = hpApi.create({ pools });
  assert.equal(result.ok, true, result.message);
  return result.manager;
}

// Validation: required pools, valid identifiers, unique identifiers and bounds.
assert.equal(hpApi.create({}).code, 'BAD_POOLS');
assert.equal(hpApi.create({ pools: [{ id: 'x', max: 0 }] }).code, 'BAD_MAX');
assert.equal(hpApi.create({ pools: [{ id: 'x', max: 10 }, { id: 'x', max: 10 }] }).code, 'DUPLICATE_POOL');
assert.equal(hpApi.create({ pools: [{ id: 'x', max: 10, current: 11 }] }).code, 'BAD_CURRENT');

// Independent pools, initialization defaults, ratios and depletion state.
{
  const hp = make([{ id: 'player', max: 1000 }, { id: 'boss', max: 1500, current: 1125 }]);
  assert.deepEqual({ current: hp.read('player').current, max: hp.read('player').max, ratio: hp.read('player').ratio },
    { current: 1000, max: 1000, ratio: 1 });
  assert.equal(hp.read('boss').ratio, 0.75);
  assert.equal(hp.read('missing'), null);
  assert.equal(hp.all().length, 2);
}

// Damage and healing are clamped to zero/max, with decimals supported.
{
  const hp = make([{ id: 'p', max: 100 }]);
  assert.equal(hp.damage('p', 25.5).changes[0].after, 74.5);
  assert.equal(hp.heal('p', 100).changes[0].after, 100);
  assert.equal(hp.damage('p', 250).changes[0].after, 0);
  assert.equal(hp.read('p').depleted, true);
  assert.equal(hp.heal('p', 12.25).changes[0].after, 12.25);
  assert.equal(hp.read('p').ratio, 0.1225);
}

// Simultaneous batch uses a single pre-resolution state and handles double KO.
{
  const hp = make([{ id: 'p1', max: 100, current: 100 }, { id: 'p2', max: 100, current: 100 }]);
  const result = hp.applyBatch([{ id: 'p1', damage: 100 }, { id: 'p2', damage: 100 }]);
  assert.equal(result.ok, true);
  assert.equal(hp.read('p1').current, 0);
  assert.equal(hp.read('p2').current, 0);
  assert.ok(result.changes.every(change => change.before === 100 && change.after === 0));
}

// A batch is atomic: an invalid later effect must not apply an earlier one.
{
  const hp = make([{ id: 'p1', max: 100 }, { id: 'p2', max: 100 }]);
  const result = hp.applyBatch([{ id: 'p1', damage: 30 }, { id: 'missing', damage: 30 }]);
  assert.equal(result.ok, false);
  assert.equal(hp.read('p1').current, 100);
  assert.equal(hp.read('p2').current, 100);
}

// Duplicate effects are aggregated by pool before the clamp is applied.
{
  const hp = make([{ id: 'p', max: 100, current: 50 }]);
  const result = hp.applyBatch([{ id: 'p', damage: 30 }, { id: 'p', heal: 10 }, { id: 'p', damage: 5 }]);
  assert.equal(result.ok, true);
  assert.equal(hp.read('p').current, 25);
}

// Overflow in an aggregate is rejected atomically, even when each input is finite.
{
  const hp = make([{ id: 'p1', max: 100 }, { id: 'p2', max: 100 }]);
  const result = hp.applyBatch([
    { id: 'p1', damage: Number.MAX_VALUE },
    { id: 'p1', damage: Number.MAX_VALUE },
    { id: 'p2', damage: 10 }
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'BAD_AMOUNT');
  assert.equal(hp.read('p1').current, 100);
  assert.equal(hp.read('p2').current, 100);
}

// setCurrent clamps, reset restores full pools by default, and selective reset works.
{
  const hp = make([{ id: 'player', max: 1750 }, { id: 'boss', max: 2250 }]);
  assert.equal(hp.setCurrent('boss', -10).pool.current, 0);
  assert.equal(hp.setCurrent('boss', 99999).pool.current, 2250);
  hp.damage('player', 500);
  hp.damage('boss', 300);
  const reset = hp.reset({ boss: 1507.5 });
  assert.equal(reset.ok, true);
  assert.equal(hp.read('player').current, 1750);
  assert.equal(hp.read('boss').current, 1507.5);
}

// Campanha GDD v1.1 parameters fit independent player/boss pools, including
// fractional checkpoint HP in Geógrafo (2250 × 0.67 = 1507.5).
{
  const campaign = {
    facil: { player: 1000, boss: 1000, checkpoint: 0.75 },
    padrao: { player: 1000, boss: 1500, checkpoint: 0.75 },
    dificil: { player: 1500, boss: 2000, checkpoint: 0.75 },
    geografo: { player: 1750, boss: 2250, checkpoint: 0.67 }
  };
  for (const config of Object.values(campaign)) {
    const start = config.boss * config.checkpoint;
    const hp = make([
      { id: 'player', max: config.player },
      { id: 'boss', max: config.boss, current: start }
    ]);
    assert.equal(hp.read('player').current, config.player);
    assert.equal(hp.read('boss').current, start);
    assert.equal(hp.read('boss').max, config.boss);
  }
}

// Snapshots are serializable, validated, and restored atomically.
{
  const hp = make([{ id: 'player', max: 1000 }, { id: 'boss', max: 1500 }]);
  hp.applyBatch([{ id: 'player', damage: 56.25 }, { id: 'boss', damage: 112.5 }]);
  const snapshot = hp.snapshot();
  hp.reset();
  assert.equal(hp.restore(snapshot).ok, true);
  assert.equal(hp.read('player').current, 943.75);
  assert.equal(hp.read('boss').current, 1387.5);
  const invalid = { schemaVersion: 1, pools: [{ id: 'player', max: 1000, current: 0 }] };
  assert.equal(hp.restore(invalid).ok, false);
  assert.equal(hp.read('player').current, 943.75, 'invalid restore must not partially mutate');
}

console.log('M18 HP: todos os testes passaram.');
