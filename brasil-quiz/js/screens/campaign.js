/* ============================================================
 * Brasil em 5 Eixos — Módulo 12: telas da campanha (mapa + chefe)
 * Arquivo : js/screens/campaign.js
 * Responsabilidade: apresentar a campanha v2 e traduzir interações em
 * chamadas às APIs públicas de BQ5.campaign (regras), BQ5.engine (rodada
 * temática via engine.stage) e BQ5.screens.play/results. NÃO contém regras
 * de desbloqueio, pontuação, dano, HP, checkpoint ou sorteio de cartas:
 * tudo isso é autoridade de js/campaign.js.
 *
 * Fluxos:
 *   - intent:campaign (menu) / results:campaign (botão Mapa) -> mapa.
 *   - Parada temática: engine.stage() -> play.show(); ao terminar, o
 *     resultado é registrado por campaign.recordStage() (a UI só repassa).
 *   - Chefe: campaign.startBoss() -> tela #screen-boss (cartas, pergunta,
 *     HP, strike, intervalo de sistema, nova tentativa, conclusão).
 *
 * SEM PAUSA (regra do produto): não existe pausa; sair do desafio descarta a
 * luta (abortFight). O cronômetro da pergunta não para enquanto houver modal.
 * ============================================================ */
(function (global) {
  'use strict';

  var BQ5 = global.BQ5 = global.BQ5 || {};
  var initialized = false;
  var unsubscribers = [];
  var OPTION_LABELS = ['A', 'B', 'C', 'D'];

  var S = {
    tier: 'edu',          // dificuldade exibida no mapa
    expanded: null,       // região com a lista de paradas aberta
    point: null,          // última parada temática iniciada {region,tier,id,theme}
    inFight: false,
    fightPhase: null,
    selected: null,       // alternativa selecionada no chefe (índice)
    revealEndAt: 0,       // instante (Date.now) em que o relógio da resposta começa
    answerEndAt: 0,       // instante em que o tempo da pergunta acaba
    timerId: null,
    lastOutcome: null
  };

  function ui() { return BQ5.ui || null; }
  function C() { return BQ5.campaign || null; }
  function engine() { return BQ5.engine || null; }
  function cfg() { return BQ5.config || {}; }
  function isInt(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }
  function lbl(map, key) { return map && map[key] != null ? String(map[key]) : String(key); }
  function tierLabel(t) { return lbl(cfg().tierLabels, t); }
  function regionLabel(r) { return lbl(cfg().regionLabels, r); }
  function themeLabel(t) { return lbl(cfg().themeLabels, t); }
  function perPoint() { var v = cfg().campaignV2; return v && isInt(v.questionsPerPoint) ? v.questionsPerPoint : 10; }
  function bossCfg() { var v = cfg().campaignV2; return (v && v.boss) || {}; }
  function setMeter(id, ratio) {
    var node = ui().el(id);
    if (!node) return;
    var r = Math.max(0, Math.min(1, ratio));
    if (node.style && typeof node.style.setProperty === 'function') node.style.setProperty('--p', String(r));
    node.setAttribute('aria-valuenow', String(Math.round(r * 100)));
  }
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }

  // ---------- mapa ----------

  function firstOpenTier() {
    var c = C();
    var order = c.tiersOrder();
    for (var i = 0; i < order.length; i++) {
      if (c.tierUnlocked(order[i]) && !c.allBossesDone(order[i])) return order[i];
    }
    return order[0];
  }

  function renderTiers() {
    var api = ui();
    var c = C();
    var box = api.el('#campaign-tiers');
    if (!box) return;
    clear(box);
    c.tiersOrder().forEach(function (tier) {
      var unlocked = c.tierUnlocked(tier);
      var done = unlocked && c.allBossesDone(tier);
      var fragment = api.cloneTemplate('tpl-choice');
      var button = fragment && fragment.querySelector ? fragment.querySelector('.bq5-choice') : null;
      if (!button) {
        button = global.document.createElement('button');
        button.className = 'bq5-choice';
        button.setAttribute('type', 'button');
        button.setAttribute('role', 'radio');
      }
      var title = button.querySelector('.bq5-choice__label');
      var hint = button.querySelector('.bq5-choice__hint');
      if (title) title.textContent = tierLabel(tier); else button.textContent = tierLabel(tier);
      if (hint) hint.textContent = !unlocked ? 'Bloqueada' : (done ? 'Concluída' : '');
      button.setAttribute('data-action', 'campaign-tier');
      button.setAttribute('data-value', tier);
      var selected = tier === S.tier;
      button.setAttribute('aria-checked', selected ? 'true' : 'false');
      button.setAttribute('tabindex', selected ? '0' : '-1');
      if (!unlocked) { button.disabled = true; button.setAttribute('aria-disabled', 'true'); }
      else { button.disabled = false; button.removeAttribute('aria-disabled'); }
      box.appendChild(fragment && fragment.querySelector ? fragment : button);
    });
    var hintText = '';
    if (S.tier === 'geografo') hintText = 'Geógrafo: 3 paradas mistas por região, mais o desafio do chefe.';
    else hintText = '5 paradas (uma por eixo) por região, mais o desafio do chefe.';
    var next = c.tiersOrder();
    var locked = next.filter(function (t) { return !c.tierUnlocked(t); });
    if (locked.length) hintText += ' Conclua os 5 chefes de uma dificuldade para liberar a seguinte.';
    api.text('#campaign-tier-hint', hintText);
  }

  function bossName(info, region) {
    // Nomes pendentes de definição editorial não são inventados.
    return info && info.name ? info.name : ('Chefe de ' + regionLabel(region));
  }

  function renderRegion(entry, index) {
    var api = ui();
    var fragment = api.cloneTemplate('tpl-route-node');
    var node = fragment && fragment.querySelector ? fragment.querySelector('.bq5-route__node') : null;
    if (!node) return null;
    var state = !entry.unlocked ? 'locked' : (entry.bossDone ? 'done' : 'available');
    node.setAttribute('data-state', state);
    node.setAttribute('data-region', entry.region);
    var badge = node.querySelector('.bq5-route__badge');
    if (badge) badge.textContent = entry.bossDone ? '✓' : String(index + 1);
    node.querySelector('.bq5-route__name').textContent = entry.label;
    var bp = entry.bossProgress;
    node.querySelector('.bq5-route__best').textContent = entry.unlocked
      ? 'Acertos nas paradas: ' + bp.right + '/' + bp.total
      : 'Vença o chefe da região anterior';
    node.querySelector('.bq5-route__state').textContent = state === 'locked' ? 'Bloqueada' : (state === 'done' ? 'Chefe vencido' : 'Disponível');

    var card = node.querySelector('.bq5-route__card');
    var open = entry.unlocked && S.expanded === entry.region;
    card.setAttribute('data-value', entry.region);
    card.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (!entry.unlocked) { card.disabled = true; card.setAttribute('aria-disabled', 'true'); }

    var panel = node.querySelector('.bq5-route__points');
    panel.hidden = !open;
    if (open) {
      var list = node.querySelector('.bq5-route__list');
      entry.points.forEach(function (p) {
        var pf = api.cloneTemplate('tpl-route-point');
        var li = pf && pf.querySelector ? pf.querySelector('.bq5-point') : null;
        if (!li) return;
        li.setAttribute('data-state', p.best > 0 ? 'done' : 'available');
        li.querySelector('.bq5-point__name').textContent = p.label;
        li.querySelector('.bq5-point__best').textContent = p.best + '/' + perPoint();
        var b = li.querySelector('.bq5-point__btn');
        b.setAttribute('data-value', p.id);
        b.setAttribute('aria-label', p.label + ': melhor resultado ' + p.best + ' de ' + perPoint() + ' acertos');
        list.appendChild(pf);
      });
      var name = bossName(entry.boss, entry.region);
      var note = node.querySelector('.bq5-route__boss-note');
      var problem = entry.boss && entry.boss.problem ? ' — ' + entry.boss.problem : '';
      var vuln = entry.boss && entry.boss.vulnTheme ? ' Tema vulnerável: ' + themeLabel(entry.boss.vulnTheme) + '.' : '';
      note.textContent = bp.unlocked
        ? name + problem + '.' + vuln
        : name + problem + '. Libera com ' + bp.needed + ' acertos somados nas paradas (você tem ' + bp.right + ').';
      var boss = node.querySelector('.bq5-route__boss');
      boss.setAttribute('data-value', entry.region);
      boss.textContent = entry.bossDone ? 'Desafiar o chefe de novo' : 'Desafio do chefe';
      if (!bp.unlocked) { boss.disabled = true; boss.setAttribute('aria-disabled', 'true'); }
    }
    return fragment;
  }

  function renderMap() {
    var api = ui();
    var c = C();
    if (!c) return { ok: false, code: 'NO_CAMPAIGN' };
    if (!c.tierUnlocked(S.tier)) S.tier = firstOpenTier();
    var hub = c.hub(S.tier);
    renderTiers();

    var done = 0;
    hub.regions.forEach(function (r) { if (r.bossDone) done++; });
    var total = hub.regions.length;
    api.text('#campaign-done', done);
    api.text('#campaign-total', total);
    api.text('#campaign-lead', 'Dificuldade ' + tierLabel(S.tier) + ': do Norte ao Sul, vença o chefe de cada região.');
    var bar = api.el('#campaign-progress');
    if (bar) {
      var ratio = total ? done / total : 0;
      bar.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
      if (bar.style && typeof bar.style.setProperty === 'function') bar.style.setProperty('--p', String(ratio));
    }

    if (!S.expanded || !hub.regions.some(function (r) { return r.region === S.expanded && r.unlocked; })) {
      var open = null;
      for (var i = 0; i < hub.regions.length; i++) {
        if (hub.regions[i].unlocked && !hub.regions[i].bossDone) { open = hub.regions[i].region; break; }
      }
      S.expanded = open || (hub.regions[0] && hub.regions[0].unlocked ? hub.regions[0].region : null);
    }

    var route = api.el('#campaign-route');
    clear(route);
    hub.regions.forEach(function (entry, idx) {
      var f = renderRegion(entry, idx);
      if (f) route.appendChild(f);
    });
    return { ok: true, hub: hub };
  }

  function show() {
    var ready = init();
    if (!ready.ok) return ready;
    var c = C();
    if (!c) { ui().toast('O módulo da campanha não foi carregado.', 'error'); return { ok: false, code: 'NO_CAMPAIGN' }; }
    if (S.inFight) abortBoss(true);
    if (!c.tierUnlocked(S.tier)) S.tier = firstOpenTier();
    var rendered = renderMap();
    if (!rendered.ok) return rendered;
    // Vindo do menu, o Voltar retorna ao menu; vindo de resultados/chefe, o histórico é
    // limpo (o Voltar cai no menu) para nunca apontar para uma tela sem partida ativa.
    var fromMenu = ui().currentScreen() === 'menu';
    return fromMenu ? ui().showScreen('campaign') : ui().showScreen('campaign', { history: false, clearHistory: true });
  }

  function selectTier(value) {
    var c = C();
    if (!c || c.tiersOrder().indexOf(value) === -1 || !c.tierUnlocked(value)) return { ok: false, code: 'TIER_LOCKED' };
    S.tier = value;
    S.expanded = null;
    return renderMap();
  }

  function toggleRegion(region) {
    S.expanded = S.expanded === region ? null : region;
    if (S.expanded === null) {
      // permite fechar a região aberta sem reabri-la automaticamente
      var route = ui().el('#campaign-route');
      var nodes = route ? ui().all('.bq5-route__node', route) : [];
      nodes.forEach(function (n) {
        var panel = n.querySelector('.bq5-route__points');
        var card = n.querySelector('.bq5-route__card');
        if (panel) panel.hidden = true;
        if (card) card.setAttribute('aria-expanded', 'false');
      });
      return { ok: true };
    }
    return renderMap();
  }

  function resetTier() {
    var api = ui();
    api.openModal({
      title: 'Recomeçar campanha?',
      message: 'O progresso da dificuldade ' + tierLabel(S.tier) + ' (paradas e chefes) será apagado. Recorde do modo solo e histórico não são afetados. Esta ação não pode ser desfeita.',
      cancelLabel: 'Cancelar',
      confirmLabel: 'Recomeçar',
      onConfirm: function () {
        C().reset(S.tier);
        S.expanded = null;
        renderMap();
        api.toast('Progresso da dificuldade ' + tierLabel(S.tier) + ' reiniciado.', 'success');
      }
    });
  }

  // ---------- paradas temáticas ----------

  function findPoint(pointId) {
    var region = String(pointId || '').split(':')[0];
    var list = C().pointsForRegion(region, S.tier);
    for (var i = 0; i < list.length; i++) if (list[i].id === pointId) return { region: region, point: list[i] };
    return null;
  }

  function startPoint(pointId) {
    var api = ui();
    var c = C();
    var e = engine();
    if (!c || !e) return { ok: false, code: 'NO_MODULES' };
    var found = findPoint(pointId);
    if (!found) { api.toast('Parada desconhecida.', 'error'); return { ok: false, code: 'BAD_POINT' }; }
    if (!c.tierUnlocked(S.tier) || !c.regionUnlocked(found.region, S.tier)) {
      api.toast('Esta região ainda está bloqueada.', 'error');
      return { ok: false, code: 'REGION_LOCKED' };
    }
    var started = e.stage({ region: found.region, theme: found.point.theme, tier: S.tier });
    if (!started || !started.ok) {
      api.toast(started && started.errors && started.errors.length ? started.errors.join(' ') : 'Não foi possível iniciar a parada.', 'error');
      return started || { ok: false, code: 'STAGE_FAILED' };
    }
    var play = BQ5.screens && BQ5.screens.play;
    if (!play || typeof play.show !== 'function') {
      if (typeof e.abort === 'function') e.abort();
      api.toast('A tela de partida ainda não foi carregada.', 'error');
      return { ok: false, code: 'NO_PLAY_SCREEN' };
    }
    var shown = play.show();
    if (!shown || shown.ok === false) {
      if (typeof e.abort === 'function') e.abort();
      api.toast('Não foi possível abrir a parada.', 'error');
      return shown || { ok: false, code: 'PLAY_SCREEN_FAILED' };
    }
    S.point = { region: found.region, tier: S.tier, id: pointId, theme: found.point.theme };
    api.emit('game:started', { mode: 'stage', theme: found.point.theme, diff: S.tier, region: found.region, count: perPoint() });
    return { ok: true, game: started.game };
  }

  // Chamado por results.replay() quando o resultado atual é de uma parada.
  function replayPoint() {
    if (!S.point) { ui().toast('Nenhuma parada para repetir.', 'info'); return { ok: false, code: 'NO_POINT' }; }
    S.tier = S.point.tier;
    return startPoint(S.point.id);
  }

  // A tela de partida emite game:finished com o MESMO objeto que depois entrega
  // aos resultados; aqui registramos a parada (regra de melhor resultado = campaign)
  // e anexamos o bloco "stage" para que results mostre o contexto da campanha.
  function onGameFinished(result) {
    if (!result || result.mode !== 'stage' || !S.point || !C()) return;
    var p = S.point;
    var rec = C().recordStage(p.region, p.tier, p.id, result);
    if (!rec || !rec.ok) {
      ui().toast('Não foi possível salvar o resultado da parada.', 'error');
      return;
    }
    var bp = rec.bossUnlocked;
    var text = 'Melhor resultado nesta parada: ' + rec.point.best + ' de ' + perPoint() + ' acertos' + (rec.replaced ? ' (novo melhor!)' : '') + '. ';
    text += bp.unlocked
      ? 'Desafio do chefe liberado!'
      : 'Chefe: ' + bp.right + ' de ' + bp.needed + ' acertos somados para liberar.';
    result.stage = { region: p.region, done: false, best: rec.point.best, allDone: false, title: 'Parada concluída', text: text };
    result.region = p.region;
    result.diff = p.tier;
    result.theme = p.theme;
  }

  // ---------- desafio do chefe ----------

  function stopTimer() {
    if (S.timerId !== null && typeof global.clearInterval === 'function') global.clearInterval(S.timerId);
    S.timerId = null;
  }

  function startTimer() {
    stopTimer();
    if (typeof global.setInterval === 'function') S.timerId = global.setInterval(tick, 100);
  }

  function startBoss(region) {
    var api = ui();
    var c = C();
    if (!c) return { ok: false, code: 'NO_CAMPAIGN' };
    var bp = c.bossUnlockProgress(region, S.tier);
    if (!bp.unlocked) { api.toast('O desafio do chefe ainda não foi liberado.', 'error'); return { ok: false, code: 'BOSS_LOCKED' }; }
    var res = c.startBoss(region, S.tier);
    if (!res || !res.ok) {
      api.toast(res && res.errors && res.errors.length ? res.errors.join(' ') : 'Não foi possível iniciar o desafio.', 'error');
      return res || { ok: false, code: 'BOSS_FAILED' };
    }
    S.inFight = true;
    S.selected = null;
    S.lastOutcome = null;
    var opened = api.showScreen('boss', { history: false, clearHistory: true });
    api.hidden('#bq5-back', true);
    if (!opened || opened.ok === false) { c.abortFight(); S.inFight = false; return opened || { ok: false, code: 'SCREEN_FAILED' }; }
    renderBoss(res.fight);
    startTimer();
    return { ok: true, fight: res.fight };
  }

  function abortBoss(silent) {
    stopTimer();
    if (C()) C().abortFight();
    S.inFight = false;
    S.fightPhase = null;
    S.selected = null;
    if (!silent) show();
    return { ok: true };
  }

  function quitBoss() {
    ui().openModal({
      title: 'Sair do desafio?',
      message: 'Sair descarta esta luta e o checkpoint temporário: na próxima entrada o chefe volta a 100% do HP. O progresso salvo da campanha não é apagado. Não existe pausa: o relógio da pergunta continua correndo enquanto esta confirmação estiver aberta.',
      cancelLabel: 'Continuar lutando',
      confirmLabel: 'Sair do desafio',
      onConfirm: function () { abortBoss(false); }
    });
  }

  function setPhase(phase) {
    S.fightPhase = phase;
    var screen = ui().el('#screen-boss');
    if (screen) screen.setAttribute('data-phase', phase);
  }

  function renderBars(f) {
    var api = ui();
    api.text('#boss-player-hp', Math.round(f.playerHp));
    api.text('#boss-player-max', Math.round(f.playerMax));
    api.text('#boss-boss-hp', Math.round(f.bossHp));
    api.text('#boss-boss-max', Math.round(f.bossMax));
    setMeter('#boss-player-bar', f.playerMax ? f.playerHp / f.playerMax : 0);
    setMeter('#boss-boss-bar', f.bossMax ? f.bossHp / f.bossMax : 0);
    api.text('#boss-strike-count', f.strike);
  }

  function renderHand(f, interactive) {
    var api = ui();
    var buttons = api.all('.bq5-boss__card', api.el('#boss-hand'));
    buttons.forEach(function (b, i) {
      var card = f.hand[i];
      if (!card) { b.hidden = true; return; }
      b.hidden = false;
      var theme = b.querySelector('.bq5-boss__card-theme');
      var note = b.querySelector('.bq5-boss__card-note');
      if (theme) theme.textContent = themeLabel(card.theme);
      if (note) note.textContent = card.vulnerable ? 'Tema vulnerável: +0,5 de dano' : '';
      b.setAttribute('data-theme', card.theme);
      b.setAttribute('data-vulnerable', card.vulnerable ? 'true' : 'false');
      b.setAttribute('data-state', card.revealed ? 'chosen' : (interactive ? 'open' : 'closed'));
      b.disabled = !interactive;
      b.setAttribute('aria-label', 'Carta ' + (i + 1) + ': ' + themeLabel(card.theme) + (card.vulnerable ? ' (tema vulnerável)' : ''));
    });
  }

  function renderOptions(question, interactive) {
    var api = ui();
    var options = api.all('.bq5-option', api.el('#boss-options'));
    options.forEach(function (b, i) {
      var text = b.querySelector('.bq5-option__text');
      if (text) text.textContent = question && question.o[i] != null ? String(question.o[i]) : '';
      b.disabled = !interactive;
      b.removeAttribute('data-state');
      b.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-label', OPTION_LABELS[i] + ': ' + (question ? question.o[i] : ''));
    });
  }

  function currentQuestion(f) {
    for (var i = 0; i < f.hand.length; i++) if (f.hand[i].revealed && f.hand[i].question) return f.hand[i].question;
    return null;
  }

  function setBossButtons(opts) {
    var api = ui();
    api.hidden('#boss-confirm', !opts.confirm);
    api.hidden('#boss-retry', !opts.retry);
    api.hidden('#boss-finish', !opts.finish);
    var confirm = api.el('#boss-confirm');
    if (confirm) confirm.disabled = !!opts.confirmDisabled;
  }

  function renderBoss(f) {
    var api = ui();
    if (!f) return;
    var info = f.boss || {};
    api.text('#boss-title', bossName(info, f.region));
    api.text('#boss-name', bossName(info, f.region));
    api.text('#boss-problem', (info.problem ? info.problem + ' · ' : '') + regionLabel(f.region) + ' · ' + tierLabel(f.tier)
      + (info.vulnTheme ? ' · Vulnerável: ' + themeLabel(info.vulnTheme) : ''));
    renderBars(f);

    var box = api.el('#boss-question-box');
    var opts = api.el('#boss-options');
    var fb = api.el('#boss-feedback');
    var end = api.el('#boss-end');

    if (f.over) {
      setPhase('over');
      api.hidden('#boss-hand', true);
      if (box) box.hidden = true;
      if (opts) opts.hidden = true;
      api.hidden('#boss-end', false);
      end.setAttribute('data-outcome', f.over);
      if (f.over === 'win') {
        api.text('#boss-end-title', 'Vitória!');
        api.text('#boss-end-text', 'Você derrotou ' + bossName(info, f.region) + '. Conclua para salvar o progresso e liberar a próxima região.');
        setBossButtons({ finish: true });
      } else {
        var cp = f.checkpointHit ? ' O chefe recomeça em ' + f.checkpointPct + '% do HP (checkpoint desta sequência).' : ' O chefe recomeça com o HP cheio.';
        api.text('#boss-end-title', 'Você foi derrotado');
        api.text('#boss-end-text', 'Seu HP chegou a zero.' + cp);
        setBossButtons({ retry: true });
      }
      api.text('#boss-message', '');
      return;
    }

    api.hidden('#boss-end', true);
    var phase = f.phase;
    setPhase(phase);

    if (phase === 'choosing') {
      api.hidden('#boss-hand', false);
      renderHand(f, true);
      if (box) box.hidden = true;
      if (opts) opts.hidden = true;
      api.hidden('#boss-feedback', true);
      api.text('#boss-message', 'Escolha uma carta: você vê só o tema; a pergunta aparece depois.' + (f.checkpointHit ? ' Checkpoint ativo.' : ''));
      setBossButtons({});
    } else if (phase === 'revealing' || phase === 'answering') {
      api.hidden('#boss-hand', false);
      renderHand(f, false);
      var q = currentQuestion(f);
      if (box) box.hidden = false;
      if (opts) opts.hidden = false;
      api.hidden('#boss-feedback', true);
      api.text('#boss-question', q ? q.txt : '');
      renderOptions(q, false);
      setBossButtons({ confirm: true, confirmDisabled: true });
      api.text('#boss-message', 'Leia a pergunta — o tempo começa em instantes.');
    } else if (phase === 'gap') {
      api.text('#boss-message', 'Preparando a próxima mão…');
    }
  }

  function selectCard(index) {
    var c = C();
    if (!S.inFight || S.fightPhase !== 'choosing') return { ok: false, code: 'BAD_PHASE' };
    var res = c.selectCard(index);
    if (!res || !res.ok) {
      ui().toast(res && res.errors ? res.errors.join(' ') : 'Não foi possível escolher a carta.', 'error');
      return res || { ok: false };
    }
    var now = Date.now();
    S.revealEndAt = now + (isInt(bossCfg().revealDelayMs) ? bossCfg().revealDelayMs : 3000);
    S.answerEndAt = S.revealEndAt + res.fight.limitMs;
    S.selected = null;
    renderBoss(res.fight);
    tick();
    return res;
  }

  function selectAnswer(index) {
    if (!S.inFight || S.fightPhase !== 'answering' || !isInt(index) || index < 0 || index > 3) return false;
    S.selected = index;
    var api = ui();
    api.all('.bq5-option', api.el('#boss-options')).forEach(function (b, i) {
      if (i === index) { b.setAttribute('data-state', 'selected'); b.setAttribute('aria-pressed', 'true'); }
      else { b.removeAttribute('data-state'); b.setAttribute('aria-pressed', 'false'); }
    });
    setBossButtons({ confirm: true, confirmDisabled: false });
    return true;
  }

  function submit(choice) {
    var api = ui();
    var c = C();
    if (!S.inFight || (S.fightPhase !== 'answering' && S.fightPhase !== 'revealing')) return { ok: false, code: 'BAD_PHASE' };
    var f0 = c.fightSnapshot();
    var q = f0 ? currentQuestion(f0) : null;
    var res = c.answer(choice);
    if (!res || !res.ok) {
      if (res && res.code === 'TOO_EARLY') return res;
      api.toast(res && res.errors ? res.errors.join(' ') : 'Não foi possível registrar a resposta.', 'error');
      return res || { ok: false };
    }
    // revela gabarito
    var buttons = api.all('.bq5-option', api.el('#boss-options'));
    buttons.forEach(function (b, i) {
      b.disabled = true;
      if (q && i === q.a) b.setAttribute('data-state', 'correct');
      else if (!res.timedOut && i === choice) b.setAttribute('data-state', 'wrong');
      else b.setAttribute('data-state', 'dimmed');
    });
    var fb = api.el('#boss-feedback');
    if (fb) {
      fb.hidden = false;
      fb.setAttribute('data-kind', res.timedOut ? 'timeout' : (res.correct ? 'correct' : 'wrong'));
    }
    api.text('#boss-feedback-title', res.timedOut ? 'Tempo esgotado!' : (res.correct ? 'Acerto!' : 'Errou.'));
    var line = res.correct
      ? 'Você causou ' + Math.round(res.dealtToBoss) + ' de dano ao chefe. Sequência: ' + res.strike + '.'
      : 'Você perdeu ' + Math.round(res.dealtToPlayer) + ' de HP. A sequência foi zerada.';
    if (q && !res.correct) line += ' Resposta correta: ' + q.o[q.a] + '.';
    if (q && q.e) line += ' ' + q.e;
    api.text('#boss-feedback-text', line);
    api.emit('sfx:play', { cue: res.correct ? 'correct' : (res.timedOut ? 'timeout' : 'wrong') });
    S.selected = null;
    renderBars(res.fight);
    setBossButtons({ confirm: false });
    if (res.over) {
      stopTimer();
      // mantém a pergunta/feedback visíveis por um instante só no estado final: mostra o painel final por cima
      renderBoss(res.fight);
      api.hidden('#boss-feedback', false);
    } else {
      setPhase('gap');
      api.text('#boss-message', 'Próxima mão em instantes…');
    }
    return res;
  }

  function confirm() {
    if (S.selected === null) return { ok: false, code: 'NO_SELECTION' };
    return submit(S.selected);
  }

  function retry() {
    var res = C().retry();
    if (!res || !res.ok) {
      ui().toast(res && res.errors ? res.errors.join(' ') : 'Não foi possível reiniciar a luta.', 'error');
      return res || { ok: false };
    }
    S.selected = null;
    ui().hidden('#boss-feedback', true);
    renderBoss(res.fight);
    startTimer();
    return res;
  }

  function finish() {
    var res = C().completeFight();
    if (!res || !res.ok) {
      ui().toast(res && res.errors ? res.errors.join(' ') : 'Não foi possível concluir o desafio.', 'error');
      return res || { ok: false };
    }
    stopTimer();
    S.inFight = false;
    S.fightPhase = null;
    var r = res.result;
    var msg = r.allDone
      ? 'Dificuldade ' + tierLabel(r.tier) + ' concluída! Todos os chefes foram vencidos.'
      : (r.nextRegion ? 'Região desbloqueada: ' + regionLabel(r.nextRegion) + '.' : 'Região concluída.');
    ui().toast(msg, 'success');
    S.expanded = r.nextRegion || null;
    show();
    return res;
  }

  // Relógio da luta: a UI só observa; as regras estão em campaign.js.
  function tick() {
    if (!S.inFight) return;
    var c = C();
    var f = c.fightSnapshot();
    if (!f || f.over) { stopTimer(); return; }
    var api = ui();
    var now = Date.now();

    if (f.phase === 'revealing' || f.phase === 'answering') {
      if (S.fightPhase === 'revealing') {
        if (now < S.revealEndAt) {
          var wait = Math.ceil((S.revealEndAt - now) / 1000);
          api.text('#boss-time-left', Math.round(f.limitMs / 1000) + ' s');
          setMeter('#boss-timer', 1);
          api.text('#boss-message', 'Leia a pergunta — o tempo começa em ' + wait + ' s.');
          return;
        }
        // fim da pausa de revelação: libera as alternativas e inicia o relógio da resposta
        api.all('.bq5-option', api.el('#boss-options')).forEach(function (b) { b.disabled = false; });
        setPhase('answering');
        api.text('#boss-message', 'Selecione uma alternativa e confirme.');
      }
      if (S.fightPhase === 'answering') {
        var remaining = Math.max(0, S.answerEndAt - now);
        var ratio = f.limitMs > 0 ? remaining / f.limitMs : 0;
        var timer = api.el('#boss-timer');
        var secs = Math.ceil(remaining / 1000);
        if (timer) {
          timer.setAttribute('data-level', ratio < 0.2 ? 'danger' : (ratio < 0.5 ? 'warn' : 'ok'));
          timer.setAttribute('aria-label', 'Tempo restante: ' + secs + ' segundos');
        }
        setMeter('#boss-timer', ratio);
        api.text('#boss-time-left', secs + ' s');
        if (remaining <= 0) submit(-1); // tempo esgotado
      }
      return;
    }

    if (f.phase === 'gap') {
      var left = c.remainingMs();
      if (left !== null && left <= 0) {
        var next = c.nextHand();
        if (next && next.ok) {
          S.selected = null;
          api.hidden('#boss-feedback', true);
          renderBoss(next.fight);
        }
      }
    }
  }

  // ---------- inicialização ----------

  function bindActions() {
    var api = ui();
    unsubscribers.push(api.on('intent:campaign', function () { show(); }));
    unsubscribers.push(api.on('results:campaign', function () { show(); }));
    unsubscribers.push(api.on('game:finished', onGameFinished));
    unsubscribers.push(api.onAction('campaign-tier', function (d) { selectTier(d.value); }));
    unsubscribers.push(api.onAction('campaign-stage', function (d) { toggleRegion(d.value); }));
    unsubscribers.push(api.onAction('campaign-point', function (d) { startPoint(d.value); }));
    unsubscribers.push(api.onAction('campaign-boss', function (d) { startBoss(d.value); }));
    unsubscribers.push(api.onAction('campaign-reset', resetTier));
    unsubscribers.push(api.onAction('boss-card', function (d) { selectCard(Number(d.value)); }));
    unsubscribers.push(api.onAction('boss-confirm', confirm));
    unsubscribers.push(api.onAction('boss-quit', quitBoss));
    unsubscribers.push(api.onAction('boss-retry', retry));
    unsubscribers.push(api.onAction('boss-finish', finish));
    unsubscribers.push(api.on('screen:change', function (detail) {
      if (!detail) return;
      // Outro módulo trocou a tela durante a luta: descarta a luta (sem persistir).
      if (S.inFight && detail.from === 'boss' && detail.to !== 'boss') abortBoss(true);
    }));
    var options = api.el('#boss-options');
    if (options && options.addEventListener) {
      options.addEventListener('click', function (event) {
        var target = event && event.target;
        if (!target) return;
        if (target.nodeType === 3) target = target.parentElement;
        var button = target && target.closest ? target.closest('.bq5-option[data-index]') : null;
        if (!button || button.disabled) return;
        selectAnswer(Number(button.getAttribute('data-index')));
      });
    }
  }

  function init() {
    if (initialized) return { ok: true, alreadyInitialized: true };
    if (!ui() || typeof ui().onAction !== 'function') return { ok: false, code: 'NO_UI' };
    bindActions();
    initialized = true;
    return { ok: true };
  }

  var Campaign = {
    init: init,
    show: show,
    render: renderMap,
    selectTier: selectTier,
    startPoint: startPoint,
    replayPoint: replayPoint,
    startBoss: startBoss,
    selectCard: selectCard,
    selectAnswer: selectAnswer,
    confirm: confirm,
    tick: tick,
    state: function () {
      return { tier: S.tier, expanded: S.expanded, inFight: S.inFight, fightPhase: S.fightPhase, point: S.point ? { region: S.point.region, tier: S.point.tier, id: S.point.id } : null };
    },
    destroy: function () {
      stopTimer();
      unsubscribers.forEach(function (off) { if (typeof off === 'function') off(); });
      unsubscribers = [];
      initialized = false;
      return { ok: true };
    }
  };

  BQ5.screens = BQ5.screens || {};
  BQ5.screens.campaign = Campaign;
  if (global.document) init();
})(globalThis);
