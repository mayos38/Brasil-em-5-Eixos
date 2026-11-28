/* ============================================================
 * Brasil em 5 Eixos — Módulo 11: resultados da partida
 * Responsabilidade: apresentar o resultado oficial do engine, revisar
 * respostas/explicações e registrar um resumo persistente do confronto.
 *
 * Não recalcula pontuação, não escolhe questões e não grava recordes por
 * conta própria. O engine continua sendo a fonte da verdade do resultado;
 * o storage é acessado somente por sua API pública getJSON/setJSON.
 *
 * Para os módulos 13/14, a tela aceita resultado 1x1/multiplayer com:
 *   { mode:'1v1'|'multiplayer'|'local'|'lan', outcome:'win'|'loss'|'draw',
 *     playerId, winnerId, players:[{id,name,score,right,total,rank}], review }
 * O título Vitória / Você perdeu só é exibido quando o desfecho é explícito.
 *
 * Regra permanente: não implementar pausa. Este módulo não suspende relógio,
 * nem cria estado, ação ou fluxo de pausa/retomada.
 * ============================================================ */
(function (global) {
  'use strict';

  var BQ5 = global.BQ5 = global.BQ5 || {};
  var initialized = false;
  var unsubscribers = [];
  var currentResult = null;
  var currentReview = [];
  var lastRecordedGame = false;
  var gameStartedAt = null;
  var recordSequence = 0;
  var HISTORY_LIMIT = 60;
  var HISTORY_KEY = 'bq5_match_history_v1';

  function ui() { return BQ5.ui || null; }
  function engine() { return BQ5.engine || null; }
  function storage() { return BQ5.storage || null; }
  function config() { return BQ5.config || {}; }
  function isFiniteNumber(value) { return typeof value === 'number' && isFinite(value); }
  function safeNumber(value, fallback) { return isFiniteNumber(value) ? value : (fallback || 0); }
  function label(map, key, fallback) {
    return map && key != null && map[key] != null ? String(map[key]) : (fallback == null ? String(key || '') : String(fallback));
  }
  function clear(node) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
  }
  function appendText(parent, tag, className, value) {
    if (!global.document || !parent) return null;
    var node = global.document.createElement(tag || 'p');
    if (className) node.className = className;
    node.textContent = value == null ? '' : String(value);
    parent.appendChild(node);
    return node;
  }
  function clonePlain(value) {
    if (value == null) return value;
    try { return JSON.parse(JSON.stringify(value)); }
    catch (error) { return value; }
  }

  function getEngineState() {
    var e = engine();
    return e && typeof e.state === 'function' ? e.state() : null;
  }

  function getReview(result) {
    if (result && Array.isArray(result.review)) return result.review.slice();
    var e = engine();
    if (e && typeof e.review === 'function') {
      var review = e.review();
      if (Array.isArray(review)) return review;
    }
    return [];
  }

  function questionOf(entry) {
    if (!entry || typeof entry !== 'object') return {};
    return entry.q || entry.question || entry.item || {};
  }

  function isCorrect(entry) {
    if (!entry || typeof entry !== 'object') return false;
    if (typeof entry.ok === 'boolean') return entry.ok;
    if (typeof entry.correct === 'boolean') return entry.correct;
    var q = questionOf(entry);
    var choice = entry.choice != null ? entry.choice : entry.answerIndex;
    return choice !== -1 && choice != null && q.a != null && Number(choice) === Number(q.a);
  }

  function countCorrect(review) {
    return review.reduce(function (sum, entry) { return sum + (isCorrect(entry) ? 1 : 0); }, 0);
  }

  function normalizeResult(source, review, snapshot) {
    var result = source && typeof source === 'object' ? source : {};
    var state = snapshot || {};
    var total = isFiniteNumber(result.total) && result.total >= 0 ? result.total : review.length;
    if (!total && review.length) total = review.length;
    var right = isFiniteNumber(result.right) ? result.right : countCorrect(review);
    right = Math.max(0, Math.min(total, right));
    var wrong = isFiniteNumber(result.wrong) ? result.wrong : Math.max(0, total - right);
    var pct = isFiniteNumber(result.pct) ? result.pct : (total ? Math.round((right / total) * 100) : 0);
    return {
      mode: result.mode || state.mode || 'unknown',
      score: safeNumber(result.score, safeNumber(state.score, 0)),
      right: right,
      wrong: wrong,
      total: total,
      pct: Math.max(0, Math.min(100, pct)),
      theme: result.theme || state.theme || null,
      diff: result.diff || state.diff || null,
      region: result.region || state.region || (result.stage && result.stage.region) || null,
      record: result.record || null,
      stage: result.stage || null,
      review: review,
      outcome: result.outcome,
      won: result.won,
      isWinner: result.isWinner,
      winnerId: result.winnerId,
      playerId: result.playerId || result.localPlayerId,
      players: Array.isArray(result.players) ? result.players.slice() : null,
      ranking: Array.isArray(result.ranking) ? result.ranking.slice() : null,
      durationMs: isFiniteNumber(result.durationMs) ? result.durationMs : null,
      raw: result
    };
  }

  function isMultiplayerMode(mode) {
    var value = String(mode || '').toLowerCase();
    return value === '1v1' || value === '1x1' || value === 'duel' || value === 'multiplayer' ||
      value === 'local' || value === 'lan' || value === 'group' || value === 'grupo';
  }

  function resolveOutcome(result) {
    if (!result || !isMultiplayerMode(result.mode)) return null;
    var outcome = result.outcome;
    if (typeof outcome === 'string') {
      var normalized = outcome.toLowerCase().trim();
      if (normalized === 'win' || normalized === 'won' || normalized === 'victory' || normalized === 'vitoria' || normalized === 'vitória') return 'win';
      if (normalized === 'loss' || normalized === 'lost' || normalized === 'defeat' || normalized === 'derrota' || normalized === 'perdeu') return 'loss';
      if (normalized === 'draw' || normalized === 'tie' || normalized === 'empate') return 'draw';
    }
    if (typeof result.won === 'boolean') return result.won ? 'win' : 'loss';
    if (typeof result.isWinner === 'boolean') return result.isWinner ? 'win' : 'loss';
    if (result.winnerId != null && result.playerId != null) return String(result.winnerId) === String(result.playerId) ? 'win' : 'loss';
    return null;
  }

  function renderTitle(result) {
    var api = ui();
    var title = api && api.el('#results-title');
    var outcome = resolveOutcome(result);
    var text = outcome === 'win' ? 'Vitória' : (outcome === 'loss' ? 'Você perdeu' : (outcome === 'draw' ? 'Empate' : 'Resultado da partida'));
    if (title) {
      title.textContent = text;
      title.setAttribute('data-outcome', outcome || 'neutral');
    }
    var screen = api && api.el('#screen-results');
    if (screen) {
      screen.setAttribute('data-mode', String(result.mode || 'unknown'));
      screen.setAttribute('data-outcome', outcome || 'neutral');
    }
    return outcome;
  }

  function renderContext(result) {
    var parts = [];
    var cfg = config();
    if (result.mode === 'solo') parts.push('Modo solo');
    else if (result.mode === 'campaign') parts.push('Campanha');
    else if (result.mode === '1v1' || result.mode === '1x1' || result.mode === 'duel') {
      parts.push('Confronto 1x1');
      if (result.raw && result.raw.variantLabel) parts.push(String(result.raw.variantLabel));
    }
    else if (isMultiplayerMode(result.mode)) parts.push('Multiplayer');
    else parts.push(String(result.mode || 'Partida'));
    if (result.theme) parts.push(result.theme === 'all' ? 'Todos os eixos' : label(cfg.themeLabels, result.theme, result.theme));
    if (result.diff) parts.push(label(cfg.tierLabels, result.diff, result.diff));
    if (result.region) parts.push(label(cfg.regionLabels, result.region, result.region));
    var duration = result.durationMs;
    if (duration == null && gameStartedAt != null) duration = Math.max(0, Date.now() - gameStartedAt);
    if (isFiniteNumber(duration) && duration >= 0) {
      var seconds = Math.floor(duration / 1000);
      var minutes = Math.floor(seconds / 60);
      var remainder = seconds % 60;
      parts.push('Duração aproximada: ' + (minutes ? minutes + ' min ' : '') + remainder + ' s');
    }
    ui().text('#results-context', parts.join(' · '));
  }

  function renderScore(result) {
    var api = ui();
    api.text('#results-score', result.score);
    api.text('#results-right', result.right);
    api.text('#results-errors', result.wrong);
    api.text('#results-total', result.total);
    api.text('#results-pct', result.pct + '%');
    var isRecord = !!(result.record && isFiniteNumber(result.record.best) && isFiniteNumber(result.record.prev) && result.record.best > result.record.prev);
    api.hidden('#results-record', !isRecord);
    if (result.stage) {
      api.hidden('#results-stage', false);
      api.text('#results-stage-title', result.stage.allDone ? 'Campanha concluída!' : 'Etapa concluída');
      api.text('#results-stage-text', 'Melhor pontuação nesta região: ' + safeNumber(result.stage.best, result.score) + ' pontos.');
    } else {
      api.hidden('#results-stage', true);
      api.text('#results-stage-text', '');
    }
  }

  function axisPerformance(review) {
    var groups = Object.create(null);
    review.forEach(function (entry) {
      var q = questionOf(entry);
      var axis = q.t || q.theme || q.topic || 'outros';
      if (!groups[axis]) groups[axis] = { total: 0, right: 0 };
      groups[axis].total++;
      if (isCorrect(entry)) groups[axis].right++;
    });
    return groups;
  }

  function renderPerformance(result) {
    var api = ui();
    var wrap = api.el('#results-performance-wrap');
    var root = api.el('#results-performance');
    if (!wrap || !root) return;
    clear(root);
    var groups = axisPerformance(result.review);
    var keys = Object.keys(groups);
    if (!keys.length) {
      api.hidden('#results-performance-wrap', true);
      return;
    }
    keys.sort(function (a, b) {
      return label(config().themeLabels, a, a).localeCompare(label(config().themeLabels, b, b), 'pt-BR');
    });
    keys.forEach(function (key) {
      var item = global.document.createElement('div');
      item.className = 'bq5-performance__item';
      var value = groups[key];
      var pct = value.total ? Math.round((value.right / value.total) * 100) : 0;
      appendText(item, 'span', 'bq5-performance__name', label(config().themeLabels, key, key));
      appendText(item, 'strong', 'bq5-performance__value bq5-num', value.right + '/' + value.total + ' · ' + pct + '%');
      root.appendChild(item);
    });
    api.hidden('#results-performance-wrap', false);
  }

  function renderRanking(result) {
    var api = ui();
    var wrap = api.el('#results-ranking-wrap');
    var root = api.el('#results-ranking');
    if (!wrap || !root) return;
    clear(root);
    var entries = result.ranking || result.players || [];
    if (!entries.length) {
      api.hidden('#results-ranking-wrap', true);
      return;
    }
    entries = entries.slice().sort(function (a, b) {
      var rankA = safeNumber(a && (a.rank || a.position), 0);
      var rankB = safeNumber(b && (b.rank || b.position), 0);
      if (rankA && rankB) return rankA - rankB;
      return safeNumber(b && b.score, 0) - safeNumber(a && a.score, 0);
    });
    entries.forEach(function (entry, index) {
      var fragment = api.cloneTemplate('tpl-ranking-item');
      var item = fragment && fragment.querySelector('.bq5-ranking__item');
      if (!item) return;
      var position = safeNumber(entry.rank || entry.position, index + 1);
      item.setAttribute('data-pos', String(position));
      var pos = item.querySelector('.bq5-ranking__pos');
      var name = item.querySelector('.bq5-ranking__name');
      var score = item.querySelector('.bq5-ranking__score');
      if (pos) pos.textContent = String(position) + 'º';
      if (name) name.textContent = String(entry.name || entry.playerName || entry.label || ('Jogador ' + (index + 1)));
      if (score) score.textContent = entry.scoreText != null ? String(entry.scoreText) : safeNumber(entry.score, 0) + ' pontos';
      root.appendChild(fragment);
    });
    api.hidden('#results-ranking-wrap', root.children.length === 0);
  }

  function renderReview(review) {
    var api = ui();
    var root = api.el('#results-review');
    if (!root) return;
    clear(root);
    if (!review.length) {
      appendText(root, 'p', 'bq5-hint', 'A revisão detalhada não foi disponibilizada para esta partida.');
      return;
    }
    review.forEach(function (entry, index) {
      var fragment = api.cloneTemplate('tpl-review-item');
      var item = fragment && fragment.querySelector('.bq5-review');
      if (!item) return;
      var q = questionOf(entry);
      var choice = entry && entry.choice != null ? Number(entry.choice) : (entry && entry.answerIndex != null ? Number(entry.answerIndex) : -1);
      var options = Array.isArray(q.o) ? q.o : (Array.isArray(q.options) ? q.options : []);
      var correctIndex = isFiniteNumber(q.a) ? q.a : (isFiniteNumber(entry && entry.correctIndex) ? entry.correctIndex : -1);
      var chosenText = choice === -1 ? 'Tempo esgotado' : (options[choice] != null ? String(options[choice]) : 'Resposta não registrada');
      var correctText = options[correctIndex] != null ? String(options[correctIndex]) : String(entry && entry.correctAnswer || 'Não informada');
      var questionText = q.txt || q.question || entry && entry.questionText || 'Questão sem enunciado disponível';
      var explanation = q.e || q.explanation || entry && entry.explanation || 'Esta questão não possui explicação cadastrada.';
      item.setAttribute('data-ok', isCorrect(entry) ? 'true' : 'false');
      var heading = item.querySelector('.bq5-review__q');
      var chosen = item.querySelector('[data-role="chosen"]');
      var correct = item.querySelector('[data-role="correct"]');
      var expl = item.querySelector('.bq5-review__expl');
      if (heading) heading.textContent = (index + 1) + '. ' + String(questionText);
      if (chosen) chosen.textContent = chosenText;
      if (correct) correct.textContent = correctText;
      if (expl) expl.textContent = 'Explicação: ' + String(explanation);
      root.appendChild(fragment);
    });
  }

  function historyKey() {
    var keys = config().storageKeys || {};
    return keys.matchHistory || keys.history || HISTORY_KEY;
  }

  function historyEntry(result) {
    var now = new Date();
    var review = result.review || [];
    var groupStats = axisPerformance(review);
    var performance = Object.keys(groupStats).map(function (key) {
      return { axis: key, total: groupStats[key].total, right: groupStats[key].right };
    });
    recordSequence++;
    return {
      id: 'match-' + now.getTime() + '-' + recordSequence,
      playedAt: now.toISOString(),
      mode: String(result.mode || 'unknown'),
      score: result.score,
      right: result.right,
      wrong: result.wrong,
      total: result.total,
      pct: result.pct,
      theme: result.theme,
      diff: result.diff,
      region: result.region,
      outcome: resolveOutcome(result),
      variant: result.raw && result.raw.variant ? String(result.raw.variant) : null,
      players: (result.players || result.ranking || []).map(function (player) {
        return {
          id: player && player.id != null ? String(player.id) : null,
          name: String(player && (player.name || player.playerName || player.label) || 'Jogador'),
          score: safeNumber(player && player.score, 0),
          right: safeNumber(player && player.right, 0),
          rank: safeNumber(player && (player.rank || player.position), 0)
        };
      }),
      performance: performance
    };
  }

  function recordHistory(result) {
    var s = storage();
    if (!s || typeof s.getJSON !== 'function' || typeof s.setJSON !== 'function') return false;
    var key = historyKey();
    var history = s.getJSON(key, []);
    if (!Array.isArray(history)) history = [];
    history.unshift(historyEntry(result));
    if (history.length > HISTORY_LIMIT) history = history.slice(0, HISTORY_LIMIT);
    s.setJSON(key, history);
    return true;
  }

  // Registra no histórico um resultado que NÃO passa pela tela de resultados
  // (ex.: modo alternativo do multiplayer, que tem tela própria). Mesmo formato do histórico.
  function record(source) {
    if (!source || typeof source !== 'object') return false;
    var review = Array.isArray(source.review) ? source.review.slice() : [];
    return recordHistory(normalizeResult(source, review, null));
  }

  function getHistory(limit) {
    var s = storage();
    if (!s || typeof s.getJSON !== 'function') return [];
    var history = s.getJSON(historyKey(), []);
    if (!Array.isArray(history)) return [];
    var copy = clonePlain(history) || [];
    // Alpha #5: entradas gravadas antes da troca Vegetação → Natureza.
    copy.forEach(function (entry) {
      if (!entry || typeof entry !== 'object') return;
      if (entry.theme === 'vegetacao') entry.theme = 'natureza';
      if (Array.isArray(entry.performance)) entry.performance.forEach(function (p) { if (p && p.axis === 'vegetacao') p.axis = 'natureza'; });
    });
    var max = isFiniteNumber(limit) && limit >= 0 ? Math.floor(limit) : copy.length;
    return copy.slice(0, max);
  }

  function replay() {
    var api = ui();
    var detail = { result: clonePlain(currentResult), review: clonePlain(currentReview) };
    if (api.emit('results:replay', detail) > 0) return { ok: true, delegated: true };
    if (currentResult && currentResult.mode === 'solo' && BQ5.screens && BQ5.screens.setup && typeof BQ5.screens.setup.start === 'function') {
      return BQ5.screens.setup.start();
    }
    api.toast('A repetição desta modalidade será conectada ao módulo de partida correspondente.', 'info');
    return { ok: false, code: 'REPLAY_NOT_CONNECTED' };
  }

  function toMenu() {
    var api = ui();
    if (api && typeof api.showScreen === 'function') return api.showScreen('menu', { history: false, clearHistory: true });
    return { ok: false, code: 'NO_UI' };
  }

  function toCampaign() {
    var api = ui();
    var count = api.emit('results:campaign', { result: clonePlain(currentResult) });
    if (!count) api.toast('A navegação da campanha será conectada ao Módulo 12.', 'info');
    return { ok: count > 0, delegated: count > 0 };
  }

  function show(source) {
    var ready = init();
    if (!ready.ok) return ready;
    var e = engine();
    var official = e && typeof e.result === 'function' ? e.result() : null;
    var snapshot = getEngineState();
    var raw = source && typeof source === 'object' ? source : official;
    if (!raw || typeof raw !== 'object') return { ok: false, code: 'NO_RESULT' };
    var review = getReview(raw);
    var result = normalizeResult(raw, review, snapshot);
    currentResult = result;
    currentReview = review;

    renderTitle(result);
    renderContext(result);
    renderScore(result);
    renderPerformance(result);
    renderRanking(result);
    renderReview(review);

    if (result.stage) ui().hidden('#results-campaign', false);
    else ui().hidden('#results-campaign', true);

    if (!lastRecordedGame) {
      result.durationMs = result.durationMs == null && gameStartedAt != null ? Math.max(0, Date.now() - gameStartedAt) : result.durationMs;
      currentResult.durationMs = result.durationMs;
      result.historySaved = recordHistory(result);
      lastRecordedGame = true;
    }

    return ui().showScreen('results', { history: false, clearHistory: true });
  }

  function bindActions() {
    var api = ui();
    unsubscribers.push(api.onAction('replay', replay));
    unsubscribers.push(api.onAction('to-menu', toMenu));
    unsubscribers.push(api.onAction('to-campaign', toCampaign));
    unsubscribers.push(api.on('game:started', function () {
      lastRecordedGame = false;
      gameStartedAt = Date.now();
      currentResult = null;
      currentReview = [];
    }));
  }

  function init() {
    if (initialized) return { ok: true, alreadyInitialized: true };
    var api = ui();
    if (!api || typeof api.onAction !== 'function' || typeof api.on !== 'function' || typeof api.showScreen !== 'function') {
      return { ok: false, code: 'NO_UI' };
    }
    bindActions();
    initialized = true;
    return { ok: true };
  }

  var Results = {
    init: init,
    show: show,
    replay: replay,
    record: record,
    toMenu: toMenu,
    getHistory: getHistory,
    current: function () { return clonePlain(currentResult); },
    review: function () { return clonePlain(currentReview); },
    state: function () {
      return {
        initialized: initialized,
        recorded: lastRecordedGame,
        historyCount: getHistory().length,
        mode: currentResult ? currentResult.mode : null,
        outcome: currentResult ? resolveOutcome(currentResult) : null
      };
    },
    destroy: function () {
      unsubscribers.forEach(function (off) { if (typeof off === 'function') off(); });
      unsubscribers = [];
      initialized = false;
      return { ok: true };
    }
  };

  BQ5.screens = BQ5.screens || {};
  BQ5.screens.results = Results;
  if (global.document) init();
})(globalThis);
