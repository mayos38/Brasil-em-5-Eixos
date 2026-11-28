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

  // MÓDULO 12 — Progresso da campanha v2, por tier de dificuldade:
  // { tiers: { [tier]: { points: { [pointId]: {score, maxRight} },
  //                     bosses: { [regiao]: true } } } }
  // pointId = "<regiao>:<tema>" (tiers padrão) ou "<regiao>:mix<n>" (Geógrafo).
  // score = melhor pontuação do ponto (substituída por maior, regra de nova
  // tentativa); maxRight = maior total de acertos já obtido no ponto.
  S.defaultCampaignV2 = function () { return { tiers: {} }; };

  // Alpha #5: o eixo "Vegetação" (chave interna 'vegetacao') passou a se chamar
  // "Natureza" ('natureza'). Progresso salvo antes da troca usa pointId
  // "<regiao>:vegetacao"; ao ler, a chave é migrada para "<regiao>:natureza"
  // (preservando o maior score/maxRight caso as duas existam) e regravada.
  S.THEME_ALIASES = { vegetacao: 'natureza' };

  function migratePointId(id) {
    const m = /^([^:]+):(.+)$/.exec(String(id));
    if (!m) return id;
    return Object.prototype.hasOwnProperty.call(S.THEME_ALIASES, m[2]) ? m[1] + ':' + S.THEME_ALIASES[m[2]] : id;
  }

  S.getCampaignV2 = function () {
    const v = S.getJSON(keys().campaignV2 || 'bq5_campaign_v2', S.defaultCampaignV2());
    if (!v || typeof v !== 'object' || typeof v.tiers !== 'object') return S.defaultCampaignV2();
    const out = { tiers: {} };
    let migrated = false;
    Object.keys(v.tiers).forEach(function (tier) {
      const t = v.tiers[tier] || {};
      const points = {};
      const rawPoints = (t.points && typeof t.points === 'object') ? t.points : {};
      Object.keys(rawPoints).forEach(function (id) {
        const nid = migratePointId(id);
        if (nid !== id) migrated = true;
        const cur = rawPoints[id];
        const prev = points[nid];
        if (prev && cur && typeof prev === 'object' && typeof cur === 'object') {
          // as duas chaves existem: mantém o melhor de cada campo numérico
          const merged = {};
          Object.keys(prev).concat(Object.keys(cur)).forEach(function (k) {
            const a = prev[k], b = cur[k];
            merged[k] = (typeof a === 'number' && typeof b === 'number') ? Math.max(a, b) : (b !== undefined ? b : a);
          });
          points[nid] = merged;
        } else if (!prev || nid === id) {
          points[nid] = cur;
        }
      });
      out.tiers[tier] = {
        points: points,
        bosses: (t.bosses && typeof t.bosses === 'object') ? t.bosses : {}
      };
    });
    if (migrated) S.saveCampaignV2(out);
    return out;
  };

  S.saveCampaignV2 = function (v) { S.setJSON(keys().campaignV2 || 'bq5_campaign_v2', v); };

  // Zera o progresso de um tier da campanha v2 (ou todos, sem argumento).
  // Não afeta recorde solo nem a campanha legada.
  S.resetCampaignV2 = function (tier) {
    const v = S.getCampaignV2();
    if (tier) delete v.tiers[tier]; else v.tiers = {};
    S.saveCampaignV2(v);
    return v;
  };

  globalThis.BQ5 = globalThis.BQ5 || {};
  BQ5.storage = S;
})();
