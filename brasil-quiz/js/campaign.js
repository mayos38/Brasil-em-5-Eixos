/* ============================================================
 * Brasil em 5 Eixos — Módulo 12: Campanha v2 (domínio) — js/campaign.js
 * Responsabilidade: regras META da campanha por tier de dificuldade:
 * estrutura dos pontos de parada, desbloqueios (tiers/regiões/chefes),
 * regra de nova tentativa e a luta contra o chefe da região.
 * Lógica pura + persistência via BQ5.storage. Sem DOM, sem timers do
 * navegador: relógio E gerador aleatório são injetáveis (setClock/setRng)
 * para testes determinísticos. Alinhado ao GDD "campanha v1.1" (2026-11).
 *
 * ESTRUTURA POR REGIÃO (§2):
 *   Fácil/Padrão/Difícil : 5 pontos temáticos (um por eixo) + 1 desafio = 6
 *   Geógrafo             : 3 pontos misturados (todos os temas) + 1 desafio = 4
 * Cada ponto temático vale config.campaignV2.questionsPerPoint questões.
 * A pontuação de uma parada é o total de ACERTOS da melhor rodada.
 *
 * REGRAS DE DESBLOQUEIO (§3/§7):
 *   - tiers: edu/normal sempre jogáveis; dificil só após concluir normal;
 *     geografo só após concluir dificil (concluir = 5 chefes vencidos no tier);
 *   - regiões avançam em sequência (Norte → Sul) por tier, ao vencer o chefe;
 *   - o ponto de desafio da região desbloqueia quando a SOMA das melhores
 *     pontuações dos pontos temáticos atinge campaignV2.unlockPct[tier]% do
 *     total possível (Fácil 50% = 25/50, Padrão 60% = 30/50, Difícil 70% =
 *     35/50, Geógrafo 70% = 21/30), independente do tema.
 *
 * NOVA TENTATIVA (paradas) (§4): a pontuação salva é o MELHOR total de acertos
 * da parada; uma nova tentativa só substitui quando obtiver MAIOR resultado —
 * empate ou inferior não reduzem. Abandonar uma parada NÃO grava nada parcial.
 * Persistência isolada: chave campaignV2 própria; não toca recorde solo nem
 * histórico local/LAN (§7.1). Registros antigos ({score,maxRight}) são lidos
 * com migração segura (maxRight era o nº de acertos => vira best).
 *
 * LUTA DO CHEFE (ponto de desafio, §8):
 *   - HP do jogador por tier: boss.playerHp[tier] (Fácil 1000, Padrão 1000,
 *     Difícil 1500, Geógrafo 1750); HP do chefe: boss.bossHp[tier]; a mesma
 *     identidade regional vale para as quatro dificuldades.
 *   - Tempo da questão = tempo SOLO do tier (NÃO dobra; §6/§8) + revealDelayMs
 *     parado com a pergunta revelada, depois intervalo de sistema (~2s,
 *     systemGapMs) entre o desfecho e a próxima mão. Sem pausa manual.
 *   - mão de 3 cartas com temas e IDs de pergunta distintos; por mão, 20% de
 *     chance (vulnChancePct) de conter EXATAMENTE UMA carta do tema
 *     vulnerável do chefe — quando não acionada, o tema vulnerável fica fora
 *     da sorte (§8.3); se a região+tier tiver menos de n-1 temas distintos,
 *     relaxa (permite o tema vulnerável como carta comum).
 *   - proteção anti-repetição (§8.6): pergunta ESCOLHIDA na mão h reaparece em
 *     0% na mão seguinte, +5pp/mão até 100%; cartas não escolhidas não têm
 *     proteção; a contagem reinicia se a mesma pergunta for escolhida de novo;
 *     a proteção é válida apenas durante a tentativa atual (retry zera);
 *     se esgotar as opções de um tema, relaxa por sorteio uniforme (nunca
 *     bloqueia). Menos de 3 perguntas/temas distintos => erro estruturado.
 *   - dano ao chefe = danoBaseAoChefe[tier] × multiplicador, com teto
 *     maxStrikeMult (1,8x): strike 1→1.0, 2→1.1, 3→1.2, ≥4→1.3; carta do tema
 *     vulnerável soma +0.5 (vulnBonus). Erro/tempo esgotado: dano FIXO ao
 *     jogador (danoAoJogador[tier]) e strike zera. HP nunca fica < 0 nem > máx.
 *   - checkpoint por SEQUÊNCIA (§8.6): se em qualquer tentativa o chefe chegar
 *     a <= checkpointPct[tier]% do HP máximo, as tentativas seguintes da MESMA
 *     sequência começam com o chefe EXATAMENTE nesse % (não acumula); sair do
 *     desafio descarta o estado temporário da sequência; vitória encerra.
 *   - a luta termina quando o HP do chefe ou do jogador chega a zero.
 *   - vitória: região concluída, próxima desbloqueada; recompensa fica
 *     reservada ao Módulo 19 (result.reward === null por enquanto).
 * Rodadas temáticas NÃO vivem aqui: a tela usa engine.stage() para o fluxo da
 * questão e chama campaign.recordStage() com o resultado final.
 * ============================================================ */
