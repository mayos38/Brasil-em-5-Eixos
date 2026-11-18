/* ============================================================
 * brasil-quiz v0.2 modular — js/storage.js
 * Responsabilidade: persistência de progresso (localStorage) com fallback em memória.
 *   - recorde do modo solo;
 *   - campanha: regiões concluídas + melhor pontuação por região;
 *   - reset da campanha.
 * Nunca lança erro por storage indisponível/danificado (ex.: modo privado).
 * Carregar depois de config.js e util.js.
 * ============================================================ */
(function () {
  'use strict';

  const _mem = {}; // fallback em memória quando localStorage está ausente/quebrado

  function rawGet(key) {
    try { if (typeof localStorage !== 'undefined') return localStorage.getItem(key); } catch (e) {}
    return Object.prototype.hasOwnProperty.call(_mem, key) ? _mem[key] : null;
  }
  function rawSet(key, val) {
    try {
      if (typeof localStorage !== 'undefined') { localStorage.setItem(key, val); _mem[key] = val; return true; }
    } catch (e) {}
    _mem[key] = val;
    return true;
  }

  const S = {};
  function keys() {
    return BQ5.config ? BQ5.config.storageKeys : { progress: 'bq5_prog', bestSolo: 'bq5_best_solo' };
  }

  // Leitura/escrita JSON segura (JSON inválido => valor padrão, sem exceção).
  S.getJSON = function (key, def) {
    const v = rawGet(key);
    if (v == null) return def;
    try { return JSON.parse(v); } catch (e) { return def; }
  };
  S.setJSON = function (key, val) { rawSet(key, JSON.stringify(val)); };

  // Progresso da campanha: { done:{regiao:true}, best:{regiao:pontos} }
  S.defaultProgress = function () { return { done: {}, best: {} }; };

  S.getProgress = function () {
    const p = S.getJSON(keys().progress, S.defaultProgress());
    if (!p || typeof p !== 'object' || typeof p.done !== 'object' || typeof p.best !== 'object') return S.defaultProgress();
    return p;
  };
  S.saveProgress = function (p) { S.setJSON(keys().progress, p); };

  // Recorde do modo solo: só aumenta. Retorna {prev, best}.
  S.recordSoloScore = function (score) {
    const key = keys().bestSolo;
    const prev = S.getJSON(key, 0) || 0;
    const best = Math.max(prev, score | 0);
    S.setJSON(key, best);
    return { prev: prev, best: best };
  };

  // Conclui uma etapa da campanha. O melhor por região só aumenta.
  // Retorna { progress, allDone } (allDone quando as 5 regiões foram concluídas).
  S.completeStage = function (region, score) {
    const p = S.getProgress();
    p.done[region] = true;
    if ((p.best[region] || 0) < (score | 0)) p.best[region] = score | 0;
    S.saveProgress(p);
    let allDone = true;
    const stages = BQ5.config ? BQ5.config.campaignStages : ['norte', 'nordeste', 'centro-oeste', 'sudeste', 'sul'];
    for (let i = 0; i < stages.length; i++) if (!p.done[stages[i]]) { allDone = false; break; }
    return { progress: p, allDone: allDone };
  };

  // Zera a campanha (não afeta o recorde solo).
  S.resetCampaign = function () {
    const p = S.defaultProgress();
    S.saveProgress(p);
    return p;
  };

  globalThis.BQ5 = globalThis.BQ5 || {};
  BQ5.storage = S;
})();
