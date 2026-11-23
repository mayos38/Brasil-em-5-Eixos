/* ============================================================
 * Brasil em 5 Eixos — Módulo 18: Sistema de HP (js/hp.js)
 * Responsabilidade: pontos de vida e dano por dificuldade. Lógica pura:
 * sem DOM, sem timers, sem rede, sem storage. Base do Multiplayer 1x1
 * (modo alternativo) e, no futuro, do Blitz e das Paradas de Desafio.
 *
 * Regras de dano (parâmetros padrão, ajustáveis em BQ5.config.hp):
 *   dano = baseDamage × multiplicador da dificuldade da pergunta
 *   dificuldade 1 (Fácil)    0,5x ->  50
 *   dificuldade 2 (Padrão)   1x   -> 100
 *   dificuldade 3 (Difícil)  1,5x -> 150
 *   dificuldade 4 (Geógrafo) 2x   -> 200
 * A VELOCIDADE DA RESPOSTA NÃO ENTRA NO DANO.
 *
 * API (BQ5.hp):
 *   settings()                 -> { max, baseDamage, multipliers } (padrão + config.hp)
 *   damageFor(difficulty)      -> inteiro
 *   level(ratio)               -> 'ok' | 'warn' | 'danger'
 *   create({ ids:[...], max? }) -> instância:
 *       get(id) / ratio(id) / level(id) / isDead(id)
 *       damage(id, amount)     -> { ok, before, after, dealt }   (nunca abaixo de 0)
 *       heal(id, amount)       -> { ok, before, after, healed }  (nunca acima do máximo)
 *       resolve(roundsOver)    -> id vencedor | 'draw' | null (ainda sem desfecho)
 *       snapshot() / restore(snap) / reset()
 *
 * resolve(): com UM jogador a 0, vence o outro; com TODOS a 0, 'draw';
 * sem ninguém a 0 só decide quando roundsOver === true (maior HP vence;
 * HP igual => 'draw'); caso contrário retorna null.
 * ============================================================ */
(function (global) {
  'use strict';

  var BQ5 = global.BQ5 = global.BQ5 || {};

  var DEFAULTS = {
    max: 1000,
    baseDamage: 100,
    multipliers: { 1: 0.5, 2: 1, 3: 1.5, 4: 2 }
  };

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  function settings() {
    var custom = (BQ5.config && BQ5.config.hp) || {};
    var multipliers = {};
    Object.keys(DEFAULTS.multipliers).forEach(function (key) { multipliers[key] = DEFAULTS.multipliers[key]; });
    if (custom.multipliers && typeof custom.multipliers === 'object') {
      Object.keys(custom.multipliers).forEach(function (key) {
        if (isNum(custom.multipliers[key]) && custom.multipliers[key] >= 0) multipliers[key] = custom.multipliers[key];
      });
    }
    return {
      max: isNum(custom.max) && custom.max > 0 ? Math.floor(custom.max) : DEFAULTS.max,
      baseDamage: isNum(custom.baseDamage) && custom.baseDamage >= 0 ? custom.baseDamage : DEFAULTS.baseDamage,
      multipliers: multipliers
    };
  }

  // Dificuldade desconhecida usa o multiplicador 1 (dificuldade padrão).
  function damageFor(difficulty) {
    var s = settings();
    var m = s.multipliers[difficulty];
    return Math.round(s.baseDamage * (isNum(m) ? m : 1));
  }

  function level(ratio) {
    var r = isNum(ratio) ? ratio : 0;
    return r < 0.25 ? 'danger' : (r < 0.5 ? 'warn' : 'ok');
  }

  function create(options) {
    var opts = options || {};
    var ids = Array.isArray(opts.ids) && opts.ids.length ? opts.ids.slice() : ['a', 'b'];
    var max = isNum(opts.max) && opts.max > 0 ? Math.floor(opts.max) : settings().max;
    var hp = {};

    function reset() { ids.forEach(function (id) { hp[id] = max; }); }
    reset();

    function known(id) { return Object.prototype.hasOwnProperty.call(hp, id); }

    var H = {
      max: max,
      ids: ids.slice(),
      get: function (id) { return known(id) ? hp[id] : null; },
      ratio: function (id) { return known(id) ? hp[id] / max : 0; },
      level: function (id) { return level(H.ratio(id)); },
      isDead: function (id) { return known(id) ? hp[id] <= 0 : false; },
      damage: function (id, amount) {
        if (!known(id) || !isNum(amount) || amount < 0) return { ok: false, before: H.get(id), after: H.get(id), dealt: 0 };
        var before = hp[id];
        hp[id] = Math.max(0, before - Math.round(amount));
        return { ok: true, before: before, after: hp[id], dealt: before - hp[id] };
      },
      heal: function (id, amount) {
        if (!known(id) || !isNum(amount) || amount < 0) return { ok: false, before: H.get(id), after: H.get(id), healed: 0 };
        var before = hp[id];
        hp[id] = Math.min(max, before + Math.round(amount));
        return { ok: true, before: before, after: hp[id], healed: hp[id] - before };
      },
      resolve: function (roundsOver) {
        var dead = ids.filter(function (id) { return hp[id] <= 0; });
        if (dead.length) {
          if (dead.length >= ids.length) return 'draw';
          var alive = ids.filter(function (id) { return hp[id] > 0; });
          return alive.length === 1 ? alive[0] : null;
        }
        if (!roundsOver) return null;
        var best = Math.max.apply(null, ids.map(function (id) { return hp[id]; }));
        var leaders = ids.filter(function (id) { return hp[id] === best; });
        return leaders.length === 1 ? leaders[0] : 'draw';
      },
      snapshot: function () {
        var out = {};
        ids.forEach(function (id) { out[id] = hp[id]; });
        return out;
      },
      restore: function (snap) {
        if (!snap || typeof snap !== 'object') return false;
        ids.forEach(function (id) {
          if (isNum(snap[id])) hp[id] = Math.max(0, Math.min(max, Math.round(snap[id])));
        });
        return true;
      },
      reset: reset
    };
    return H;
  }

  BQ5.hp = { defaults: DEFAULTS, settings: settings, damageFor: damageFor, level: level, create: create };
})(globalThis);
