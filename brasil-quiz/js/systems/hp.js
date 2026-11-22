/* ============================================================
 * Brasil em 5 Eixos — Módulo 18: Sistema de HP
 *
 * Serviço genérico de pools de vida. Não conhece Campanha, Blitz,
 * Multiplayer, perguntas, dificuldade, combate, checkpoint, DOM,
 * rede ou persistência.
 *
 * Cada modalidade cria uma instância com seus próprios identificadores,
 * máximos e valores iniciais. As regras de quando/quanta vida alterar
 * continuam pertencendo à modalidade consumidora.
 *
 * Capacidades:
 * - múltiplos pools independentes por instância;
 * - dano, cura e definição explícita de HP atual;
 * - aplicação atômica de vários efeitos (mesma fotografia inicial);
 * - clamp em [0, máximo], inclusive para dano/cura fracionários;
 * - leitura, reset, snapshot e restore validados.
 *
 * O módulo não persiste estado. A Campanha deve descartar a instância de
 * uma luta abandonada; seu checkpoint temporário pertence à regra M12.
 * ============================================================ */
(function (global) {
  'use strict';

  var VERSION = 1;

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }
  function isFiniteNumber(value) {
    return typeof value === 'number' && isFinite(value);
  }
  function validAmount(value) {
    return isFiniteNumber(value) && value >= 0;
  }
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }
  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }
  function fail(code, message) {
    return { ok: false, code: code, message: message };
  }
  function poolView(pool) {
    return {
      id: pool.id,
      current: pool.current,
      max: pool.max,
      ratio: pool.max > 0 ? pool.current / pool.max : 0,
      depleted: pool.current <= 0,
      full: pool.current >= pool.max
    };
  }

  function create(options) {
    options = options || {};
    var definitions = options.pools;
    if (!Array.isArray(definitions) || !definitions.length) {
      return fail('BAD_POOLS', 'Informe ao menos um pool de HP.');
    }

    var pools = Object.create(null);
    var ids = [];
    for (var i = 0; i < definitions.length; i++) {
      var definition = definitions[i];
      if (!isObject(definition) || typeof definition.id !== 'string' || !definition.id.trim()) {
        return fail('BAD_POOL_ID', 'Cada pool precisa de um identificador textual.');
      }
      var id = definition.id.trim();
      if (Object.prototype.hasOwnProperty.call(pools, id)) {
        return fail('DUPLICATE_POOL', 'Identificador de pool duplicado: ' + id + '.');
      }
      if (!isFiniteNumber(definition.max) || definition.max <= 0) {
        return fail('BAD_MAX', 'O HP máximo de ' + id + ' precisa ser maior que zero.');
      }
      var current = definition.current == null ? definition.max : definition.current;
      if (!isFiniteNumber(current) || current < 0 || current > definition.max) {
        return fail('BAD_CURRENT', 'O HP atual de ' + id + ' precisa estar entre zero e o máximo.');
      }
      pools[id] = { id: id, current: current, max: definition.max };
      ids.push(id);
    }

    function getPool(id) {
      return Object.prototype.hasOwnProperty.call(pools, id) ? pools[id] : null;
    }
    function read(id) {
      var pool = getPool(id);
      return pool ? poolView(pool) : null;
    }
    function all() {
      return ids.map(function (id) { return poolView(pools[id]); });
    }
    function applyBatch(effects) {
      if (!Array.isArray(effects) || !effects.length) {
        return fail('BAD_BATCH', 'Informe ao menos um efeito de HP.');
      }

      // Pré-valida todo o lote antes de qualquer mutação: falha é atômica.
      var totals = Object.create(null);
      var touched = [];
      for (var i = 0; i < effects.length; i++) {
        var effect = effects[i];
        if (!isObject(effect) || typeof effect.id !== 'string' || !effect.id.trim()) {
          return fail('BAD_EFFECT', 'Cada efeito precisa indicar um pool.');
        }
        var id = effect.id.trim();
        if (!getPool(id)) return fail('UNKNOWN_POOL', 'Pool de HP desconhecido: ' + id + '.');
        var hasDamage = Object.prototype.hasOwnProperty.call(effect, 'damage');
        var hasHeal = Object.prototype.hasOwnProperty.call(effect, 'heal');
        if (!hasDamage && !hasHeal) return fail('EMPTY_EFFECT', 'Informe dano e/ou cura para ' + id + '.');
        var damage = hasDamage ? effect.damage : 0;
        var heal = hasHeal ? effect.heal : 0;
        if (!validAmount(damage) || !validAmount(heal)) {
          return fail('BAD_AMOUNT', 'Dano e cura precisam ser números finitos não negativos.');
        }
        if (!totals[id]) {
          totals[id] = { id: id, damage: 0, heal: 0 };
          touched.push(id);
        }
        totals[id].damage += damage;
        totals[id].heal += heal;
        if (!isFiniteNumber(totals[id].damage) || !isFiniteNumber(totals[id].heal)) {
          return fail('BAD_AMOUNT', 'A soma de dano/cura excedeu o limite numérico suportado.');
        }
      }

      var changes = [];
      // Calcula todos os resultados usando o estado anterior de cada pool.
      touched.forEach(function (id) {
        var pool = pools[id];
        var total = totals[id];
        var before = pool.current;
        var after = clamp(before - total.damage + total.heal, 0, pool.max);
        changes.push({
          id: id,
          before: before,
          after: after,
          max: pool.max,
          requestedDamage: total.damage,
          requestedHeal: total.heal,
          delta: after - before,
          ratio: pool.max > 0 ? after / pool.max : 0,
          depleted: after <= 0
        });
      });
      changes.forEach(function (change) { pools[change.id].current = change.after; });
      return { ok: true, changes: clone(changes), pools: all() };
    }

    var manager = {
      version: VERSION,
      has: function (id) { return !!getPool(id); },
      read: read,
      all: all,
      damage: function (id, amount) {
        return applyBatch([{ id: id, damage: amount }]);
      },
      heal: function (id, amount) {
        return applyBatch([{ id: id, heal: amount }]);
      },
      setCurrent: function (id, value) {
        var pool = getPool(id);
        if (!pool) return fail('UNKNOWN_POOL', 'Pool de HP desconhecido: ' + id + '.');
        if (!isFiniteNumber(value)) return fail('BAD_CURRENT', 'O HP atual precisa ser um número finito.');
        var before = pool.current;
        var after = clamp(value, 0, pool.max);
        pool.current = after;
        return { ok: true, pool: read(id), before: before, requested: value, changed: after !== before };
      },
      applyBatch: applyBatch,
      reset: function (valuesById) {
        if (valuesById != null && !isObject(valuesById)) {
          return fail('BAD_RESET', 'Os valores do reset precisam ser um objeto por identificador.');
        }
        var next = Object.create(null);
        var keys = valuesById ? Object.keys(valuesById) : [];
        for (var i = 0; i < keys.length; i++) {
          var id = keys[i];
          if (!getPool(id)) return fail('UNKNOWN_POOL', 'Pool de HP desconhecido: ' + id + '.');
          if (!isFiniteNumber(valuesById[id])) return fail('BAD_CURRENT', 'O HP de ' + id + ' precisa ser um número finito.');
          next[id] = clamp(valuesById[id], 0, pools[id].max);
        }
        ids.forEach(function (id) {
          pools[id].current = Object.prototype.hasOwnProperty.call(next, id) ? next[id] : pools[id].max;
        });
        return { ok: true, pools: all() };
      },
      snapshot: function () {
        return {
          schemaVersion: VERSION,
          pools: ids.map(function (id) {
            return { id: id, max: pools[id].max, current: pools[id].current };
          })
        };
      },
      restore: function (snapshot) {
        if (!isObject(snapshot) || snapshot.schemaVersion !== VERSION || !Array.isArray(snapshot.pools) || snapshot.pools.length !== ids.length) {
          return fail('BAD_SNAPSHOT', 'Snapshot de HP inválido ou incompatível.');
        }
        var restored = Object.create(null);
        for (var i = 0; i < snapshot.pools.length; i++) {
          var item = snapshot.pools[i];
          if (!isObject(item) || typeof item.id !== 'string' || !getPool(item.id)) {
            return fail('BAD_SNAPSHOT_POOL', 'O snapshot contém um pool desconhecido.');
          }
          var existing = pools[item.id];
          if (Object.prototype.hasOwnProperty.call(restored, item.id) || item.max !== existing.max ||
              !isFiniteNumber(item.current) || item.current < 0 || item.current > existing.max) {
            return fail('BAD_SNAPSHOT_POOL', 'O snapshot contém valores incompatíveis para ' + item.id + '.');
          }
          restored[item.id] = item.current;
        }
        // Restaura apenas depois de validar o snapshot inteiro.
        ids.forEach(function (id) { pools[id].current = restored[id]; });
        return { ok: true, pools: all() };
      }
    };

    return { ok: true, manager: manager };
  }

  global.BQ5 = global.BQ5 || {};
  global.BQ5.hp = {
    version: VERSION,
    create: create
  };
})(globalThis);
