/* ============================================================
 * Brasil em 5 Eixos — Módulo 12: Campanha regional
 * Responsabilidade: percurso regional, pontos temáticos, dificuldade
 * e persistência da progressão. O M5 continua responsável por perguntas,
 * alternativas, relógio, respostas e pontuação.
 *
 * Compatibilidade com o engine M5 legado (campanha fixa em Normal/6 itens):
 * esta tela cria um adaptador síncrono e limitado à chamada de start(),
 * filtrando bank.list() para a região/tema/tier e ajustando temporariamente
 * o número de itens e a duração que o engine captura ao iniciar a partida.
 * Nenhuma regra de resposta/pontuação/cronômetro é duplicada aqui.
 *
 * Escopo desta versão: sem ponto de desafio, chefes, HP ou recompensa de chefe.
 * Não existe pausa.
 * ============================================================ */
(function (global) {
  'use strict';

  var BQ5 = global.BQ5 = global.BQ5 || {};
  var KEY = 'bq5_campaign_v2';
  var QUESTIONS_PER_STOP = 10;
  var initialized = false;
  var unsubscribers = [];
  var selectedDifficulty = null;
  var selectedRegion = null;
  var activeRun = null;
  var lastRun = null;
  var originalCompleteStage = null;
  var originalEngineState = null;
  var contextRun = null;

  function ui() { return BQ5.ui || null; }
  function config() { return BQ5.config || {}; }
  function bank() { return BQ5.bank || null; }
  function engine() { return BQ5.engine || null; }
  function storage() { return BQ5.storage || null; }
  function isObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
  function isInteger(value) { return typeof value === 'number' && isFinite(value) && Math.floor(value) === value; }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function safeText(value) { return String(value == null ? '' : value); }

  function regions() {
    var c = config();
    return Array.isArray(c.campaignStages) && c.campaignStages.length
      ? c.campaignStages.slice()
      : (Array.isArray(c.regions) ? c.regions.slice() : []);
  }

  function difficultyKeys() {
    var tiers = config().tiers || {};
    return Object.keys(tiers).filter(function (key) { return Array.isArray(tiers[key]); });
  }

  function difficultyLabel(key) {
    var labels = config().tierLabels || {};
    return labels[key] || key;
  }

  function thresholdFor(key) {
    // 'medio' não possui corte próprio no esboço; usa o corte do Normal.
    var cuts = { edu: 50, normal: 60, medio: 60, dificil: 70, geografo: 70 };
    return Object.prototype.hasOwnProperty.call(cuts, key) ? cuts[key] : 60;
  }

  function stopsFor(key) {
    var c = config();
    if (key === 'geografo') {
      return [
        { id: 'mistura-1', theme: 'all', label: 'Brasil em foco I', hint: 'Questões misturadas dos cinco eixos' },
        { id: 'mistura-2', theme: 'all', label: 'Brasil em foco II', hint: 'Uma nova rodada com os cinco eixos' },
        { id: 'mistura-3', theme: 'all', label: 'Brasil em foco III', hint: 'Última rodada temática da região' }
      ];
    }
    return (Array.isArray(c.themes) ? c.themes : []).map(function (theme) {
      return {
        id: theme,
        theme: theme,
        label: (c.themeLabels || {})[theme] || theme,
        hint: '10 questões sobre ' + ((c.themeLabels || {})[theme] || theme) + ' nesta região'
      };
    });
  }

  function defaultProgress() {
    return { version: 2, selectedDifficulty: 'normal', difficulties: {} };
  }

  function readProgress() {
    var s = storage();
    var saved = s && typeof s.getJSON === 'function' ? s.getJSON(KEY, null) : null;
    if (!isObject(saved) || saved.version !== 2 || !isObject(saved.difficulties)) return defaultProgress();
    return saved;
  }

  function writeProgress(progress) {
    var s = storage();
    if (!s || typeof s.setJSON !== 'function') return false;
    s.setJSON(KEY, progress);
    return true;
  }

  function difficultyProgress(progress, diff) {
    progress.difficulties = progress.difficulties || {};
    if (!isObject(progress.difficulties[diff])) progress.difficulties[diff] = { regions: {} };
    var result = progress.difficulties[diff];
    if (!isObject(result.regions)) result.regions = {};
    return result;
  }

  function regionProgress(progress, diff, region) {
    var dp = difficultyProgress(progress, diff);
    if (!isObject(dp.regions[region])) dp.regions[region] = { stops: {}, completed: false };
    var rp = dp.regions[region];
    if (!isObject(rp.stops)) rp.stops = {};
    return rp;
  }

  function stopProgress(progress, diff, region, stopId) {
    var rp = regionProgress(progress, diff, region);
    if (!isObject(rp.stops[stopId])) {
      rp.stops[stopId] = {
        attempts: 0, bestScore: 0, bestRight: 0, bestPct: 0,
        total: QUESTIONS_PER_STOP, lastScore: 0, lastRight: 0
      };
    }
    return rp.stops[stopId];
  }

  function getRegionSummary(progress, diff, region) {
    var rp = regionProgress(progress, diff, region);
    var stops = stopsFor(diff);
    var right = 0;
    var total = stops.length * QUESTIONS_PER_STOP;
    var attempts = 0;
    var bestScore = 0;
    var completedStops = 0;

    stops.forEach(function (stop) {
      var rec = rp.stops[stop.id];
      if (!rec) return;
      attempts += Number(rec.attempts) || 0;
      if ((Number(rec.attempts) || 0) > 0) completedStops++;
      right += Math.max(0, Math.min(QUESTIONS_PER_STOP, Number(rec.bestRight) || 0));
      bestScore += Math.max(0, Number(rec.bestScore) || 0);
    });

    var pct = total ? Math.round((right / total) * 100) : 0;
    var allAttempted = completedStops === stops.length;
    var threshold = thresholdFor(diff);
    var passed = allAttempted && pct >= threshold;
    return {
      region: region, diff: diff, stopCount: stops.length,
      completedStops: completedStops, attempts: attempts,
      right: right, total: total, pct: pct,
      threshold: threshold, passed: passed,
      completed: rp.completed === true || passed,
      bestScore: bestScore
    };
  }

  function isRegionUnlocked(progress, diff, region) {
    var list = regions();
    var index = list.indexOf(region);
    if (index < 0) return false;
    if (index === 0) return true;
    return getRegionSummary(progress, diff, list[index - 1]).completed;
  }

  function countCompletedRegions(progress, diff) {
    return regions().filter(function (region) {
      return getRegionSummary(progress, diff, region).completed;
    }).length;
  }

  function getSelectedDifficulty() {
    var saved = readProgress();
    var keys = difficultyKeys();
    if (keys.indexOf(selectedDifficulty) !== -1) return selectedDifficulty;
    if (keys.indexOf(saved.selectedDifficulty) !== -1) return saved.selectedDifficulty;
    return keys.indexOf('normal') !== -1 ? 'normal' : (keys[0] || 'normal');
  }

  function saveSelectedDifficulty(diff) {
    var progress = readProgress();
    if (difficultyKeys().indexOf(diff) === -1) return false;
    selectedDifficulty = diff;
    progress.selectedDifficulty = diff;
    writeProgress(progress);
    return true;
  }

  function ensureCampaignDom() {
    var api = ui();
    if (!api || !global.document) return null;
    var screen = api.el('#screen-campaign');
    if (!screen) return null;

    var selector = api.el('#campaign-difficulty-wrap');
    if (!selector) {
      selector = global.document.createElement('div');
      selector.id = 'campaign-difficulty-wrap';
      selector.className = 'bq5-campaign-difficulty';
      var label = global.document.createElement('label');
      label.className = 'bq5-label';
      label.setAttribute('for', 'campaign-difficulty');
      label.textContent = 'Dificuldade da campanha';
      var select = global.document.createElement('select');
      select.id = 'campaign-difficulty';
      select.className = 'bq5-input';
      select.setAttribute('aria-label', 'Dificuldade da campanha');
      selector.appendChild(label);
      selector.appendChild(select);
      var head = screen.querySelector('.bq5-screen__head');
      if (head && head.parentNode) head.parentNode.insertBefore(selector, head.nextSibling);
      else screen.insertBefore(selector, screen.firstChild);
    }

    var note = api.el('#campaign-difficulty-status');
    if (!note) {
      note = global.document.createElement('p');
      note.id = 'campaign-difficulty-status';
      note.className = 'bq5-hint';
      selector.parentNode.insertBefore(note, selector.nextSibling);
    }

    var detail = api.el('#campaign-detail');
    if (!detail) {
      detail = global.document.createElement('section');
      detail.id = 'campaign-detail';
      detail.className = 'bq5-campaign-detail';
      detail.setAttribute('aria-live', 'polite');
      var route = api.el('#campaign-route');
      if (route && route.parentNode) route.parentNode.insertBefore(detail, route.nextSibling);
      else screen.appendChild(detail);
    }

    var selectNode = api.el('#campaign-difficulty');
    if (selectNode && !selectNode.__bq5Bound) {
      selectNode.addEventListener('change', function () {
        var value = selectNode.value;
        if (!saveSelectedDifficulty(value)) return;
        selectedRegion = null;
        render();
      });
      selectNode.__bq5Bound = true;
    }
    return screen;
  }

  function renderDifficultySelector() {
    var api = ui();
    if (!api || !global.document) return;
    var select = api.el('#campaign-difficulty');
    if (!select) return;
    var keys = difficultyKeys();
    var chosen = getSelectedDifficulty();
    while (select.firstChild) select.removeChild(select.firstChild);
    keys.forEach(function (key) {
      var option = global.document.createElement('option');
      option.value = key;
      option.textContent = difficultyLabel(key);
      select.appendChild(option);
    });
    select.value = chosen;
    selectedDifficulty = chosen;
  }

  function appendText(parent, tag, className, value) {
    var node = global.document.createElement(tag || 'p');
    if (className) node.className = className;
    node.textContent = safeText(value);
    parent.appendChild(node);
    return node;
  }

  function renderRegions(progress, diff) {
    var api = ui();
    if (!api || !global.document) return;
    var list = api.el('#campaign-route');
    if (!list) return;
    while (list.firstChild) list.removeChild(list.firstChild);
    var template = api.cloneTemplate('tpl-route-node');
    var stageList = regions();
    stageList.forEach(function (region, index) {
      var summary = getRegionSummary(progress, diff, region);
      var unlocked = isRegionUnlocked(progress, diff, region);
      var state = summary.completed ? 'done' : (unlocked ? 'available' : 'locked');
      var item;
      if (template && template.querySelector) {
        item = template.querySelector('.bq5-route__node');
        if (item) item = item.cloneNode(true);
      }
      if (!item) {
        item = global.document.createElement('li');
        item.className = 'bq5-route__node';
        var button = global.document.createElement('button');
        button.className = 'bq5-route__card';
        button.type = 'button';
        item.appendChild(button);
      }
      item.setAttribute('data-state', state);
      item.setAttribute('data-region', region);
      var badge = item.querySelector('.bq5-route__badge');
      var buttonNode = item.querySelector('button');
      var name = item.querySelector('.bq5-route__name');
      var best = item.querySelector('.bq5-route__best');
      var label = item.querySelector('.bq5-route__state');
      if (badge) badge.textContent = summary.completed ? '✓' : String(index + 1);
      if (name) name.textContent = (config().regionLabels || {})[region] || region;
      if (best) best.textContent = summary.completedStops + '/' + summary.stopCount + ' pontos · ' + summary.pct + '% de acertos';
      if (label) label.textContent = summary.completed ? 'Concluída' : (unlocked ? 'Disponível' : 'Bloqueada');
      if (buttonNode) {
        buttonNode.setAttribute('data-action', 'campaign-open-region');
        buttonNode.setAttribute('data-value', region);
        buttonNode.disabled = !unlocked;
        buttonNode.setAttribute('aria-label', ((config().regionLabels || {})[region] || region) + (unlocked ? ', abrir região' : ', bloqueada'));
      }
      list.appendChild(item);
    });
  }

  function renderRegionDetail(progress, diff) {
    var api = ui();
    if (!api || !global.document) return;
    var detail = api.el('#campaign-detail');
    if (!detail) return;
    while (detail.firstChild) detail.removeChild(detail.firstChild);
    if (!selectedRegion) {
      detail.hidden = true;
      return;
    }
    detail.hidden = false;
    var label = (config().regionLabels || {})[selectedRegion] || selectedRegion;
    var summary = getRegionSummary(progress, diff, selectedRegion);
    appendText(detail, 'h2', 'bq5-section__title', label + ' — pontos temáticos');
    appendText(detail, 'p', 'bq5-hint', 'Cada ponto tem 10 questões. Para liberar a próxima região, alcance ' + summary.threshold + '% de acertos no conjunto dos pontos desta região. Você pode repetir qualquer ponto; o melhor resultado é preservado.');
    if (diff === 'geografo') {
      appendText(detail, 'p', 'bq5-campaign-warning', 'No Geógrafo, o banco regional atual é menor que 30 questões em algumas regiões; por isso, questões podem reaparecer entre pontos diferentes. Não há repetição dentro de uma mesma partida.');
    }
    var summaryLine = appendText(detail, 'p', 'bq5-campaign-summary', summary.right + '/' + summary.total + ' acertos · ' + summary.pct + '% · ' + summary.completedStops + '/' + summary.stopCount + ' pontos tentados');
    if (summary.completed) summaryLine.textContent += ' · Região concluída';

    var grid = global.document.createElement('div');
    grid.className = 'bq5-campaign-stops';
    stopsFor(diff).forEach(function (stop, index) {
      var record = stopProgress(progress, diff, selectedRegion, stop.id);
      var card = global.document.createElement('button');
      card.type = 'button';
      card.className = 'bq5-campaign-stop';
      card.setAttribute('data-action', 'campaign-start-stop');
      card.setAttribute('data-value', stop.id);
      var title = appendText(card, 'span', 'bq5-campaign-stop__title', (index + 1) + '. ' + stop.label);
      var hint = appendText(card, 'span', 'bq5-campaign-stop__hint', stop.hint);
      var status = record.attempts > 0
        ? 'Melhor: ' + record.bestRight + '/' + QUESTIONS_PER_STOP + ' (' + record.bestPct + '%) · ' + record.bestScore + ' pts · ' + record.attempts + ' tentativa(s)'
        : 'Ainda não realizado';
      appendText(card, 'span', 'bq5-campaign-stop__status', status);
      if (record.attempts > 0) card.setAttribute('data-attempted', 'true');
      if (summary.completed) card.setAttribute('data-region-done', 'true');
      grid.appendChild(card);
    });
    detail.appendChild(grid);

    var back = global.document.createElement('button');
    back.type = 'button';
    back.className = 'bq5-btn bq5-btn--ghost bq5-btn--block';
    back.setAttribute('data-action', 'campaign-back-regions');
    back.textContent = 'Voltar às regiões';
    detail.appendChild(back);

    if (summary.completed) {
      appendText(detail, 'p', 'bq5-campaign-unlocked',
        'Meta regional alcançada. ' + (regions().indexOf(selectedRegion) < regions().length - 1
          ? 'A próxima região foi liberada.'
          : 'Você concluiu as cinco regiões nesta dificuldade.')
      );
    } else if (summary.completedStops === summary.stopCount) {
      appendText(detail, 'p', 'bq5-campaign-warning', 'Você já realizou todos os pontos, mas ainda não alcançou a meta de ' + summary.threshold + '%. Repita os pontos necessários para melhorar seu aproveitamento.');
    }
  }

  function render() {
    var api = ui();
    if (!api) return { ok: false, code: 'NO_UI' };
    ensureCampaignDom();
    renderDifficultySelector();
    var progress = readProgress();
    var diff = getSelectedDifficulty();
    var done = countCompletedRegions(progress, diff);
    var total = regions().length;
    var pct = total ? Math.round((done / total) * 100) : 0;
    api.text('#campaign-done', done);
    api.text('#campaign-total', total);
    var bar = api.el('#campaign-progress');
    if (bar) {
      bar.setAttribute('aria-valuenow', String(done));
      bar.setAttribute('aria-valuetext', done + ' de ' + total + ' regiões concluídas');
      if (bar.style && typeof bar.style.setProperty === 'function') bar.style.setProperty('--p', String(total ? done / total : 0));
    }
    api.text('#campaign-difficulty-status', difficultyLabel(diff) + ' · meta regional: ' + thresholdFor(diff) + '% de acertos. Todos os níveis estão disponíveis nesta versão de teste.');
    api.text('#campaign-title', 'Campanha');
    renderRegions(progress, diff);
    renderRegionDetail(progress, diff);
    return { ok: true, diff: diff, completedRegions: done, totalRegions: total };
  }

  function show(region) {
    var ready = init();
    if (!ready.ok) return ready;
    if (region && regions().indexOf(region) !== -1) selectedRegion = region;
    render();
    return ui().showScreen('campaign', { history: false, clearHistory: true });
  }

  function buildPool(region, stop, diff) {
    var b = bank();
    if (!b || typeof b.list !== 'function' || typeof b.loaded === 'function' && !b.loaded()) {
      return { ok: false, code: 'NO_BANK', errors: ['O banco de questões ainda não está carregado.'] };
    }
    var all = b.list();
    if (!Array.isArray(all)) return { ok: false, code: 'BAD_BANK', errors: ['A lista de questões não está disponível.'] };
    var tiers = config().tiers || {};
    var allowed = Array.isArray(tiers[diff]) ? tiers[diff] : [];
    if (!allowed.length) return { ok: false, code: 'BAD_DIFF', errors: ['A dificuldade selecionada não possui níveis de questões configurados.'] };

    function isTarget(q) {
      return q && q.region === region && (stop.theme === 'all' || q.theme === stop.theme);
    }
    var strict = all.filter(function (q) { return isTarget(q) && allowed.indexOf(q.difficulty) !== -1; });
    if (strict.length >= QUESTIONS_PER_STOP) {
      return { ok: true, pool: strict, fallback: false, available: strict.length };
    }
    // Fallback controlado: mantém região e tema, ampliando apenas a faixa de
    // dificuldade para não completar a partida com perguntas de outras regiões.
    var regionalTheme = all.filter(isTarget);
    if (regionalTheme.length >= QUESTIONS_PER_STOP) {
      return { ok: true, pool: regionalTheme, fallback: true, available: regionalTheme.length };
    }
    return {
      ok: false, code: 'NOT_ENOUGH_QUESTIONS',
      errors: ['Este ponto tem apenas ' + regionalTheme.length + ' questões cadastradas nesta região. São necessárias 10 para iniciar.'],
      available: regionalTheme.length
    };
  }

  function installStorageGuard() {
    var s = storage();
    if (!s || typeof s.completeStage !== 'function' || originalCompleteStage) return;
    originalCompleteStage = s.completeStage;
    s.completeStage = function (region, score) {
      // O engine legado conclui uma região após qualquer partida de campanha.
      // Durante um ponto do M12, impedir esse efeito e deixar a meta agregada
      // do M12 decidir quando a região realmente termina.
      if (activeRun && activeRun.region === region) {
        var best = {}; best[region] = Number(score) || 0;
        return { progress: { done: {}, best: best }, allDone: false };
      }
      return originalCompleteStage.apply(s, arguments);
    };
  }


  function installEngineStateAdapter() {
    var e = engine();
    if (!e || typeof e.state !== 'function' || originalEngineState) return;
    originalEngineState = e.state;
    e.state = function () {
      var snapshot = originalEngineState.apply(e, arguments);
      if (snapshot && snapshot.mode === 'campaign' && contextRun) {
        snapshot.diff = contextRun.diff;
        snapshot.theme = contextRun.theme;
        snapshot.region = contextRun.region;
      }
      return snapshot;
    };
  }

  function startStop(region, stopId) {
    var ready = init();
    if (!ready.ok) return ready;
    var diff = getSelectedDifficulty();
    var progress = readProgress();
    if (!isRegionUnlocked(progress, diff, region)) {
      ui().toast('Conclua a região anterior para liberar esta etapa.', 'info');
      return { ok: false, code: 'REGION_LOCKED' };
    }
    var stop = stopsFor(diff).filter(function (item) { return item.id === stopId; })[0];
    if (!stop) return { ok: false, code: 'BAD_STOP' };
    if (!engine() || typeof engine().start !== 'function' || !BQ5.screens || !BQ5.screens.play || typeof BQ5.screens.play.show !== 'function') {
      return { ok: false, code: 'NO_GAME_MODULES' };
    }
    var selection = buildPool(region, stop, diff);
    if (!selection.ok) {
      ui().toast(selection.errors.join(' '), 'error');
      return selection;
    }

    var b = bank();
    var c = config();
    var oldList = b.list;
    var oldCount = c.campaignQuestionsPerStage;
    var oldTimeObject = c.questionTimeMs;
    var oldNormalTime;
    var requestedTime = c.questionTimeMs && typeof c.questionTimeMs === 'object'
      ? c.questionTimeMs[diff]
      : c.questionTimeMs;
    if (!isInteger(requestedTime) || requestedTime <= 0) requestedTime = c.questionTimeDefaultMs || 15000;

    // A adaptação fica restrita ao início síncrono: o engine copia o quiz e
    // captura o tempo em G.limitMs antes de as funções/configuração voltarem.
    try {
      b.list = function () { return selection.pool.slice(); };
      c.campaignQuestionsPerStage = QUESTIONS_PER_STOP;
      if (oldTimeObject && typeof oldTimeObject === 'object') {
        oldNormalTime = oldTimeObject.normal;
        oldTimeObject.normal = requestedTime;
      } else {
        c.questionTimeMs = requestedTime;
      }
      var started = engine().start({ mode: 'campaign', region: region });
      if (!started || !started.ok) {
        ui().toast(started && started.errors ? started.errors.join(' ') : 'Não foi possível iniciar o ponto.', 'error');
        return started || { ok: false, code: 'START_FAILED' };
      }
    } finally {
      b.list = oldList;
      c.campaignQuestionsPerStage = oldCount;
      if (oldTimeObject && typeof oldTimeObject === 'object') oldTimeObject.normal = oldNormalTime;
      else c.questionTimeMs = oldTimeObject;
    }

    activeRun = {
      region: region, diff: diff, stopId: stop.id,
      theme: stop.theme, stopLabel: stop.label,
      fallback: selection.fallback, startedAt: Date.now()
    };
    lastRun = clone(activeRun);
    contextRun = clone(activeRun);
    installStorageGuard();
    installEngineStateAdapter();
    var shown = BQ5.screens.play.show();
    if (!shown || shown.ok === false) {
      if (engine().abort) engine().abort();
      activeRun = null;
      return shown || { ok: false, code: 'PLAY_SCREEN_FAILED' };
    }
    selectedRegion = region;
    ui().emit('game:started', {
      mode: 'campaign', region: region, theme: stop.theme,
      diff: diff, count: QUESTIONS_PER_STOP, stopId: stop.id
    });
    if (selection.fallback) {
      ui().toast('Para completar 10 questões, este ponto usou outras faixas de dificuldade, mantendo região e tema.', 'info');
    }
    return { ok: true, game: engine().state(), stop: clone(stop), fallback: selection.fallback };
  }

  function registerResult(result) {
    if (!activeRun || !result || result.mode !== 'campaign') return;
    var run = clone(activeRun);
    var progress = readProgress();
    var rec = stopProgress(progress, run.diff, run.region, run.stopId);
    var right = Math.max(0, Math.min(QUESTIONS_PER_STOP, Number(result.right) || 0));
    var score = Math.max(0, Number(result.score) || 0);
    rec.attempts = (Number(rec.attempts) || 0) + 1;
    rec.lastRight = right;
    rec.lastScore = score;
    rec.total = QUESTIONS_PER_STOP;
    // O melhor resultado é um único registro coerente: uma pontuação maior
    // substitui também os acertos correspondentes daquela tentativa. Em empate
    // de pontos, preferimos a tentativa com mais acertos para o corte regional.
    var previousBestScore = Number(rec.bestScore) || 0;
    var previousBestRight = Number(rec.bestRight) || 0;
    if (score > previousBestScore || (score === previousBestScore && right > previousBestRight)) {
      rec.bestScore = score;
      rec.bestRight = right;
      rec.bestPct = Math.round((right / QUESTIONS_PER_STOP) * 100);
    }

    var summary = getRegionSummary(progress, run.diff, run.region);
    var rp = regionProgress(progress, run.diff, run.region);
    var newlyCompleted = summary.passed && rp.completed !== true;
    if (summary.passed) rp.completed = true;
    writeProgress(progress);

    // Alimenta também a barra geral do M8 (progresso global, independente da
    // dificuldade). A fonte detalhada e separada continua sendo a chave M12.
    if (newlyCompleted && originalCompleteStage && storage()) {
      try { originalCompleteStage.call(storage(), run.region, summary.bestScore); } catch (ignored) {}
    }

    result.diff = run.diff;
    result.theme = run.theme;
    result.region = run.region;
    result.campaignStop = { id: run.stopId, label: run.stopLabel, fallback: run.fallback };
    result.pct = Math.round((right / QUESTIONS_PER_STOP) * 100);
    result.stage = {
      region: run.region,
      done: summary.completed,
      best: summary.bestScore,
      allDone: countCompletedRegions(progress, run.diff) === regions().length
    };
    lastRun = run;
    contextRun = run;
    activeRun = null;
  }

  function resetCampaign() {
    var api = ui();
    if (!api) return { ok: false, code: 'NO_UI' };
    api.openModal({
      title: 'Recomeçar campanha?',
      message: 'Todo o progresso regional desta campanha será apagado em todas as dificuldades.',
      cancelLabel: 'Cancelar',
      confirmLabel: 'Recomeçar',
      onConfirm: function () {
        var progress = defaultProgress();
        progress.selectedDifficulty = getSelectedDifficulty();
        writeProgress(progress);
        if (storage() && typeof storage().resetCampaign === 'function') storage().resetCampaign();
        selectedRegion = null;
        render();
        api.toast('Progresso da campanha reiniciado.', 'success');
        api.closeModal();
      }
    });
    return { ok: true };
  }

  function backToRegions() {
    selectedRegion = null;
    return render();
  }

  function returnToMap() {
    var region = lastRun && lastRun.region ? lastRun.region : selectedRegion;
    selectedRegion = region || null;
    return show(selectedRegion);
  }

  function replayLastStop() {
    if (!lastRun) return { ok: false, code: 'NO_CAMPAIGN_STAGE' };
    return startStop(lastRun.region, lastRun.stopId);
  }

  function bindActions() {
    var api = ui();
    unsubscribers.push(api.on('intent:campaign', function () { show(); }));
    unsubscribers.push(api.onAction('campaign-open-region', function (detail) {
      var region = detail && detail.value;
      if (!region) return;
      var progress = readProgress();
      if (!isRegionUnlocked(progress, getSelectedDifficulty(), region)) {
        api.toast('Esta região ainda está bloqueada.', 'info');
        return;
      }
      selectedRegion = region;
      render();
    }));
    unsubscribers.push(api.onAction('campaign-start-stop', function (detail) {
      if (!selectedRegion || !detail || !detail.value) return;
      startStop(selectedRegion, detail.value);
    }));
    unsubscribers.push(api.onAction('campaign-back-regions', backToRegions));
    unsubscribers.push(api.onAction('campaign-reset', resetCampaign));
    unsubscribers.push(api.on('game:finished', registerResult));
    unsubscribers.push(api.on('results:campaign', returnToMap));
    unsubscribers.push(api.on('results:replay', replayLastStop));
    unsubscribers.push(api.on('screen:change', function (detail) {
      if (!detail) return;
      if (detail.from === 'play' && detail.to !== 'play' && detail.to !== 'results') {
        // Ao abandonar uma partida, o M10 chama engine.abort(); não persistir
        // progresso parcial e liberar o estado de execução do adaptador.
        activeRun = null;
        contextRun = null;
      }
      if (detail.from === 'results' && detail.to !== 'play') contextRun = null;
    }));
  }

  function init() {
    if (initialized) return { ok: true, alreadyInitialized: true };
    if (!ui() || typeof ui().on !== 'function' || typeof ui().onAction !== 'function') return { ok: false, code: 'NO_UI' };
    installStorageGuard();
    installEngineStateAdapter();
    bindActions();
    ensureCampaignDom();
    initialized = true;
    return { ok: true };
  }

  var Campaign = {
    init: init,
    show: show,
    render: render,
    startStop: startStop,
    getProgress: readProgress,
    getStops: stopsFor,
    getRegionSummary: function (region, diff) { return getRegionSummary(readProgress(), diff || getSelectedDifficulty(), region); },
    isRegionUnlocked: function (region, diff) { return isRegionUnlocked(readProgress(), diff || getSelectedDifficulty(), region); },
    selectedDifficulty: getSelectedDifficulty,
    selectDifficulty: saveSelectedDifficulty,
    thresholdFor: thresholdFor,
    reset: resetCampaign
  };

  BQ5.screens = BQ5.screens || {};
  BQ5.screens.campaign = Campaign;
  if (global.document) init();
})(globalThis);
