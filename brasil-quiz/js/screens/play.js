/* ============================================================
 * Brasil em 5 Eixos — Módulo 10: tela/loop de partida solo
 * Responsabilidade: apresentar a partida e traduzir interações do jogador
 * em chamadas à API pública do engine. Não contém regras de pontuação,
 * sorteio, gabarito, persistência ou seleção de questões.
 *
 * O motor é a autoridade: question(), answer(), next(), state() e
 * remainingMs(). A UI confirma explicitamente uma alternativa selecionada.
 *
 * SEM PAUSA (regra explícita do produto): não criar pausa, botão pause,
 * estado paused, evento pause/resume, congelamento por visibilitychange,
 * retomada ou atalho de pausa. Sair abandona a partida; o cronômetro não pausa.
 * ============================================================ */
(function (global) {
  'use strict';

  var BQ5 = global.BQ5 = global.BQ5 || {};
  var initialized = false;
  var timerId = null;
  var durationMs = 15000;
  var selectedChoice = null;
  var stage = 'idle'; // idle | choosing | revealed
  var currentQuestion = null;
  var lastAnswer = null;
  var unsubscribers = [];
  var OPTION_LABELS = ['A', 'B', 'C', 'D'];

  function ui() { return BQ5.ui || null; }
  function engine() { return BQ5.engine || null; }
  function config() { return BQ5.config || {}; }
  function isInt(value) { return typeof value === 'number' && isFinite(value) && Math.floor(value) === value; }
  function safeNumber(value, fallback) { return typeof value === 'number' && isFinite(value) ? value : fallback; }
  function label(map, key, fallback) { return map && map[key] != null ? String(map[key]) : (fallback == null ? String(key) : String(fallback)); }

  function stopTimer() {
    if (timerId !== null && typeof global.clearInterval === 'function') global.clearInterval(timerId);
    timerId = null;
  }

  function effectiveDuration(stateSnapshot) {
    if (stateSnapshot && isInt(stateSnapshot.timeLimitMs) && stateSnapshot.timeLimitMs > 0) return stateSnapshot.timeLimitMs;
    var value = config().questionTimeMs;
    if (isInt(value) && value > 0) return value;
    if (value && typeof value === 'object') {
      var diff = stateSnapshot && stateSnapshot.diff;
      var found = value[diff];
      if (isInt(found) && found > 0) return found;
      var tiers = (config().tiers || {})[diff];
      if (Array.isArray(tiers)) {
        for (var i = 0; i < tiers.length; i++) {
          found = value[tiers[i]];
          if (isInt(found) && found > 0) return found;
        }
      }
    }
    return 15000;
  }

  function setProgress(stateSnapshot, answered) {
    var api = ui();
    var root = api.el('#play-progress');
    if (!root) return;
    var total = stateSnapshot.total || 0;
    var completed = stateSnapshot.index + (answered ? 1 : 0);
    root.setAttribute('aria-valuemin', '0');
    root.setAttribute('aria-valuemax', String(total));
    root.setAttribute('aria-valuenow', String(completed));
    root.setAttribute('aria-valuetext', answered
      ? completed + ' de ' + total + ' perguntas respondidas'
      : 'Pergunta ' + (stateSnapshot.index + 1) + ' de ' + total);
    while (root.firstChild) root.removeChild(root.firstChild);
    var review = BQ5.engine && BQ5.engine.review ? BQ5.engine.review() : [];
    for (var i = 0; i < total; i++) {
      var pip = global.document.createElement('span');
      pip.className = 'bq5-progress-pip';
      pip.setAttribute('aria-hidden', 'true');
      var status = 'pending';
      if (i < stateSnapshot.index) {
        status = review && review[i] && review[i].ok ? 'correct' : 'wrong';
      } else if (i === stateSnapshot.index) {
        status = answered ? (lastAnswer && lastAnswer.correct ? 'correct' : 'wrong') : 'current';
      }
      pip.setAttribute('data-state', status);
      root.appendChild(pip);
    }
  }

  function formatTheme(theme) {
    if (!theme || theme === 'all') return 'Todos os eixos';
    return label(config().themeLabels, theme, theme);
  }

  function reverseTierForDifficulty(questionDifficulty, selectedTier) {
    var tiers = config().tiers || {};
    var selectedValues = tiers[selectedTier];
    if (Array.isArray(selectedValues) && selectedValues.indexOf(questionDifficulty) !== -1) {
      return label(config().tierLabels, selectedTier, selectedTier);
    }
    var keys = Object.keys(tiers);
    for (var i = 0; i < keys.length; i++) {
      if (Array.isArray(tiers[keys[i]]) && tiers[keys[i]].indexOf(questionDifficulty) !== -1) {
        return label(config().tierLabels, keys[i], keys[i]);
      }
    }
    return 'Nível ' + questionDifficulty;
  }

  function renderTags(question, snapshot) {
    var api = ui();
    var themeNode = api.el('#play-tag-theme');
    var regionNode = api.el('#play-tag-region');
    var diffNode = api.el('#play-tag-diff');
    if (themeNode) {
      themeNode.textContent = formatTheme(question.t);
      themeNode.setAttribute('data-theme', question.t || '');
      themeNode.setAttribute('data-subtopic', question.subtopic === 'clima' ? 'clima' : '');
    }
    if (regionNode) {
      regionNode.textContent = label(config().regionLabels, question.reg, question.reg || 'Brasil');
      regionNode.setAttribute('data-region', question.reg || '');
    }
    if (diffNode) diffNode.textContent = reverseTierForDifficulty(question.d, snapshot.diff);
  }

  function renderOptions() {
    var api = ui();
    var root = api.el('#play-options');
    if (!root) return;
    var options = api.all('.bq5-option', root);
    options.forEach(function (button, index) {
      var text = button.querySelector('.bq5-option__text');
      if (text) text.textContent = currentQuestion && currentQuestion.o[index] != null ? String(currentQuestion.o[index]) : '';
      else button.textContent = currentQuestion && currentQuestion.o[index] != null ? String(currentQuestion.o[index]) : '';
      button.disabled = false;
      button.removeAttribute('data-state');
      button.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-label', OPTION_LABELS[index] + ': ' + (currentQuestion ? currentQuestion.o[index] : ''));
    });
  }

  function renderHud(snapshot, answered) {
    var api = ui();
    api.text('#play-index', snapshot.index + 1);
    api.text('#play-total', snapshot.total);
    api.text('#play-score', snapshot.score);
    setProgress(snapshot, answered);
  }

  function announce(message) {
    ui().text('#play-live', message);
  }

  function updateTimerDisplay(remaining) {
    var api = ui();
    var bar = api.el('#play-timer');
    var text = api.el('#play-time-left');
    var ratio = durationMs > 0 ? Math.max(0, Math.min(1, remaining / durationMs)) : 0;
    var seconds = Math.max(0, Math.ceil(remaining / 1000));
    if (bar) {
      bar.setAttribute('data-level', ratio < 0.2 ? 'danger' : (ratio < 0.5 ? 'warn' : 'ok'));
      if (bar.style && typeof bar.style.setProperty === 'function') bar.style.setProperty('--p', String(ratio));
      bar.setAttribute('aria-label', 'Tempo restante: ' + seconds + ' segundos');
    }
    if (text) text.textContent = seconds + ' s';
  }

  function startTimer(snapshot) {
    stopTimer();
    durationMs = effectiveDuration(snapshot);
    var tick = function () {
      if (stage !== 'choosing') { stopTimer(); return; }
      var remaining = engine().remainingMs();
      if (remaining == null) { stopTimer(); return; }
      updateTimerDisplay(remaining);
      if (remaining <= 0) {
        stopTimer();
        submitAnswer(-1, true);
      }
    };
    tick();
    if (stage === 'choosing' && typeof global.setInterval === 'function') timerId = global.setInterval(tick, 100);
  }

  function setMood(mood, message) {
    var api = ui();
    var cast = api.el('#play-cast');
    var bubble = api.el('#play-bubble');
    if (cast) cast.setAttribute('data-mood', mood || 'idle');
    if (bubble) {
      bubble.textContent = message || '';
      bubble.hidden = !message;
    }
  }

  function revealOptions(choice, timedOut) {
    var api = ui();
    var buttons = api.all('.bq5-option', api.el('#play-options'));
    buttons.forEach(function (button, index) {
      button.disabled = true;
      button.setAttribute('aria-pressed', index === choice ? 'true' : 'false');
      if (index === currentQuestion.a) button.setAttribute('data-state', 'correct');
      else if (!timedOut && index === choice) button.setAttribute('data-state', 'wrong');
      else button.setAttribute('data-state', 'dimmed');
    });
  }

  function showFeedback(result) {
    var api = ui();
    var box = api.el('#play-feedback');
    var title = api.el('#play-feedback-title');
    var points = api.el('#play-feedback-points');
    var text = api.el('#play-feedback-text');
    var correctText = currentQuestion.o[currentQuestion.a];
    var kind = result.timedOut ? 'timeout' : (result.correct ? 'correct' : 'wrong');
    if (box) {
      box.hidden = false;
      box.setAttribute('data-kind', kind);
    }
    if (title) title.textContent = result.timedOut ? 'Tempo esgotado!' : (result.correct ? 'Muito bem!' : 'Não foi dessa vez.');
    if (points) points.textContent = result.points > 0 ? '+' + result.points + ' pontos' : '0 pontos';
    var explanation = currentQuestion.e || 'Continue explorando os cinco eixos da Geografia do Brasil.';
    if (!result.correct) explanation = 'Resposta correta: ' + correctText + '. ' + explanation;
    if (text) text.textContent = explanation;

    setMood(result.correct ? 'happy' : 'sad', result.correct ? 'Mandou bem! 🧭' : (result.timedOut ? 'O tempo acabou. Vamos à próxima!' : 'Aprender também é corrigir a rota.'));
    api.emit('sfx:play', { cue: result.correct ? 'correct' : (result.timedOut ? 'timeout' : 'wrong') });
    if (points && points.classList && !api.isReducedMotion()) {
      points.classList.remove('bq5-anim-pop');
      void points.offsetWidth;
      points.classList.add('bq5-anim-pop');
    }
    announce(result.timedOut
      ? 'Tempo esgotado. A resposta correta era ' + correctText + '. Zero pontos.'
      : (result.correct ? 'Resposta correta. Você ganhou ' + result.points + ' pontos.' : 'Resposta incorreta. A resposta correta era ' + correctText + '.'));
  }

  function updateNextButton(revealed, last) {
    var button = ui().el('#play-next');
    if (!button) return;
    button.disabled = !revealed && selectedChoice === null;
    button.textContent = revealed ? (last ? 'Ver resultado' : 'Próxima pergunta') : 'Confirmar';
    button.setAttribute('data-state', revealed ? 'revealed' : 'choosing');
  }

  function submitAnswer(choice, timedOut) {
    if (stage !== 'choosing') return { ok: false, code: 'ALREADY_ANSWERED' };
    if (!timedOut && (!isInt(choice) || choice < 0 || choice > 3)) return { ok: false, code: 'BAD_CHOICE' };
    stopTimer();
    var result = engine().answer(choice);
    if (!result || !result.ok) {
      ui().toast(result && result.errors ? result.errors.join(' ') : 'Não foi possível registrar a resposta.', 'error');
      return result || { ok: false, code: 'ANSWER_FAILED' };
    }
    selectedChoice = timedOut ? null : choice;
    lastAnswer = result;
    stage = 'revealed';
    revealOptions(timedOut ? -1 : choice, !!result.timedOut);
    showFeedback(result);
    var snapshot = engine().state();
    renderHud(snapshot, true);
    updateNextButton(true, !!result.last);
    return result;
  }

  function selectAnswer(choice) {
    if (stage !== 'choosing' || !isInt(choice) || choice < 0 || choice > 3) return false;
    selectedChoice = choice;
    var buttons = ui().all('.bq5-option', ui().el('#play-options'));
    buttons.forEach(function (button, index) {
      button.disabled = false;
      if (index === choice) {
        button.setAttribute('data-state', 'selected');
        button.setAttribute('aria-pressed', 'true');
      } else {
        button.removeAttribute('data-state');
        button.setAttribute('aria-pressed', 'false');
      }
    });
    updateNextButton(false, false);
    return true;
  }

  function clickOption(event) {
    if (!event || !event.target) return;
    var target = event.target.nodeType === 3 ? event.target.parentElement : event.target;
    var button = target && target.closest ? target.closest('.bq5-option[data-index]') : null;
    if (!button || button.disabled) return;
    var index = Number(button.getAttribute('data-index'));
    if (selectAnswer(index) && typeof button.focus === 'function') button.focus();
  }

  function renderQuestion() {
    var e = engine();
    var snapshot = e && e.state ? e.state() : null;
    var question = e && e.question ? e.question() : null;
    if (!snapshot || !question) return { ok: false, code: 'NO_QUESTION' };
    currentQuestion = question;
    selectedChoice = null;
    lastAnswer = null;
    stage = 'choosing';

    ui().hidden('#play-feedback', true);
    ui().text('#play-feedback-title', '');
    ui().text('#play-feedback-points', '');
    ui().text('#play-feedback-text', '');
    ui().text('#play-question', question.txt || '');
    renderTags(question, snapshot);
    renderOptions();
    renderHud(snapshot, false);
    setMood('idle', '');
    updateNextButton(false, false);

    var main = ui().el('#screen-play');
    if (main && !ui().isReducedMotion() && main.classList) {
      main.classList.remove('bq5-is-entering');
      main.classList.add('bq5-is-entering');
    }
    startTimer(snapshot);
    announce('Pergunta ' + (snapshot.index + 1) + ' de ' + snapshot.total + '. Selecione uma alternativa e confirme.');
    return { ok: true, question: question, state: snapshot };
  }

  function showTemporaryResult(result) {
    var message = 'Partida concluída!\nPontuação: ' + result.score + ' pontos.\nAcertos: ' + result.right + ' de ' + result.total + '.\n\nA tela completa de resultados e revisão será integrada no Módulo 11.';
    if (result.record && result.record.best > result.record.prev) message += '\nNovo recorde pessoal!';
    ui().openModal({
      title: 'Fim da partida',
      message: message,
      cancelLabel: 'Fechar',
      confirmLabel: 'Voltar ao menu principal',
      showCancel: false,
      onConfirm: function () {
        ui().showScreen('menu', { history: false, clearHistory: true });
      }
    });
  }

  function advance() {
    var e = engine();
    if (stage === 'choosing') {
      if (selectedChoice === null) return { ok: false, code: 'NO_SELECTION' };
      return submitAnswer(selectedChoice, false);
    }
    if (stage !== 'revealed') return { ok: false, code: 'BAD_STAGE' };
    var result = e.next();
    if (!result || !result.ok) {
      ui().toast(result && result.errors ? result.errors.join(' ') : 'Não foi possível avançar.', 'error');
      return result || { ok: false, code: 'NEXT_FAILED' };
    }
    if (result.finished) {
      stopTimer();
      stage = 'idle';
      ui().emit('game:finished', result.result);
      if (BQ5.screens && BQ5.screens.results && typeof BQ5.screens.results.show === 'function') {
        BQ5.screens.results.show(result.result);
      } else {
        showTemporaryResult(result.result);
      }
      return result;
    }
    renderQuestion();
    return result;
  }

  function quit() {
    ui().openModal({
      title: 'Sair da partida?',
      message: 'Seu progresso nesta partida não será salvo. Não existe pausa: sair encerra a sessão atual. O cronômetro continua correndo enquanto esta confirmação estiver aberta.',
      cancelLabel: 'Não sair',
      confirmLabel: 'Sair da partida',
      onConfirm: function () {
        stopTimer();
        if (engine() && typeof engine().abort === 'function') engine().abort();
        stage = 'idle';
        currentQuestion = null;
        ui().showScreen('menu', { history: false, clearHistory: true });
      }
    });
  }

  function bindActions() {
    var api = ui();
    unsubscribers.push(api.onAction('next', advance));
    unsubscribers.push(api.onAction('quit-game', quit));
    unsubscribers.push(api.on('screen:change', function (detail) {
      if (!detail || detail.from !== 'play' || detail.to === 'play') return;
      stopTimer();
      var snapshot = engine() && engine().state ? engine().state() : null;
      // Se outro módulo trocar a tela durante uma partida ainda ativa, descartar
      // a sessão; se já finalizou, preservar result()/review() para o Módulo 11.
      if (snapshot && !snapshot.finished && engine().abort) engine().abort();
      stage = 'idle';
    }));
  }

  function init() {
    if (initialized) return { ok: true, alreadyInitialized: true };
    if (!ui() || typeof ui().onAction !== 'function') return { ok: false, code: 'NO_UI' };
    var options = ui().el('#play-options');
    if (options && options.addEventListener) options.addEventListener('click', clickOption);
    bindActions();
    initialized = true;
    return { ok: true };
  }

  function show() {
    var ready = init();
    if (!ready.ok) return ready;
    var snapshot = engine() && engine().state ? engine().state() : null;
    if (!snapshot || snapshot.finished) return { ok: false, code: 'NO_ACTIVE_GAME' };
    var opened = ui().showScreen('play', { history: false, clearHistory: true });
    if (!opened || opened.ok === false) return opened || { ok: false, code: 'SCREEN_FAILED' };
    // O botão global Voltar não deve oferecer uma saída que deixe o relógio ativo.
    ui().hidden('#bq5-back', true);
    return renderQuestion();
  }

  function getState() {
    var snapshot = engine() && engine().state ? engine().state() : null;
    return {
      stage: stage,
      selectedChoice: selectedChoice,
      durationMs: durationMs,
      timerActive: timerId !== null,
      engine: snapshot
    };
  }

  var Play = {
    init: init,
    show: show,
    start: show,
    render: renderQuestion,
    select: selectAnswer,
    confirm: function () { return stage === 'choosing' ? submitAnswer(selectedChoice, false) : { ok: false, code: 'BAD_STAGE' }; },
    next: advance,
    quit: quit,
    tick: function () { if (stage === 'choosing') updateTimerDisplay(engine().remainingMs()); },
    stopTimer: stopTimer,
    state: getState
  };

  BQ5.screens = BQ5.screens || {};
  BQ5.screens.play = Play;
  if (global.document) init();
})(globalThis);
