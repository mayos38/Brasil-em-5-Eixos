/* ============================================================
 * Brasil em 5 Eixos — Módulo 8: menu principal
 * Responsabilidade: identidade inicial, entradas dos modos, perfil,
 * opções e indicação do progresso salvo.
 * Regras do jogo e persistência continuam nos módulos-base.
 * ============================================================ */
(function (global) {
  'use strict';

  var BQ5 = global.BQ5 = global.BQ5 || {};
  var initialized = false;
  var unsubscribers = [];
  var DEFAULT_PLAYER = 'Explorador';

  function ui() { return BQ5.ui || null; }
  function config() { return BQ5.config || {}; }
  function storage() { return BQ5.storage || null; }

  function integer(value) {
    var number = Number(value);
    return isFinite(number) && number >= 0 ? Math.floor(number) : 0;
  }

  function readProfileData() {
    var cfg = config();
    var store = storage();
    var stages = Array.isArray(cfg.campaignStages) ? cfg.campaignStages.slice() : [];
    var progress = store && typeof store.getProgress === 'function'
      ? store.getProgress()
      : { done: {}, best: {} };
    if (!progress || typeof progress !== 'object') progress = { done: {}, best: {} };
    if (!progress.done || typeof progress.done !== 'object') progress.done = {};

    var done = stages.filter(function (stage) { return progress.done[stage] === true; }).length;
    var bestSolo = 0;
    var key = cfg.storageKeys && cfg.storageKeys.bestSolo;
    if (store && key && typeof store.getJSON === 'function') bestSolo = integer(store.getJSON(key, 0));

    var bankCount = BQ5.bank && typeof BQ5.bank.count === 'function' ? integer(BQ5.bank.count()) : 0;
    var bankLoaded = BQ5.bank && typeof BQ5.bank.loaded === 'function' ? BQ5.bank.loaded() : bankCount > 0;

    return {
      playerName: DEFAULT_PLAYER,
      bestSolo: bestSolo,
      stagesDone: done,
      stagesTotal: stages.length,
      progress: progress,
      bankCount: bankCount,
      bankLoaded: !!bankLoaded
    };
  }

  function setProgressBar(data) {
    var bar = ui().el('#menu-progress-bar');
    if (!bar) return;
    var total = data.stagesTotal;
    var ratio = total > 0 ? Math.max(0, Math.min(1, data.stagesDone / total)) : 0;
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', String(total));
    bar.setAttribute('aria-valuenow', String(data.stagesDone));
    bar.setAttribute('aria-valuetext', total > 0
      ? data.stagesDone + ' de ' + total + ' regiões concluídas'
      : 'Progresso da campanha ainda indisponível');
    if (bar.style && typeof bar.style.setProperty === 'function') bar.style.setProperty('--p', String(ratio));
  }

  function render() {
    var api = ui();
    if (!api) return { ok: false, code: 'NO_UI' };
    var data = readProfileData();

    api.text('#menu-player-name', data.playerName);
    api.text('#menu-player-rank', data.stagesDone > 0 ? 'Jornada em andamento' : 'Sua jornada começa aqui');
    api.text('#menu-best-solo', data.bestSolo.toLocaleString('pt-BR'));
    api.text('#menu-progress-count', data.stagesTotal > 0
      ? data.stagesDone + '/' + data.stagesTotal
      : '—');
    api.text('#menu-progress-text', data.stagesTotal > 0
      ? 'Campanha: ' + data.stagesDone + ' de ' + data.stagesTotal + ' regiões concluídas'
      : 'Progresso da campanha ficará disponível quando os dados forem carregados.');
    api.text('#menu-bank-info', data.bankLoaded
      ? 'Banco carregado: ' + data.bankCount.toLocaleString('pt-BR') + ' questões disponíveis.'
      : 'Aguardando o carregamento do banco de questões.');
    setProgressBar(data);

    return { ok: true, profile: data };
  }

  function showNotReady(label, moduleNumber) {
    ui().toast(label + ' será conectado no Módulo ' + moduleNumber + '.', 'info');
  }

  function requestIntent(intent, label, moduleNumber) {
    var handled = ui().emit('intent:' + intent, { source: 'menu', intent: intent });
    if (!handled) showNotReady(label, moduleNumber);
  }

  function openProfile() {
    var data = readProfileData();
    var progressText = data.stagesTotal > 0
      ? data.stagesDone + ' de ' + data.stagesTotal + ' regiões concluídas'
      : 'Progresso de campanha ainda indisponível';
    var bankText = data.bankLoaded
      ? data.bankCount.toLocaleString('pt-BR') + ' questões carregadas'
      : 'Banco de questões ainda não carregado';
    var message = [
      'Identidade: ' + data.playerName + ' (perfil local provisório).',
      'Recorde solo: ' + data.bestSolo.toLocaleString('pt-BR') + ' pontos.',
      'Campanha: ' + progressText + '.',
      'Banco: ' + bankText + '.',
      '',
      'A edição do nome e do avatar será integrada à personalização futura.'
    ].join('\n');
    ui().openModal({
      title: 'Perfil do explorador',
      message: message,
      confirmLabel: 'Fechar',
      showCancel: false
    });
  }

  function openOptions() {
    ui().openModal({
      title: 'Opções',
      message: 'Ajustes disponíveis nesta versão:',
      contentTemplate: 'tpl-menu-options',
      confirmLabel: 'Concluir',
      showCancel: false
    });
    updateMotionControl();
  }

  function updateMotionControl() {
    var button = ui().el('[data-action="toggle-motion"]');
    if (!button) return;
    var reduced = ui().isReducedMotion();
    button.setAttribute('aria-pressed', reduced ? 'true' : 'false');
    button.textContent = 'Reduzir animações nesta sessão: ' + (reduced ? 'ativado' : 'desativado');
  }

  function toggleMotion() {
    var next = !ui().isReducedMotion();
    ui().setReducedMotion(next);
    updateMotionControl();
    ui().toast(next ? 'Animações reduzidas nesta sessão.' : 'Animações padrão restauradas nesta sessão.', 'success');
  }

  function openCustomization() {
    ui().openModal({
      title: 'Personalização',
      message: 'A personalização está planejada para uma próxima etapa. Nome, avatar, companheiro e elementos visuais ainda não podem ser alterados nesta versão.',
      confirmLabel: 'Entendi',
      showCancel: false
    });
  }

  function bindActions() {
    unsubscribers.push(ui().onAction('go-solo', function () {
      requestIntent('solo', 'O modo Solo', 9);
    }));
    unsubscribers.push(ui().onAction('go-campaign', function () {
      requestIntent('campaign', 'A Campanha', 12);
    }));
    unsubscribers.push(ui().onAction('go-local', function () {
      requestIntent('local', 'O modo em grupo', 13);
    }));
    unsubscribers.push(ui().onAction('go-multiplayer', function () {
      requestIntent('multiplayer', 'O multiplayer 1x1', 13);
    }));
    unsubscribers.push(ui().onAction('open-profile', openProfile));
    unsubscribers.push(ui().onAction('open-options', openOptions));
    unsubscribers.push(ui().onAction('open-customization', openCustomization));
    unsubscribers.push(ui().onAction('toggle-motion', toggleMotion));
    unsubscribers.push(ui().on('screen:change', function (detail) {
      if (detail && detail.to === 'menu') render();
    }));
  }

  function init() {
    if (initialized) return { ok: true, alreadyInitialized: true };
    if (!BQ5.ui || typeof BQ5.ui.init !== 'function') return { ok: false, code: 'NO_UI' };
    var ready = BQ5.ui.init();
    if (!ready.ok) return ready;
    bindActions();
    initialized = true;
    render();
    return { ok: true };
  }

  function show() {
    var ready = init();
    if (!ready.ok) return ready;
    render();
    return ui().showScreen('menu', { history: false, clearHistory: true });
  }

  var Menu = {
    init: init,
    render: render,
    show: show,
    refresh: render
  };

  BQ5.screens = BQ5.screens || {};
  BQ5.screens.menu = Menu;

  // O menu registra seus eventos ao ser carregado, mas não substitui o módulo 15:
  // o bootstrap decide quando o banco foi carregado e quando exibir a tela.
  if (global.document) init();
})(globalThis);