(function (global) {
  'use strict';

  var BQ5 = global.BQ5 = global.BQ5 || {};
  var _clock = null;
  var _rng = Math.random; // gerador aleatório injetável (testes determinísticos)
  var F = null;      // luta ativa (uma por sessão)
  var _seq = null;   // estado TEMPORÁRIO da sequência de tentativas do chefe:
                     // { region, tier, checkpointHit } — NUNCA persistido (§8.6)

  function clock() { if (_clock) return _clock(); try { return Date.now(); } catch (e) { return 0; } }
  function cfg() { return BQ5.config || {}; }
  function storage() { return BQ5.storage || null; }
  function bank() { return BQ5.bank || null; }
  function hpMod() { return BQ5.hp || null; }

  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function isInt(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // ---------- parâmetros centrais (config.campaignV2, com fallbacks seguros) ---
  function bossCfg() { return ((cfg().campaignV2 || {}).boss) || {}; }
  function questionsPerPoint() { var v = (cfg().campaignV2 || {}).questionsPerPoint; return isInt(v) && v > 0 ? v : 10; }
  function cardsPerHand() { var b = bossCfg(); var v = b.cardsPerHand; return isInt(v) && v > 0 ? v : 3; }
  function revealDelayMs() { var b = bossCfg(); var v = b.revealDelayMs; return isInt(v) && v >= 0 ? v : 3000; }
  function systemGapMs() { var b = bossCfg(); var v = b.systemGapMs; return isInt(v) && v > 0 ? v : 2000; } // ~2s (§6)
  function vulnPct() { var b = bossCfg(); var v = b.vulnChancePct; return isInt(v) && v >= 0 ? v : 20; }
  function cpPctFor(tier) { var b = (bossCfg().checkpointPct || {})[tier]; return isInt(b) && b > 0 && b < 100 ? b : 75; }

  // Embaralha uma CÓPIA com o RNG injetado (Fisher-Yates). Determinístico em testes.
  function shuffleRng(a) {
    var arr = a.slice();
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(_rng() * (i + 1));
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  // ---------- regras do chefe (§8) ----------

  // Multiplicador de strike por acertos consecutivos: 1→1.0, 2→1.1, 3→1.2, ≥4→1.3 (§8.4).
  var STRIKE_DEFAULTS = { 1: 1.0, 2: 1.1, 3: 1.2, 4: 1.3 };
  function strikeMultFor(strike) {
    var tbl = bossCfg().strikeMults || {};
    var idx = Math.max(1, Math.min(isInt(strike) ? strike : 0, 4));
    if (isNum(tbl[idx]) && tbl[idx] > 0) return tbl[idx];
    return STRIKE_DEFAULTS[idx];
  }

  function vulnBonus() { var v = bossCfg().vulnBonus; return isNum(v) && v > 0 ? v : 0.5; }
  function maxStrikeMult() { var v = bossCfg().maxStrikeMult; return isNum(v) && v > 1 ? v : 1.8; }

  // Identidade regional do chefe — MESMA em todos os tiers (§8). null = pendente de definição editorial.
  function bossInfoOf(region) {
    var b = ((cfg().campaignV2 || {}).bosses || {})[region] || {};
    return {
      name: typeof b.name === 'string' && b.name ? b.name : null,
      vulnTheme: (cfg().themes || []).indexOf(b.vulnTheme) !== -1 ? b.vulnTheme : null,
      problem: typeof b.problem === 'string' && b.problem ? b.problem : null
    };
  }

  // GDD §8.6 — chance de uma pergunta ESCOLHIDA na mão h reaparecer na mão m > h:
  // próxima mão 0%, +5pp por mão seguinte, teto 100%. Perguntas não escolhidas
  // não têm proteção (sempre 1). Função pura — exposta para testes.
  function reappearChance(chosenHand, handNo) {
    if (!isInt(chosenHand) || !isInt(handNo)) return null;
    if (handNo <= chosenHand) return 1; // mesma mão: IDs sempre distintos
    var steps = handNo - chosenHand - 1; // 0 => próxima mão
    return Math.max(0, Math.min(1, 0.05 * steps));
  }

  function hasThemeInPool(theme) {
    if (!F || !theme) return false;
    for (var i = 0; i < F.pool.length; i++) if (F.pool[i].t === theme) return true;
    return false;
  }

  // Monta a mão de cardsPerHand cartas (§8.2/§8.3). Ordem determinística do RNG:
  //   1 rolagem da vulnerabilidade -> shuffle dos temas restantes -> 1 rolagem
  //   por slot (ponderada ou uniforme no relaxamento). Temas e IDs distintos.
  function dealHand() {
    if (!F || F.pool.length === 0) return [];
    F.handNo++;
    var n = cardsPerHand();
    var info = bossInfoOf(F.region);

    // (1) Sorteio da vulnerabilidade: por mão; sempre consome exatamente 1 rolagem.
    var roll = _rng();
    var vulnActive = false;
    if (info.vulnTheme && hasThemeInPool(info.vulnTheme)) {
      var othersCount = F.pool.length ? themesAvail().length - 1 : 0;
      if (othersCount >= n - 1 && roll * 100 < vulnPct()) vulnActive = true;
    }

    // (2) Slots de temas distintos. Sem acionamento, o tema vulnerável fica FORA
    // da sorte (§8.3); relaxa apenas se faltar tema (permite como carta comum).
    var avail = themesAvail();
    var slots = [];
    if (vulnActive) slots.push(info.vulnTheme);
    var restPool = avail.filter(function (th) { return th !== info.vulnTheme; });
    var need = n - slots.length;
    if (restPool.length < need) restPool = avail.slice(); // relaxamento documentado
    var shuffledRest = shuffleRng(restPool);
    for (var s = 0; s < shuffledRest.length && slots.length < n; s++) {
      if (slots.indexOf(shuffledRest[s]) === -1) slots.push(shuffledRest[s]);
    }

    // (3) Preenche cada slot com uma pergunta do tema, ponderada pela chance de
    // reaparecimento (§8.6). Se a proteção esgotar o tema => sorteio uniforme
    // (relaxamento progressivo; nunca bloqueia).
    var hand = [];
    var usedIds = {};
    for (var k = 0; k < slots.length && hand.length < n; k++) {
      var cands = F.pool.filter(function (q) { return q.t === slots[k] && !usedIds[q.id]; });
      if (!cands.length) continue; // não ocorre: slot só existe com tema de conteúdo
      var weights = cands.map(function (q) {
        var h = F.protected[q.id];
        return isInt(h) ? reappearChance(h, F.handNo) : 1;
      });
      var totalW = 0;
      for (var w = 0; w < weights.length; w++) totalW += Math.max(0, weights[w]);
      var pickQ = null;
      if (totalW <= 0) {
        pickQ = cands[Math.floor(_rng() * cands.length)]; // relaxamento: uniforme
      } else {
        var r2 = _rng() * totalW, acc = 0;
        for (var j = 0; j < cands.length; j++) {
          acc += Math.max(0, weights[j]);
          if (r2 < acc) { pickQ = cands[j]; break; }
        }
        if (!pickQ) pickQ = cands[cands.length - 1];
      }
      hand.push({ theme: slots[k], revealed: false, vulnerable: vulnActive && slots[k] === info.vulnTheme, q: pickQ });
      usedIds[pickQ.id] = true;
    }
    return hand;
  }

  function themesAvail() {
    var set = {};
    for (var i = 0; i < F.pool.length; i++) set[F.pool[i].t] = true;
    return Object.keys(set);
  }

  // ---------- persistência (delegada ao storage, chave campaignV2) ----------

  function v2() { return storage() ? storage().getCampaignV2() : { tiers: {} }; }
  function saveV2(v) { if (storage()) storage().saveCampaignV2(v); return v; }
  function tierData(data, tier) {
    var d = data.tiers[tier];
    if (!d || typeof d !== 'object') { d = { points: {}, bosses: {} }; data.tiers[tier] = d; }
    if (typeof d.points !== 'object' || !d.points) d.points = {};
    if (typeof d.bosses !== 'object' || !d.bosses) d.bosses = {};
    return d;
  }

  // Migração segura de registros antigos {score,maxRight} -> {best}: maxRight
  // era o nº de acertos, que é exatamente a pontuação da parada em v1.1.
  function pointBest(rec) {
    if (!rec || typeof rec !== 'object') return 0;
    var per = questionsPerPoint();
    var val = isInt(rec.best) ? rec.best : (isInt(rec.maxRight) ? rec.maxRight : null);
    if (val == null) return 0;
    return Math.max(0, Math.min(val, per));
  }

  /** Zera o progresso da campanha v2 de um tier (ou todos, sem argumento). */
  var C = {};
  C.reset = function (tier) { return storage() ? storage().resetCampaignV2(tier) : null; };

  // ---------- estrutura (§2) ----------

  C.tiersOrder = function () { return ['edu', 'normal', 'dificil', 'geografo']; };
  C.isGeografoTier = function (tier) { return tier === 'geografo'; };

  /** Lista dos pontos de parada temáticos da região no tier. */
  C.pointsForRegion = function (region, tier) {
    var c = cfg();
    if (C.isGeografoTier(tier)) {
      var n = isInt(c.campaignV2 && c.campaignV2.mixedPointsGeografo) ? c.campaignV2.mixedPointsGeografo : 3;
      var out = [];
      for (var i = 1; i <= n; i++) out.push({ id: region + ':mix' + i, theme: 'all', label: 'Misto ' + i });
      return out;
    }
    var themes = Array.isArray(c.themes) ? c.themes.slice() : [];
    return themes.map(function (t) { return { id: region + ':' + t, theme: t, label: (c.themeLabels || {})[t] || t }; });
  };

  /** Total de questões possíveis nos pontos temáticos da região no tier. */
  C.questionsPerRegionPoints = function (tier) {
    return C.pointsForRegion('norte', tier).length * questionsPerPoint(); // 50 ou 30
  };

  // ---------- desbloqueios (§3/§7) ----------

  /** true quando os 5 chefes do tier foram vencidos. */
  C.allBossesDone = function (tier, data) {
    var d = (data || v2()).tiers[tier];
    if (!d || typeof d.bosses !== 'object') return false;
    var stages = Array.isArray(cfg().campaignStages) ? cfg().campaignStages : [];
    for (var i = 0; i < stages.length; i++) if (!d.bosses[stages[i]]) return false;
    return stages.length > 0;
  };

  /** Desbloqueio do tier: edu/normal livres; dificil após normal; geografo após dificil. */
  C.tierUnlocked = function (tier, data) {
    if (tier === 'edu' || tier === 'normal') return true;
    if (tier === 'dificil') return C.allBossesDone('normal', data);
    if (tier === 'geografo') return C.allBossesDone('dificil', data);
    return false;
  };

  /** Região jogável: tier desbloqueado + chefes das regiões anteriores vencidos. */
  C.regionUnlocked = function (region, tier, data) {
    var stages = Array.isArray(cfg().campaignStages) ? cfg().campaignStages : [];
    var idx = stages.indexOf(region);
    if (idx === -1) return false;
    if (!C.tierUnlocked(tier, data)) return false;
    var d = (data || v2()).tiers[tier];
    for (var i = 0; i < idx; i++) {
      if (!d || typeof d.bosses !== 'object' || !d.bosses[stages[i]]) return false;
    }
    return true;
  };

  /** Progresso de desbloqueio do chefe: {right, needed, total, pct, unlocked}. */
  C.bossUnlockProgress = function (region, tier, data) {
    var d = (data || v2()).tiers[tier];
    var points = C.pointsForRegion(region, tier);
    var right = 0;
    for (var i = 0; i < points.length; i++) {
      var p = d && typeof d.points === 'object' ? d.points[points[i].id] : null;
      right += pointBest(p);
    }
    var total = C.questionsPerRegionPoints(tier);
    var pctCfg = ((cfg().campaignV2 || {}).unlockPct) || {};
    var pct = isInt(pctCfg[tier]) ? pctCfg[tier] : 50;
    var needed = Math.ceil(total * pct / 100);
    return { right: right, needed: needed, total: total, pct: pct, unlocked: right >= needed };
  };

  /** Identidade do chefe da região (nome/tema vulnerável/problema) — §8. */
  C.bossInfo = function (region) { return bossInfoOf(region); };

  // ---------- registro de pontos temáticos (§4) ----------

  /**
   * Registra o resultado de uma rodada temática concluída via engine.stage().
   * result = { score, right, total }. Pontuação = nº de ACERTOS (right): a maior
   * substitui a anterior; empate/inferior não mudam nada. Abandonar não grava.
   */
  C.recordStage = function (region, tier, pointId, result) {
    var r = result || {};
    if (!isInt(r.right) || r.right < 0) {
      return { ok: false, code: 'BAD_RESULT', errors: ['result precisa de right inteiro >= 0 (nº de acertos)'] };
    }
    var points = C.pointsForRegion(region, tier);
    var found = null;
    for (var i = 0; i < points.length; i++) if (points[i].id === pointId) { found = points[i]; break; }
    if (!found) return { ok: false, code: 'BAD_POINT', errors: ['ponto desconhecido para a região/tier: ' + pointId] };

    var bestNew = Math.min(r.right, questionsPerPoint()); // acertos não passam do nº de questões
    var data = v2();
    var d = tierData(data, tier);
    var prevBest = pointBest(d.points[pointId]);
    var replaced = bestNew > prevBest; // só substitui se MAIOR (§4)
    if (replaced) { d.points[pointId] = { best: bestNew }; saveV2(data); }

    return {
      ok: true,
      point: { id: pointId, theme: found.theme, best: replaced ? bestNew : prevBest },
      replaced: replaced,
      bossUnlocked: C.bossUnlockProgress(region, tier, data)
    };
  };

  // ---------- luta do chefe (§8) ----------

  // Tempo por questão da luta = tempo SOLO do tier — GDD v1.1 §6/§8 NÃO dobra.
  function limitMsFor(tier) {
    var c = cfg();
    var t2 = c.questionTimeMs;
    if (t2 && typeof t2 === 'object') { if (isInt(t2[tier]) && t2[tier] > 0) return t2[tier]; }
    else if (isInt(t2) && t2 > 0) return t2;
    return isInt(c.questionTimeDefaultMs) ? c.questionTimeDefaultMs : 15000;
  }

  /** Inicia a luta do chefe da região no tier. Pool = questões da REGIÃO + TIER
   * (sem outra região/dificuldade). Mínimo 3 perguntas em >= 3 temas distintos,
   * senão erro estruturado — sem mão duplicada nem loop (§8.2/§8.6).
   * opts.damageScale (padrão 1) escala o dano — reservado ao Blitz (M17). */
  C.startBoss = function (region, tier, opts) {
    var o = opts || {};
    if (!bank() || !bank().loaded() || bank().count() === 0) return { ok: false, code: 'NO_BANK', errors: ['banco de questões não carregado'] };
    if (!hpMod() || typeof hpMod().create !== 'function') return { ok: false, code: 'NO_HP', errors: ['módulo BQ5.hp ausente (M18)'] };
    var c = cfg();
    if (!region || (c.regions || []).indexOf(region) === -1) return { ok: false, code: 'BAD_REGION', errors: ['região inválida: ' + region] };
    if (!tier || !(c.tiers || {})[tier]) return { ok: false, code: 'BAD_TIER', errors: ['dificuldade inválida: ' + tier] };
    if (F) return { ok: false, code: 'ACTIVE_FIGHT', errors: ['luta ativa em andamento — use retry(), completeFight() ou abortFight()'] };
    if (!C.tierUnlocked(tier)) return { ok: false, code: 'TIER_LOCKED', errors: ['dificuldade bloqueada — conclua a dificuldade anterior (5 chefes)'] };
    if (!C.regionUnlocked(region, tier)) return { ok: false, code: 'REGION_LOCKED', errors: ['região bloqueada — vença o chefe da região anterior'] };

    var b = bossCfg();
    var playerMax = isInt(b.playerHp && b.playerHp[tier]) && b.playerHp[tier] > 0 ? b.playerHp[tier] : 1000;
    var bossFullMax = isInt(b.bossHp && b.bossHp[tier]) && b.bossHp[tier] > 0 ? b.bossHp[tier] : 1500;

    // Pool elegível: região + tier SOMENTE (§8.2).
    var all = bank().list();
    var tierDs = (c.tiers || {})[tier] || [];
    var poolRaw = all.filter(function (q) { return q.region === region && tierDs.indexOf(q.difficulty) !== -1; });

    // Erro estruturado com conteúdo insuficiente (§8.6): < 3 perguntas ou < 3 temas distintos.
    var themeSet = {};
    for (var i = 0; i < poolRaw.length; i++) themeSet[poolRaw[i].theme] = true;
    var nThemes = Object.keys(themeSet).length;
    if (poolRaw.length < 3 || nThemes < cardsPerHand()) {
      return { ok: false, code: 'NO_QUESTIONS', errors: [
        'banco tem apenas ' + poolRaw.length + ' pergunta(s) em ' + nThemes + ' tema(s) para o chefe de ' + region +
        ' no tier ' + tier + ' — mínimo 3 perguntas em 3 temas distintos. Sem mão duplicada nem loop (GDD v1.1 §8).'
      ] };
    }

    // Estado da sequência: só existe se a luta atual for interrompida por derrota;
    // startBoss com F==null implica _seq==null (invariante do módulo).
    if (!(_seq && _seq.region === region && _seq.tier === tier)) {
      _seq = { region: region, tier: tier, checkpointHit: false };
    }

    var scale = isNum(o.damageScale) && o.damageScale > 0 ? o.damageScale : 1; // reservado ao Blitz (M17)

    F = {
      region: region, tier: tier, damageScale: scale,
      player: hpMod().create({ ids: ['player'], max: playerMax }),
      boss: hpMod().create({ ids: ['boss'], max: bossFullMax }),
      bossFullMax: bossFullMax, cpPct: cpPctFor(tier),
      pool: poolRaw.map(function (q) { return BQ5.engine.instantiateQuestion(q); }),
      protected: {}, handNo: 0, strike: 0, currentVuln: false,
      hand: [], currentQ: null,
      phase: 'choosing', revealEnd: 0, tEnd: 0, gapEnd: 0,
      limitMs: limitMsFor(tier), rounds: 0, over: null
    };
    F.hand = dealHand();
    if (F.hand.length !== cardsPerHand()) {
      var noQ = { ok: false, code: 'NO_QUESTIONS', errors: ['não foi possível formar mão de ' + cardsPerHand() + ' cartas para o chefe de ' + region] };
      F = null; _seq = null;
      return noQ;
    }
    return { ok: true, fight: C.fightSnapshot() };
  };

  /** Snapshot plano da luta (seguro para a UI): cartas NÃO revelam pergunta. */
  C.fightSnapshot = function () {
    if (!F) return null;
    var hand = F.hand.map(function (card) {
      var entry = { theme: card.theme, revealed: !!card.revealed, vulnerable: !!card.vulnerable };
      if (card.revealed && card.q) entry.question = clone(card.q);
      return entry;
    });
    return {
      region: F.region, tier: F.tier, phase: F.phase, over: F.over || null,
      rounds: F.rounds, strike: F.strike, limitMs: F.limitMs,
      playerHp: F.player.get('player'), playerMax: F.player.max,
      bossHp: F.boss.get('boss'), bossMax: F.bossFullMax,
      checkpointHit: _seq ? !!_seq.checkpointHit : false, checkpointPct: F.cpPct,
      boss: bossInfoOf(F.region),
      hand: hand
    };
  };

  /** Milissegundos restantes da fase atual (revelação parada / resposta / intervalo). */
  C.remainingMs = function () {
    if (!F || F.over) return null;
    var now = clock();
    // Pausa de revelação: enquanto resta pausa, conta a pausa; após o fim da
    // pausa o relógio da resposta já está rodando com o tempo SOLO do tier.
    if (F.phase === 'revealing') return F.revealEnd > now ? F.revealEnd - now : F.limitMs;
    if (F.phase === 'answering') return Math.max(0, F.tEnd - now);
    if (F.phase === 'gap') return Math.max(0, F.gapEnd - now);
    return null; // choosing: nenhum relógio rodando
  };

  /** Escolhe uma carta da mão: ela vira e revela a pergunta (§8.2). O tempo da
   * resposta só começa após revealDelayMs parado. A proteção anti-repetição
   * começa neste momento, para esta mão (handNo atual) — §8.6. */
  C.selectCard = function (i) {
    if (!F) return { ok: false, code: 'NO_FIGHT', errors: ['nenhuma luta ativa'] };
    if (F.over) return { ok: false, code: 'OVER', errors: ['luta já decidida — use completeFight() ou retry()'] };
    if (F.phase !== 'choosing') return { ok: false, code: 'BAD_PHASE', errors: ['escolha de carta só na fase choosing (fase atual: ' + F.phase + ')'] };
    if (!isInt(i) || i < 0 || i >= F.hand.length) return { ok: false, code: 'BAD_CARD', errors: ['índice de carta inválido: ' + i] };
    var card = F.hand[i];
    if (!card.q) return { ok: false, code: 'BAD_CARD', errors: ['carta sem questão disponível'] };

    card.revealed = true;
    F.currentQ = card.q;
    F.currentVuln = !!card.vulnerable;
    F.protected[card.q.id] = F.handNo; // contagem começa quando a carta é escolhida (§8.6)
    F.phase = 'revealing';
    var now = clock();
    F.revealEnd = now + revealDelayMs();
    F.tEnd = F.revealEnd + F.limitMs; // tempo SOLO do tier — não dobra (§6/§8)
    return { ok: true, fight: C.fightSnapshot() };
  };

  /** Responde à pergunta revelada. choice = índice da alternativa (0..3) ou -1
   * para tempo esgotado. Acerto: strike++ e dano ao chefe com multiplicador
   * (teto maxStrikeMult; +vulnBonus se carta do tema vulnerável). Erro/tempo:
   * dano fixo ao jogador e strike zera (§8.4/§8.5). */
  C.answer = function (choice) {
    if (!F) return { ok: false, code: 'NO_FIGHT', errors: ['nenhuma luta ativa'] };
    if (F.over) return { ok: false, code: 'OVER', errors: ['luta já decidida — use completeFight() ou retry()'] };
    var now = clock();

    // Validação ANTES de mudar a fase: erros nunca alteram o estado (mesmo
    // contrato do engine.answer). -1 é sempre válido (timeout do relógio).
    var timedOut = choice === -1;
    if (!timedOut && (!isInt(choice) || choice < 0 || choice > 3)) {
      return { ok: false, code: 'INVALID_CHOICE', errors: ['choice deve ser inteiro 0..3 (ou -1 para tempo esgotado)'] };
    }

    if (F.phase === 'revealing') {
      if (now < F.revealEnd) return { ok: false, code: 'TOO_EARLY', errors: ['pergunta ainda na tela — o tempo só começa após a pausa de revelação (§6)'] };
      F.phase = 'answering';
    }
    if (F.phase !== 'answering') return { ok: false, code: 'BAD_PHASE', errors: ['escolha uma carta antes de responder (fase atual: ' + F.phase + ')'] };

    var q = F.currentQ;
    var correct = !timedOut && choice === q.a;
    var b = bossCfg();
    var dealtToBoss = 0, dealtToPlayer = 0;

    if (correct) {
      F.strike++;
      var mult = strikeMultFor(F.strike);
      if (F.currentVuln) mult += vulnBonus();
      if (mult > maxStrikeMult()) mult = maxStrikeMult(); // teto 1,8x (§8.4/§8.5)
      var baseB = isNum(b.danoBaseAoChefe[F.tier]) ? b.danoBaseAoChefe[F.tier] : 100;
      var db = F.boss.damage('boss', baseB * F.damageScale * mult);
      dealtToBoss = db.dealt;
      // Checkpoint da sequência (§8.6): chefe <= checkpointPct% do HP máximo.
      var threshold = Math.max(1, Math.round(F.bossFullMax * F.cpPct / 100));
      if (_seq && F.boss.get('boss') <= threshold) _seq.checkpointHit = true;
    } else {
      F.strike = 0; // sequência de acertos zera com erro/tempo esgotado (§8.4)
      var baseP = isNum(b.danoAoJogador[F.tier]) ? b.danoAoJogador[F.tier] : 75;
      var dp = F.player.damage('player', baseP * F.damageScale);
      dealtToPlayer = dp.dealt;
    }

    F.rounds++;
    var over = null;
    if (F.boss.isDead('boss')) over = 'win';
    else if (F.player.isDead('player')) over = 'loss';
    F.over = over;
    if (!over) {
      F.phase = 'gap'; // intervalo de sistema (~2s) antes da próxima mão (§6)
      F.gapEnd = now + systemGapMs();
      F.currentQ = null;
    }

    return {
      ok: true, correct: correct, timedOut: timedOut,
      dealtToBoss: dealtToBoss, dealtToPlayer: dealtToPlayer,
      strike: F.strike, bossHp: F.boss.get('boss'), playerHp: F.player.get('player'),
      checkpointHit: _seq ? !!_seq.checkpointHit : false, over: over,
      fight: C.fightSnapshot()
    };
  };

  /** Próxima mão — só após o intervalo de sistema terminar (§6). */
  C.nextHand = function () {
    if (!F) return { ok: false, code: 'NO_FIGHT', errors: ['nenhuma luta ativa'] };
    if (F.over) return { ok: false, code: 'OVER', errors: ['luta já decidida — use completeFight() ou retry()'] };
    if (F.phase !== 'gap') return { ok: false, code: 'BAD_PHASE', errors: ['nextHand só após o intervalo de sistema (fase atual: ' + F.phase + ')'] };
    if (clock() < F.gapEnd) return { ok: false, code: 'TOO_EARLY', errors: ['intervalo de sistema não terminou — aguarde remainingMs() zerar (§6)'] };
    F.hand = dealHand();
    F.currentQ = null;
    F.phase = 'choosing';
    var snap = C.fightSnapshot();
    return { ok: true, hand: snap.hand, fight: snap };
  };

  /** Nova tentativa após DERROTA (§8.7): jogador com HP cheio; chefe começa no
   * checkpoint da sequência (exato %) se já atingido, senão no HP máximo. A
   * proteção anti-repetição é reiniciada (válida só durante a tentativa). */
  C.retry = function () {
    if (!F) return { ok: false, code: 'NO_FIGHT', errors: ['nenhuma luta ativa'] };
    if (!F.over || F.over !== 'loss') return { ok: false, code: 'NOT_LOST', errors: ['retry só após derrota (over === "loss") — para vencer use completeFight()'] };

    var target = (_seq && _seq.checkpointHit) ? Math.max(1, Math.round(F.bossFullMax * F.cpPct / 100)) : F.bossFullMax;
    var cur = F.boss.get('boss');
    if (cur < target) F.boss.heal('boss', target - cur);
    else if (cur > target) F.boss.damage('boss', cur - target);

    F.player.reset(); // HP cheio na nova tentativa (§8.7)
    F.protected = {};  // reinicia a proteção anti-repetição (§8.6)
    F.handNo = 0; F.strike = 0; F.currentVuln = false; F.currentQ = null;
    F.rounds = 0; F.over = null; F.phase = 'choosing';
    F.revealEnd = 0; F.tEnd = 0; F.gapEnd = 0;
    F.hand = dealHand();
    return { ok: true, fight: C.fightSnapshot() };
  };

  /** Encerra a luta VENCIDA e persiste o chefe derrotado (só aumenta). A
   * recompensa fica reservada ao Módulo 19. A sequência termina aqui. */
  C.completeFight = function () {
    if (!F) return { ok: false, code: 'NO_FIGHT', errors: ['nenhuma luta ativa'] };
    if (F.over !== 'win') return { ok: false, code: 'NOT_WIN', errors: ['para encerrar uma derrota use retry() ou abortFight(); completeFight é para vitória'] };

    var data = v2();
    tierData(data, F.tier).bosses[F.region] = true; // só aumenta (§7.1)
    saveV2(data);

    var stages = Array.isArray(cfg().campaignStages) ? cfg().campaignStages : [];
    var idx = stages.indexOf(F.region);
    var result = {
      region: F.region, tier: F.tier, over: 'win', rounds: F.rounds,
      playerHp: F.player.get('player'), bossHp: F.boss.get('boss'),
      reward: null, // Módulo 19 (recompensas) ainda não existe
      nextRegion: idx !== -1 && idx + 1 < stages.length ? stages[idx + 1] : null,
      allDone: C.allBossesDone(F.tier, data)
    };
    F = null; _seq = null; // sequência encerrada pela vitória (§8.6/§8.7)
    return { ok: true, result: result };
  };

  /** Sai do desafio: descarta a luta E o estado temporário da sequência
   * (checkpoint incluído) — §7.3/§8.6. Nada é persistido. */
  C.abortFight = function () {
    var had = !!F;
    F = null; _seq = null;
    return { ok: true, hadGame: had };
  };

  /** Visão geral do tier para a UI: paradas com melhor pontuação (best),
   * identidade dos chefes e progresso de desbloqueio. */
  C.hub = function (tier) {
    var data = v2();
    var d = data.tiers[tier];
    var pointsByRegion = {};
    if (d && typeof d.points === 'object') {
      for (var pid in d.points) if (Object.prototype.hasOwnProperty.call(d.points, pid)) {
        var regPart = pid.split(':')[0];
        if (!pointsByRegion[regPart]) pointsByRegion[regPart] = {};
        pointsByRegion[regPart][pid] = pointBest(d.points[pid]);
      }
    }
    var stages = Array.isArray(cfg().campaignStages) ? cfg().campaignStages : [];
    var regions = [];
    for (var i = 0; i < stages.length; i++) {
      var region = stages[i];
      var pts = C.pointsForRegion(region, tier);
      var bossDone = !!(d && typeof d.bosses === 'object' && d.bosses[region]);
      regions.push({
        region: region, label: (cfg().regionLabels || {})[region] || region, index: i,
        unlocked: C.regionUnlocked(region, tier, data), bossDone: bossDone,
        boss: bossInfoOf(region),
        points: pts.map(function (p) { return { id: p.id, theme: p.theme, label: p.label, best: pointsByRegion[region] ? (pointsByRegion[region][p.id] || 0) : 0 }; }),
        bossProgress: C.bossUnlockProgress(region, tier, data)
      });
    }
    return { tier: tier, unlocked: C.tierUnlocked(tier, data), allDone: C.allBossesDone(tier, data), regions: regions };
  };

  // ---------- injeção para testes determinísticos ----------

  /** Injeta o relógio da campanha (função ou null => Date.now). */
  C.setClock = function (fn) {
    if (fn !== null && typeof fn !== 'function') throw new Error('setClock: função ou null');
    _clock = fn === null ? null : fn;
    return true;
  };

  /** Injeta o gerador aleatório da campanha (função ou null => Math.random). */
  C.setRng = function (fn) {
    if (fn !== null && typeof fn !== 'function') throw new Error('setRng: função ou null');
    _rng = fn === null ? Math.random : fn;
    return true;
  };

  /** GDD §8.6 — chance de reaparecimento (exposta para testes). */
  C.reappearChance = reappearChance;

  BQ5.campaign = C;
})(globalThis);
