/* ============================================================
 * Brasil em 5 Eixos — Módulo 9: configuração da partida
 * Responsabilidade: coletar preferências de uma partida solo e
 * encaminhá-las ao motor. Não seleciona questões nem implementa regras.
 *
 * Compatibilidade: lê config.tiers/tierLabels/questionTimeMs dinamicamente.
 * O contador de disponibilidade é apenas uma prévia para limitar a UI;
 * engine.start() continua sendo a validação definitiva.
 *
 * IMPORTANTE: não há pausa de partida neste projeto. Não adicionar botão,
 * estado, evento, atalho ou fluxo de pausa. O relógio começa com a pergunta
 * e continua correndo até resposta, timeout ou abandono da partida.
 * ============================================================ */
(function (global) {
  'use strict';

  var BQ5 = global.BQ5 = global.BQ5 || {};
  var initialized = false;
  var unsubscribers = [];
  var state = {
    mode: 'solo',
    theme: 'all',
    diff: 'normal',
    count: null,
    maxCount: 0
  };
  var MODE_OPTIONS = [
    { value: 'solo', label: 'Solo individual', hint: 'Disponível agora', available: true },
    { value: 'campaign', label: 'Campanha', hint: 'Disponível pelo menu próprio no Módulo 12', available: false },
    { value: 'local', label: 'Grupo no mesmo aparelho', hint: 'Planejado para o Módulo 13', available: false },
    { value: 'lan', label: 'Sala com amigos (LAN)', hint: 'Planejado para o Módulo 14', available: false }
  ];

  function ui() { return BQ5.ui || null; }
  function config() { return BQ5.config || {}; }
  function bank() { return BQ5.bank || null; }
  function engine() { return BQ5.engine || null; }
  function isInt(value) { return typeof value === 'number' && isFinite(value) && Math.floor(value) === value; }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function label(map, key, fallback) { return map && map[key] != null ? String(map[key]) : (fallback == null ? String(key) : String(fallback)); }

  function bankQuestions() {
    var b = bank();
    if (!b || typeof b.loaded !== 'function' || !b.loaded() || typeof b.list !== 'function') return [];
    var list = b.list();
    return Array.isArray(list) ? list : [];
  }

  // Replica somente a contagem de prévia da regra pública documentada no engine:
  // se o pool do tier tiver menos de cinco questões, o motor amplia para o tema.
  // A UI nunca escolhe nem embaralha questões; engine.start() é a autoridade final.
  function availableQuestions(theme, diff) {
    var cfg = config();
    var questions = bankQuestions();
    var themePool = questions.filter(function (question) {
      return !theme || theme === 'all' || question.theme === theme;
    });
    var tiers = cfg.tiers || {};
    var tierValues = Array.isArray(tiers[diff]) ? tiers[diff] : [];
    if (!tierValues.length) return themePool.length;
    var tierPool = themePool.filter(function (question) {
      return tierValues.indexOf(question.difficulty) !== -1;
    });
    return tierPool.length < 5 ? themePool.length : tierPool.length;
  }

  function questionTimeMs(diff) {
    var value = config().questionTimeMs;
    if (isInt(value) && value > 0) return value;
    if (value && typeof value === 'object') {
      var selected = value[diff];
      if (isInt(selected) && selected > 0) return selected;
      var tiers = (config().tiers || {})[diff];
      if (Array.isArray(tiers)) {
        for (var i = 0; i < tiers.length; i++) {
          selected = value[tiers[i]];
          if (isInt(selected) && selected > 0) return selected;
        }
      }
    }
    return null;
  }

  function renderChoiceGroup(containerSelector, options, selectedValue, actionName, onKeySelect) {
    var api = ui();
    var container = api && api.el(containerSelector);
    if (!container) return;
    while (container.firstChild) container.removeChild(container.firstChild);

    options.forEach(function (option) {
      var fragment = api.cloneTemplate('tpl-choice');
      var button = fragment && fragment.querySelector ? fragment.querySelector('.bq5-choice') : null;
      if (!button && global.document && typeof global.document.createElement === 'function') {
        button = global.document.createElement('button');
        button.className = 'bq5-choice';
        button.setAttribute('type', 'button');
        button.setAttribute('role', 'radio');
      }
      if (!button) return;

      var selected = String(option.value) === String(selectedValue);
      var title = button.querySelector ? button.querySelector('.bq5-choice__label') : null;
      var hint = button.querySelector ? button.querySelector('.bq5-choice__hint') : null;
      if (title) title.textContent = option.label;
      else button.textContent = option.label;
      if (hint) hint.textContent = option.hint || '';
      button.setAttribute('data-value', String(option.value));
      button.setAttribute('data-action', actionName);
      button.setAttribute('aria-checked', selected ? 'true' : 'false');
      button.setAttribute('tabindex', selected && option.available !== false ? '0' : '-1');
      if (option.theme) button.setAttribute('data-theme', option.theme);
      if (option.available === false) {
        button.disabled = true;
        button.setAttribute('aria-disabled', 'true');
      } else {
        button.disabled = false;
        button.removeAttribute('aria-disabled');
      }
      container.appendChild(fragment && fragment.querySelector ? fragment : button);
    });

    if (!container.__bq5SetupKeys && container.addEventListener) {
      container.addEventListener('keydown', function (event) {
        var key = event.key;
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].indexOf(key) === -1) return;
        var choices = Array.prototype.slice.call(container.querySelectorAll('[role="radio"]')).filter(function (node) {
          return !node.disabled;
        });
        if (!choices.length) return;
        var current = event.target && event.target.closest ? event.target.closest('[role="radio"]') : null;
        var index = choices.indexOf(current);
        var next = index < 0 ? 0 : index;
        if (key === 'Home') next = 0;
        else if (key === 'End') next = choices.length - 1;
        else if (key === 'ArrowRight' || key === 'ArrowDown') next = (next + 1) % choices.length;
        else next = (next - 1 + choices.length) % choices.length;
        event.preventDefault();
        var target = choices[next];
        if (target && target.click) target.click();
        else if (target && onKeySelect) onKeySelect(target.getAttribute('data-value'));
        if (target && target.focus) target.focus();
      });
      container.__bq5SetupKeys = true;
    }
  }

  function themeOptions() {
    var cfg = config();
    var options = [{ value: 'all', label: 'Todos os eixos', hint: 'Questões dos cinco eixos', available: availableQuestions('all', state.diff) > 0 }];
    (Array.isArray(cfg.themes) ? cfg.themes : []).forEach(function (theme) {
      var count = availableQuestions(theme, state.diff);
      options.push({
        value: theme,
        label: label(cfg.themeLabels, theme, theme),
        hint: count + (count === 1 ? ' questão disponível' : ' questões disponíveis'),
        available: count > 0,
        theme: theme
      });
    });
    return options;
  }

  function difficultyOptions() {
    var cfg = config();
    var tiers = cfg.tiers && typeof cfg.tiers === 'object' ? cfg.tiers : {};
    return Object.keys(tiers).map(function (key) {
      var count = availableQuestions(state.theme, key);
      return {
        value: key,
        label: label(cfg.tierLabels, key, key),
        hint: count + (count === 1 ? ' questão no conjunto' : ' questões no conjunto'),
        available: count > 0
      };
    });
  }

  function renderMode() {
    renderChoiceGroup('#setup-modes', MODE_OPTIONS, state.mode, 'setup-select-mode');
  }

  function renderCount() {
    var api = ui();
    var available = availableQuestions(state.theme, state.diff);
    state.maxCount = available;
    var defaultCount = isInt(config().soloQuestionCount) && config().soloQuestionCount > 0 ? config().soloQuestionCount : 10;
    if (available > 0) state.count = clamp(isInt(state.count) ? state.count : defaultCount, 1, available);
    else state.count = 0;

    api.text('#setup-count-value', state.count > 0 ? state.count : '—');
    api.text('#setup-count-hint', available > 0
      ? 'Até ' + available + ' questões disponíveis para esta combinação.'
      : 'Não há questões disponíveis para esta combinação. Escolha outro eixo ou dificuldade.');
    var dec = api.el('#setup-count-dec');
    var inc = api.el('#setup-count-inc');
    if (dec) dec.disabled = state.count <= 1;
    if (inc) inc.disabled = state.count <= 0 || state.count >= available;
    var start = api.el('#setup-start');
    if (start) start.disabled = available <= 0 || !bank() || !bank().loaded();
  }

  function renderRules() {
    var api = ui();
    var cfg = config();
    var seconds = questionTimeMs(state.diff);
    var base = cfg.pointsBase && typeof cfg.pointsBase === 'object' ? cfg.pointsBase : {};
    var bonus = isInt(cfg.timeBonusMax) ? cfg.timeBonusMax : 7;
    var timeText = seconds ? (seconds / 1000) + ' segundos por questão' : 'tempo definido pelo motor conforme a dificuldade';
    var levels = Array.isArray((cfg.tiers || {})[state.diff]) ? cfg.tiers[state.diff].join(', ') : 'configurado no motor';
    api.text('#setup-mode-hint', 'Solo individual é a única modalidade habilitada nesta versão. Campanha, grupo local e LAN permanecem visíveis como opções futuras, mas não podem ser selecionados.');
    api.text('#setup-tier-hint', 'A dificuldade ' + label(cfg.tierLabels, state.diff, state.diff) + ' usa as faixas ' + levels + '. A disponibilidade é calculada pelo banco carregado e segue a regra de seleção do motor.');
    api.text('#setup-rules',
      'Modalidade: solo individual. Cada questão apresenta quatro alternativas e exige selecionar uma resposta antes de confirmar. ' +
      'O tempo é ' + timeText + '. Acertos recebem a pontuação-base da dificuldade da questão' +
      (Object.keys(base).length ? ' (níveis ' + Object.keys(base).join(', ') + ')' : '') +
      ' mais bônus de tempo de até ' + bonus + ' pontos; erro ou tempo esgotado vale zero. ' +
      'A dificuldade escolhida (' + label(cfg.tierLabels, state.diff, state.diff) + ') usa os níveis ' + levels + '. ' +
      'Não existe pausa: o relógio continua correndo até responder, esgotar o tempo ou sair da partida.'
    );
  }

  function render() {
    var api = ui();
    if (!api) return { ok: false, code: 'NO_UI' };
    var b = bank();
    var loaded = !!(b && typeof b.loaded === 'function' && b.loaded());
    var count = loaded && typeof b.count === 'function' ? b.count() : 0;

    renderMode();
    var diffs = difficultyOptions();
    if (!diffs.some(function (item) { return item.value === state.diff && item.available; })) {
      var first = diffs.filter(function (item) { return item.available; })[0];
      if (first) state.diff = String(first.value);
    }
    renderChoiceGroup('#setup-themes', themeOptions(), state.theme, 'setup-select-theme', function (value) { select('theme', value); });
    renderChoiceGroup('#setup-tiers', difficultyOptions(), state.diff, 'setup-select-diff', function (value) { select('diff', value); });
    renderCount();
    renderRules();
    api.text('#setup-lead', loaded
      ? count.toLocaleString('pt-BR') + (count === 1 ? ' questão carregada no banco.' : ' questões carregadas no banco.')
      : 'O banco ainda não foi carregado. A partida ficará indisponível até a inicialização terminar.');
    return { ok: true, state: getState(), available: state.maxCount };
  }

  function select(kind, value) {
    if (kind === 'theme') {
      var themes = ['all'].concat(Array.isArray(config().themes) ? config().themes : []);
      if (themes.indexOf(value) === -1 || availableQuestions(value, state.diff) <= 0) return false;
      state.theme = value;
    } else if (kind === 'diff') {
      if (!Object.prototype.hasOwnProperty.call(config().tiers || {}, value) || availableQuestions(state.theme, value) <= 0) return false;
      state.diff = value;
    } else if (kind === 'mode') {
      var available = MODE_OPTIONS.some(function (item) { return item.value === value && item.available; });
      if (!available) return false;
      state.mode = value;
    } else return false;
    render();
    return true;
  }

  function changeCount(delta) {
    if (!state.maxCount) return false;
    state.count = clamp(state.count + delta, 1, state.maxCount);
    renderCount();
    return true;
  }

  function startGame() {
    var api = ui();
    var b = bank();
    var e = engine();
    if (state.mode !== 'solo') {
      api.toast('Esta modalidade ainda não está disponível.', 'info');
      return { ok: false, code: 'MODE_UNAVAILABLE' };
    }
    if (!b || typeof b.loaded !== 'function' || !b.loaded()) {
      api.toast('O banco de questões ainda não foi carregado.', 'error');
      return { ok: false, code: 'NO_BANK' };
    }
    renderCount();
    if (!state.maxCount || state.count < 1 || state.count > state.maxCount) {
      api.toast('Não há questões suficientes para esta configuração.', 'error');
      return { ok: false, code: 'NO_QUESTIONS' };
    }
    if (!e || typeof e.start !== 'function') {
      api.toast('O motor da partida ainda não está disponível.', 'error');
      return { ok: false, code: 'NO_ENGINE' };
    }
    var started = e.start({ mode: 'solo', theme: state.theme, diff: state.diff, count: state.count });
    if (!started || !started.ok) {
      var detail = started && started.errors && started.errors.length ? started.errors.join(' ') : 'Verifique tema, dificuldade e banco.';
      api.toast(detail, 'error');
      return started || { ok: false, code: 'START_FAILED' };
    }
    var activeSnapshot = typeof e.state === 'function' ? e.state() : null;
    var configuredTimes = config().questionTimeMs;
    if (configuredTimes && typeof configuredTimes === 'object' &&
        (!activeSnapshot || !isInt(activeSnapshot.timeLimitMs) || activeSnapshot.timeLimitMs <= 0)) {
      if (typeof e.abort === 'function') e.abort();
      api.toast('A configuração usa tempos por dificuldade, mas o engine carregado não expõe state().timeLimitMs. Atualize o Módulo 5.6 antes de iniciar.', 'error');
      return { ok: false, code: 'ENGINE_TIMER_VERSION_MISMATCH' };
    }
    if (!BQ5.screens || !BQ5.screens.play || typeof BQ5.screens.play.show !== 'function') {
      if (typeof e.abort === 'function') e.abort();
      api.toast('A tela de partida ainda não foi carregada.', 'error');
      return { ok: false, code: 'NO_PLAY_SCREEN' };
    }
    var shown = BQ5.screens.play.show();
    if (!shown || shown.ok === false) {
      if (typeof e.abort === 'function') e.abort();
      api.toast('Não foi possível abrir a partida.', 'error');
      return shown || { ok: false, code: 'PLAY_SCREEN_FAILED' };
    }
    api.emit('game:started', { mode: 'solo', theme: state.theme, diff: state.diff, count: state.count });
    return { ok: true, game: started.game };
  }

  function bindActions() {
    var api = ui();
    unsubscribers.push(api.on('intent:solo', function () { show('solo'); }));
    unsubscribers.push(api.onAction('setup-select-mode', function (detail) { select('mode', detail.value); }));
    unsubscribers.push(api.onAction('setup-select-theme', function (detail) { select('theme', detail.value); }));
    unsubscribers.push(api.onAction('setup-select-diff', function (detail) { select('diff', detail.value); }));
    unsubscribers.push(api.onAction('count-dec', function () { changeCount(-1); }));
    unsubscribers.push(api.onAction('count-inc', function () { changeCount(1); }));
    unsubscribers.push(api.onAction('start-game', startGame));
  }

  function init() {
    if (initialized) return { ok: true, alreadyInitialized: true };
    if (!ui() || typeof ui().onAction !== 'function') return { ok: false, code: 'NO_UI' };
    bindActions();
    initialized = true;
    return { ok: true };
  }

  function show(mode) {
    var ready = init();
    if (!ready.ok) return ready;
    if (mode && mode !== 'solo') return { ok: false, code: 'MODE_UNAVAILABLE' };
    state.mode = 'solo';
    render();
    return ui().showScreen('setup');
  }

  function getState() {
    return { mode: state.mode, theme: state.theme, diff: state.diff, count: state.count, maxCount: state.maxCount };
  }

  var Setup = { init: init, show: show, render: render, start: startGame, select: select, changeCount: changeCount, state: getState, availableQuestions: availableQuestions };
  BQ5.screens = BQ5.screens || {};
  BQ5.screens.setup = Setup;
  if (global.document) init();
})(globalThis);
