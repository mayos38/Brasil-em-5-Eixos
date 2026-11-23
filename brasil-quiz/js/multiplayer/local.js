/* ============================================================
 * Brasil em 5 Eixos — Módulo 13: Multiplayer 1x1 (js/multiplayer/local.js)
 * Responsabilidade: telas e regras do duelo 1x1 entre dois aparelhos.
 * Substitui o botão "Sala com amigos" do menu (intent:multiplayer).
 *
 * Fluxo de telas:
 *   mp-mode  -> escolha do modo (Clássico | Alternativo — este "em breve")
 *   mp-setup -> criação da partida (criar sala / entrar em uma sala, por códigos)
 *   mp-theme -> ANFITRIÃO escolhe o tema; mp-wait -> CONVIDADO aguarda
 *   mp-play  -> rodadas simultâneas; resultado final em results.js (Módulo 11)
 *
 * MODO CLÁSSICO (regras):
 *   - mesmas perguntas, ao mesmo tempo, com o mesmo tempo (45 s) para os dois;
 *   - dificuldade sorteada a cada pergunta; tema sorteado quando "Aleatório";
 *   - confirmou a resposta => travada; a rodada termina assim que os DOIS
 *     responderam (ninguém espera o tempo cheio) ou quando o tempo esgota;
 *   - o placar de acertos (canto superior direito) só muda quando as duas
 *     respostas foram recebidas;
 *   - vitória: 10 acertos antes do oponente ou mais acertos após 15 rodadas;
 *     empate (inclusive 10 acertos na mesma rodada) é registrado como empate.
 *
 * Arquitetura: o ANFITRIÃO é a autoridade (sorteia, cronometra o prazo final,
 * corrige e decide o vencedor). O convidado só envia a escolha. O gabarito
 * só viaja depois que as duas respostas foram recebidas. O transporte vem de
 * BQ5.lan (WebRTC) ou de qualquer objeto com a mesma interface (testes).
 *
 * O módulo NÃO altera engine/config/bank/storage. O sorteio 1x1 vive aqui
 * porque engine.start() só conhece 'solo' e 'campaign'.
 *
 * REGRA DE PRODUTO: não existe pausa. Nenhum timer congela por modal, aba
 * em segundo plano ou perda de foco.
 * ============================================================ */
(function (global) {
  'use strict';

  var BQ5 = global.BQ5 = global.BQ5 || {};

  var PROTOCOL = 1;
  var MP_SCREENS = ['mp-mode', 'mp-setup', 'mp-theme', 'mp-wait', 'mp-play',
    'mp-alt-pick', 'mp-alt-play', 'mp-alt-end', 'mp-alt-msg'];
  var HIDE_BACK = ['mp-theme', 'mp-wait', 'mp-play', 'mp-alt-pick', 'mp-alt-play', 'mp-alt-end', 'mp-alt-msg'];
  var NICK_KEY = 'bq5_mp_nickname';
  var DEFAULT_NAME = 'Explorador';
  var OPTION_LABELS = ['A', 'B', 'C', 'D'];

  // Regras do modo clássico. Podem ser ajustadas em BQ5.config.multiplayer.classic
  // sem editar este arquivo. difficultyWeights: peso do sorteio por dificuldade.
  var DEFAULTS = {
    totalRounds: 15,
    targetRight: 10,
    limitMs: 45000,
    revealMs: 4500,
    graceMs: 2000,
    difficultyWeights: { 1: 1, 2: 1, 3: 1, 4: 1 }
  };

  var initialized = false;
  var unsubscribers = [];
  var S = null;
  var variants = {};     // outras modalidades registradas (ex.: 'alternative', em multiplayer/alt.js)
  var qrScanner = { active: false, session: null, target: null, trigger: null, photoTarget: null };

  function ui() { return BQ5.ui || null; }
  function config() { return BQ5.config || {}; }
  function bank() { return BQ5.bank || null; }
  function storage() { return BQ5.storage || null; }
  function now() { return Date.now(); }
  function isInt(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }
  function label(map, key, fallback) { return map && map[key] != null ? String(map[key]) : (fallback == null ? String(key) : String(fallback)); }

  function params() {
    var custom = (config().multiplayer && config().multiplayer.classic) || {};
    var out = {};
    Object.keys(DEFAULTS).forEach(function (key) {
      out[key] = custom[key] != null ? custom[key] : DEFAULTS[key];
    });
    return out;
  }

  // ---------- estado ----------

  function freshState() {
    return {
      variant: 'classic',
      phase: 'idle',       // idle | setup | connecting | lobby | question | reveal | ended
      role: null,          // 'host' | 'guest'
      uiRole: null,        // escolha na tela de criação: 'host' | 'join'
      link: null,
      linkSeq: 0,
      transport: null,
      closed: false,
      meName: DEFAULT_NAME,
      oppName: 'Oponente',
      theme: 'all',
      total: 0,
      target: 0,
      limitMs: 45000,
      revealMs: 4500,
      quiz: null,          // somente anfitrião (com gabarito)
      i: -1,
      cur: null,           // pergunta pública atual {txt,o,t,reg,d}
      abs: { host: { right: 0, points: 0 }, guest: { right: 0, points: 0 } },
      answers: {},         // somente anfitrião: { host:{choice,rem}, guest:{...} }
      review: [],
      over: null,
      selected: null,
      myAnswered: false,
      oppAnswered: false,
      qEnd: 0,
      revealEnd: 0,
      startedAt: 0,
      pendingNote: '',
      timers: { tick: null, deadline: null, reveal: null, connect: null },
      offReplay: null,
      revealTicker: null,
      result: null
    };
  }

  S = freshState();

  function meKey() { return S.role === 'host' ? 'host' : 'guest'; }
  function oppKey() { return S.role === 'host' ? 'guest' : 'host'; }
  function myRight() { return S.abs[meKey()].right; }
  function oppRight() { return S.abs[oppKey()].right; }
  function myPoints() { return S.abs[meKey()].points; }
  function oppPoints() { return S.abs[oppKey()].points; }

  function clearTimer(name) {
    var id = S.timers[name];
    if (id !== null && id !== undefined) {
      if (name === 'tick') global.clearInterval(id);
      else global.clearTimeout(id);
    }
    S.timers[name] = null;
  }

  function clearAllTimers() { Object.keys(S.timers).forEach(clearTimer); }

  function sanitizeName(value, fallback) {
    var text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, 16);
    return text || fallback || DEFAULT_NAME;
  }

  function displayOpp() {
    var mine = String(S.meName).toLowerCase();
    return String(S.oppName).toLowerCase() === mine ? S.oppName + ' (2)' : S.oppName;
  }

  function send(obj) {
    if (!S.transport) return false;
    obj.v = PROTOCOL;
    return S.transport.send(obj);
  }

  // ---------- pequenos utilitários de DOM (sempre via BQ5.ui) ----------

  function setStatus(text, kind) {
    var node = ui().el('#mp-status');
    if (!node) return;
    node.textContent = text || '';
    node.setAttribute('data-kind', kind || 'info');
  }

  function setValue(selector, value) {
    var node = ui().el(selector);
    if (node) node.value = value == null ? '' : String(value);
  }

  function getValue(selector) {
    var node = ui().el(selector);
    return node && node.value != null ? String(node.value) : '';
  }

  function setDisabled(selector, disabled) {
    var node = ui().el(selector);
    if (node) node.disabled = !!disabled;
  }

  function announce(text) { ui().text('#mp-live', text); }

  function clearNode(node) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function bindRadioKeys(container) {
    if (!container || container.__bq5MpKeys || !container.addEventListener) return;
    container.addEventListener('keydown', function (event) {
      var key = event.key;
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].indexOf(key) === -1) return;
      var items = Array.prototype.slice.call(container.querySelectorAll('[role="radio"]')).filter(function (n) { return !n.disabled; });
      if (!items.length) return;
      var current = event.target && event.target.closest ? event.target.closest('[role="radio"]') : null;
      var index = Math.max(0, items.indexOf(current));
      if (key === 'Home') index = 0;
      else if (key === 'End') index = items.length - 1;
      else if (key === 'ArrowRight' || key === 'ArrowDown') index = (index + 1) % items.length;
      else index = (index - 1 + items.length) % items.length;
      event.preventDefault();
      if (items[index].click) items[index].click();
      if (items[index].focus) items[index].focus();
    });
    container.__bq5MpKeys = true;
  }

  // ---------- tela 1: escolha do modo ----------

  function classicDescription() {
    var p = params();
    return 'Os dois respondem às mesmas perguntas ao mesmo tempo, com ' + Math.round(p.limitMs / 1000) +
      ' s cada. Temas e dificuldades são sorteados. Vence quem fizer ' + p.targetRight +
      ' acertos primeiro ou tiver mais acertos após ' + p.totalRounds + ' rodadas.';
  }

  function renderModeScreen() {
    ui().text('#mp-classic-text', classicDescription());
    var alt = variants.alternative;
    var button = ui().el('#mp-mode-alt');
    if (alt && button) {
      button.disabled = false;
      button.removeAttribute('aria-disabled');
      var badge = button.querySelector('.bq5-mpmode__badge');
      if (badge) badge.hidden = true;
      if (typeof alt.describe === 'function') ui().text('#mp-alt-text', alt.describe());
    }
  }

  // ---------- tela 2: criação da partida ----------

  function setupLead() {
    return 'Nesta tela os dois aparelhos se conectam, e é preciso estar na mesma rede Wi-Fi. ' +
      'O anfitrião envia o texto ou mostra o QR Code da sala. O convidado pode ler o QR no próprio jogo, quando disponível, ou colar o texto; depois devolve a resposta por texto ou QR Code.';
  }

  function renderRole() {
    var api = ui();
    var group = api.el('#mp-role');
    if (group) {
      api.all('[role="radio"]', group).forEach(function (button) {
        var selected = button.getAttribute('data-value') === S.uiRole;
        button.setAttribute('aria-checked', selected ? 'true' : 'false');
        button.setAttribute('tabindex', selected || !S.uiRole ? '0' : '-1');
      });
    }
    api.hidden('#mp-panel-host', S.uiRole !== 'host');
    api.hidden('#mp-panel-join', S.uiRole !== 'join');
    var hint = S.uiRole === 'host'
      ? 'Você é o anfitrião: depois da conexão, escolhe o tema da partida.'
      : (S.uiRole === 'join' ? 'Você é o convidado: depois da conexão, aguarda o anfitrião criar a partida.' : 'Escolha uma das opções para continuar.');
    api.text('#mp-role-hint', hint);
  }

  function openSetup(note, fresh) {
    closeLink();
    S.phase = 'setup';
    S.role = null;
    S.uiRole = null;
    S.closed = false;
    S.pendingNote = note || '';
    var saved = storage() && typeof storage().getJSON === 'function' ? storage().getJSON(NICK_KEY, '') : '';
    setValue('#mp-nick', saved || '');
    setValue('#mp-host-code', '');
    setValue('#mp-host-answer', '');
    setValue('#mp-join-offer', '');
    setValue('#mp-join-code', '');
    setDisabled('#mp-host-copy', true);
    setDisabled('#mp-host-qr-toggle', true);
    setDisabled('#mp-host-connect', true);
    setDisabled('#mp-join-copy', true);
    setDisabled('#mp-join-qr-toggle', true);
    setDisabled('#mp-join-go', false);
    resetQrPanels();
    updateScannerAvailability();
    ui().text('#mp-setup-lead', setupLead());
    renderRole();
    setStatus(S.pendingNote, S.pendingNote ? 'error' : 'info');
    S.pendingNote = '';
    return fresh ? ui().showScreen('mp-setup', { history: false, clearHistory: true }) : ui().showScreen('mp-setup');
  }

  function readNick() {
    var name = sanitizeName(getValue('#mp-nick'), DEFAULT_NAME);
    S.meName = name;
    if (storage() && typeof storage().setJSON === 'function') storage().setJSON(NICK_KEY, name === DEFAULT_NAME ? '' : name);
    return name;
  }

  function closeLink() {
    clearTimer('connect');
    var link = S.link;
    S.link = null;
    S.transport = null;
    S.linkSeq++;
    if (link && typeof link.close === 'function') {
      try { link.close(); } catch (error) { /* ignora */ }
    }
  }

  function selectRole(role) {
    if (role !== 'host' && role !== 'join') return false;
    if (S.phase !== 'setup' && S.phase !== 'connecting') return false;
    var changed = S.uiRole !== role;
    S.uiRole = role;
    S.phase = 'setup';
    renderRole();
    if (!changed && S.link) return true;
    closeLink();
    setValue('#mp-host-code', '');
    setValue('#mp-host-answer', '');
    setValue('#mp-join-offer', '');
    setValue('#mp-join-code', '');
    setDisabled('#mp-host-copy', true);
    setDisabled('#mp-host-qr-toggle', true);
    setDisabled('#mp-host-connect', true);
    setDisabled('#mp-join-copy', true);
    setDisabled('#mp-join-qr-toggle', true);
    setDisabled('#mp-join-go', false);
    resetQrPanels();
    if (role === 'host') startHostLink();
    else setStatus('Cole o código da sala que o anfitrião enviou e toque em Entrar.', 'info');
    return true;
  }

  function lanApi() { return BQ5.lan || null; }
  function qrReader() { return BQ5.qrReader || null; }

  function startHostLink() {
    var lan = lanApi();
    if (!lan || typeof lan.host !== 'function' || !lan.supported()) {
      setStatus('Este navegador não oferece WebRTC. Abra o jogo em um servidor local (http://localhost) em um navegador atualizado.', 'error');
      return;
    }
    var id = ++S.linkSeq;
    var note = S.pendingNote;
    S.pendingNote = '';
    setStatus('Gerando o código da sala…', 'info');
    var link = lan.host();
    S.link = link;
    attach('host', link.transport);
    link.ready.then(function (code) {
      if (id !== S.linkSeq) return;
      setValue('#mp-host-code', code);
      setDisabled('#mp-host-copy', false);
      setDisabled('#mp-host-qr-toggle', false);
      setDisabled('#mp-host-connect', false);
      setStatus((note ? note + ' ' : '') + 'Código da sala pronto. Copie o texto ou mostre o QR Code ao outro jogador.', note ? 'error' : 'ok');
    }, function (error) {
      if (id !== S.linkSeq) return;
      setStatus(error && error.message ? error.message : 'Não foi possível gerar o código da sala.', 'error');
    });
  }

  function hostConnect() {
    if (S.role !== 'host' || !S.link || typeof S.link.accept !== 'function') return { ok: false, code: 'NO_LINK' };
    var code = getValue('#mp-host-answer');
    if (!code.trim()) {
      setStatus('Cole o código de resposta do outro jogador antes de conectar.', 'error');
      return { ok: false, code: 'EMPTY' };
    }
    readNick();
    var id = S.linkSeq;
    setDisabled('#mp-host-connect', true);
    setStatus('Conectando…', 'info');
    S.phase = 'connecting';
    S.link.accept(code).then(function () {
      if (id !== S.linkSeq) return;
      clearTimer('connect');
      S.timers.connect = global.setTimeout(function () {
        if (id !== S.linkSeq || S.phase !== 'connecting') return;
        S.phase = 'setup';
        setDisabled('#mp-host-connect', false);
        setStatus('Não foi possível conectar. Confira se os dois aparelhos estão na mesma rede Wi-Fi e tente novamente.', 'error');
      }, 20000);
    }, function (error) {
      if (id !== S.linkSeq) return;
      S.phase = 'setup';
      setDisabled('#mp-host-connect', false);
      setStatus(error && error.message ? error.message : 'Código de resposta inválido.', 'error');
    });
    return { ok: true };
  }

  function guestJoin() {
    var lan = lanApi();
    if (!lan || typeof lan.join !== 'function' || !lan.supported()) {
      setStatus('Este navegador não oferece WebRTC. Abra o jogo em um servidor local (http://localhost) em um navegador atualizado.', 'error');
      return { ok: false, code: 'NO_WEBRTC' };
    }
    var code = getValue('#mp-join-offer');
    if (!code.trim()) {
      setStatus('Cole o código da sala antes de tocar em Entrar.', 'error');
      return { ok: false, code: 'EMPTY' };
    }
    readNick();
    closeLink();
    var id = ++S.linkSeq;
    setValue('#mp-join-code', '');
    setDisabled('#mp-join-copy', true);
    setDisabled('#mp-join-qr-toggle', true);
    resetQrPanel('join');
    setDisabled('#mp-join-go', true);
    setStatus('Gerando o seu código de resposta…', 'info');
    var link = lan.join(code);
    S.link = link;
    attach('guest', link.transport);
    link.ready.then(function (answer) {
      if (id !== S.linkSeq) return;
      S.phase = 'connecting';
      setValue('#mp-join-code', answer);
      setDisabled('#mp-join-copy', false);
      setDisabled('#mp-join-qr-toggle', false);
      setStatus('Pronto. Copie o texto ou mostre o QR Code ao anfitrião e aguarde: a conexão abre sozinha.', 'ok');
    }, function (error) {
      if (id !== S.linkSeq) return;
      setDisabled('#mp-join-go', false);
      setStatus(error && error.message ? error.message : 'Código da sala inválido.', 'error');
    });
    return { ok: true };
  }

  // ---------- QR Code suplementar (gerado localmente, sem câmera/API remota) ----------

  function qrNodes(which) {
    var prefix = which === 'join' ? 'mp-join' : 'mp-host';
    return {
      code: '#' + prefix + '-code',
      button: '#' + prefix + '-qr-toggle',
      panel: '#' + prefix + '-qr-panel',
      image: '#' + prefix + '-qr'
    };
  }

  function resetQrPanel(which) {
    var nodes = qrNodes(which);
    var panel = ui().el(nodes.panel);
    var button = ui().el(nodes.button);
    var image = ui().el(nodes.image);
    if (panel) panel.hidden = true;
    if (button) button.textContent = 'Exibir QR Code';
    clearNode(image);
  }

  function resetQrPanels() {
    resetQrPanel('host');
    resetQrPanel('join');
  }

  function renderQrSvg(target, value, labelText) {
    var qr = BQ5.qr;
    if (!qr || typeof qr.encode !== 'function') throw new Error('O gerador de QR Code não foi carregado. Use “Copiar código”.');
    var encoded = qr.encode(value);
    var matrix = encoded.matrix;
    var size = matrix.length;
    var margin = 4;
    var total = size + margin * 2;
    var doc = global.document;
    var ns = 'http://www.w3.org/2000/svg';
    var svg = doc.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + total + ' ' + total);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', labelText);
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    var background = doc.createElementNS(ns, 'rect');
    background.setAttribute('x', '0'); background.setAttribute('y', '0');
    background.setAttribute('width', String(total)); background.setAttribute('height', String(total));
    background.setAttribute('fill', '#ffffff');
    svg.appendChild(background);
    var path = doc.createElementNS(ns, 'path');
    var d = '';
    for (var row = 0; row < size; row++) {
      for (var col = 0; col < size; col++) {
        if (matrix[row][col]) d += 'M' + (col + margin) + ' ' + (row + margin) + 'h1v1h-1z';
      }
    }
    path.setAttribute('d', d);
    path.setAttribute('fill', '#000000');
    svg.style.colorScheme = 'light';
    path.setAttribute('shape-rendering', 'crispEdges');
    svg.appendChild(path);
    clearNode(target);
    target.appendChild(svg);
    target.setAttribute('data-qr-version', String(encoded.version));
  }

  // Caminho principal: PNG com escala inteira (nítido, leve, imune a SVG
  // escurecido pelo modo escuro). Reserva: SVG, se o canvas não existir.
  function renderQr(target, value, labelText) {
    var qr = BQ5.qr;
    if (!qr || typeof qr.encode !== 'function') throw new Error('O gerador de QR Code não foi carregado. Use “Copiar código”.');
    if (typeof qr.draw === 'function') {
      var encoded = qr.encode(value);
      var img = qr.draw(target, encoded.matrix, { alt: labelText });
      if (img) {
        target.setAttribute('data-qr-version', String(encoded.version));
        target.setAttribute('data-qr-level', String(encoded.correction));
        return;
      }
    }
    renderQrSvg(target, value, labelText);
  }

  function toggleQr(which) {
    if (which !== 'host' && which !== 'join') return false;
    var nodes = qrNodes(which);
    var panel = ui().el(nodes.panel);
    var button = ui().el(nodes.button);
    var image = ui().el(nodes.image);
    if (!panel || !button || !image) return false;
    if (!panel.hidden) {
      panel.hidden = true;
      button.textContent = 'Exibir QR Code';
      clearNode(image); // libera a imagem enquanto o painel está oculto
      return true;
    }
    var code = getValue(nodes.code).trim();
    if (!code) {
      setStatus('Gere o código primeiro. A opção de QR é suplementar; você também pode copiar o texto.', 'error');
      return false;
    }
    try {
      panel.hidden = false; // precisa estar visível para medir a largura disponível
      renderQr(image, code, which === 'host' ? 'QR Code da sala' : 'QR Code de resposta');
      button.textContent = 'Ocultar QR Code';
      return true;
    } catch (error) {
      panel.hidden = true;
      setStatus(error && error.message ? error.message : 'Não foi possível gerar o QR Code. Use “Copiar código”.', 'error');
      return false;
    }
  }

  // Leitura no próprio navegador (js/multiplayer/qr-reader.js). Há dois caminhos:
  //  - câmera ao vivo: precisa de HTTPS/localhost;
  //  - "Ler por foto": funciona em qualquer endereço e navegador.
  // Os campos de texto e os botões de copiar continuam como fluxo principal.
  function scannerSupported() {
    var reader = qrReader();
    return !!(reader && reader.liveSupported());
  }

  function updateScannerAvailability() {
    var live = scannerSupported();
    var hasReader = !!qrReader();
    ['host', 'join'].forEach(function (which) {
      var prefix = which === 'host' ? '#mp-host' : '#mp-join';
      var button = ui().el(prefix + '-scan');
      var photo = ui().el(prefix + '-photo');
      var note = ui().el(prefix + '-scan-note');
      if (button) button.hidden = !live;
      if (photo) photo.hidden = !hasReader;
      if (note) note.hidden = live;
    });
  }

  function scannerStatus(message) {
    var node = ui().el('#mp-qr-scan-status');
    if (node) node.textContent = message || '';
  }

  function stopQrScanner(restoreFocus) {
    var session = qrScanner.session;
    qrScanner.session = null;
    if (session) session.stop();
    var video = ui().el('#mp-qr-video');
    if (video) {
      try { video.pause(); } catch (error) { /* ignora */ }
      video.srcObject = null;
    }
    var modal = ui().el('#mp-qr-scanner');
    if (modal) modal.hidden = true;
    var trigger = qrScanner.trigger;
    qrScanner.active = false;
    qrScanner.target = null;
    qrScanner.trigger = null;
    if (qrReader()) qrReader().release();
    if (restoreFocus && trigger && typeof trigger.focus === 'function') trigger.focus();
  }

  // Recebe o texto lido (câmera ou foto). Retorna Promise: true = aceito e
  // aplicado ao campo; string = mensagem de por que não serve.
  function handleScannedText(target, rawText) {
    var raw = String(rawText || '').replace(/\s+/g, '');
    if (!raw) return Promise.resolve('Nenhum QR Code encontrado.');
    return lanApi()._decodeCode(raw).then(function (decoded) {
      var expected = target === 'host' ? 'A' : 'O';
      if (decoded.kind !== expected) {
        return target === 'host'
          ? 'Este QR contém o código da sala. Leia o QR de resposta do convidado.'
          : 'Este QR contém uma resposta. Leia o código da sala do anfitrião.';
      }
      var selector = target === 'host' ? '#mp-host-answer' : '#mp-join-offer';
      setValue(selector, raw);
      stopQrScanner(false);
      var field = ui().el(selector);
      if (field && typeof field.focus === 'function') field.focus();
      setStatus('QR Code lido. Confira o campo e toque em ' + (target === 'host' ? 'Conectar.' : 'Entrar.'), 'ok');
      return true;
    }, function () {
      return 'QR reconhecido, mas não contém um código válido do Brasil em 5 Eixos.';
    });
  }

  function startQrScanner(which, trigger) {
    if (which !== 'host' && which !== 'join') return false;
    var reader = qrReader();
    if (!reader || !reader.liveSupported()) {
      setStatus('A câmera ao vivo não está disponível neste navegador/endereço. Use “Ler por foto” ou cole o texto no campo.', 'info');
      updateScannerAvailability();
      return false;
    }
    stopQrScanner(false);
    var modal = ui().el('#mp-qr-scanner');
    var video = ui().el('#mp-qr-video');
    if (!modal || !video) return false;
    qrScanner.active = true;
    qrScanner.target = which;
    qrScanner.trigger = trigger || null;
    modal.hidden = false;
    scannerStatus('Ativando câmera…');

    var session = reader.startLive({
      video: video,
      onStatus: scannerStatus,
      onText: function (text) { return handleScannedText(which, text); },
      onError: function () {
        stopQrScanner(true);
        setStatus('Leitor de QR não encontrado no projeto. Use “Ler por foto” ou cole o código manualmente.', 'info');
      }
    });
    qrScanner.session = session;
    return session.ready.catch(function (error) {
      if (qrScanner.session !== session) return;
      stopQrScanner(true);
      var code = error && error.code;
      var message = error && error.name === 'NotAllowedError'
        ? 'Acesso à câmera negado. Permita o uso da câmera, use “Ler por foto” ou cole o código manualmente.'
        : (code === 'NO_ENGINE'
          ? 'Leitor de QR não encontrado no projeto (js/vendor/jsQR.min.js). Use “Ler por foto” ou cole o código manualmente.'
          : 'Não foi possível iniciar a câmera. Use “Ler por foto” ou cole o texto manualmente.');
      setStatus(message, 'info');
    });
  }

  // "Ler por foto": abre a câmera/galeria do sistema e decodifica a imagem.
  function startQrPhoto(which, trigger) {
    if (which !== 'host' && which !== 'join') return false;
    var input = ui().el('#mp-qr-file');
    if (!input || !qrReader()) return false;
    stopQrScanner(false);
    qrScanner.photoTarget = which;
    qrScanner.trigger = trigger || null;
    input.value = '';
    input.click();
    return true;
  }

  function onPhotoSelected(event) {
    var input = event && event.target;
    var file = input && input.files && input.files[0];
    var which = qrScanner.photoTarget;
    qrScanner.photoTarget = null;
    if (!file || !which || !qrReader()) return;
    setStatus('Lendo a imagem…', 'info');
    qrReader().decodeFile(file).then(function (text) {
      return handleScannedText(which, text);
    }).then(function (result) {
      if (result !== true) setStatus(String(result), 'error');
    }, function (error) {
      var code = error && error.code;
      setStatus(code === 'NO_ENGINE'
        ? 'Leitor de QR não encontrado no projeto (js/vendor/jsQR.min.js). Cole o código manualmente.'
        : 'Não encontrei um QR Code nessa imagem. Chegue mais perto, deixe o QR inteiro e nítido, aumente o brilho da outra tela e tente de novo.', 'error');
    }).then(function () {
      input.value = '';
      qrReader().release();
    });
  }

  function onVisibilityChange() {
    if (global.document && global.document.hidden && qrScanner.active) {
      stopQrScanner(true);
      setStatus('Leitura interrompida ao sair do jogo. Você pode tentar novamente ou colar o código.', 'info');
    }
  }

  function copyCode(which) {
    var selector = which === 'join' ? '#mp-join-code' : '#mp-host-code';
    var text = getValue(selector);
    if (!text) return false;
    var util = BQ5.util;
    var ok = util && typeof util.copyText === 'function' ? util.copyText(text) : false;
    if (ok) ui().toast('Código copiado.', 'success');
    else {
      var node = ui().el(selector);
      if (node && typeof node.select === 'function') node.select();
      ui().toast('Não foi possível copiar sozinho. Selecione o código e copie manualmente.', 'error');
    }
    return ok;
  }

  // ---------- transporte: ligação e mensagens ----------

  function attach(role, transport) {
    if (!transport) return;
    S.role = role;
    S.transport = transport;
    transport.onMessage(function (msg) { handleMessage(transport, msg); });
    transport.onClose(function (reason) { handleClose(transport, reason); });
    var opened = function () {
      if (transport !== S.transport) return;
      if (S.role === 'guest') {
        S.meName = sanitizeName(S.meName, DEFAULT_NAME);
        send({ t: 'hello', name: S.meName });
      }
    };
    transport.onOpen(opened);
    if (typeof transport.isOpen === 'function' && transport.isOpen() && role === 'guest') opened();
  }

  function handleMessage(transport, msg) {
    if (transport !== S.transport || !msg || typeof msg.t !== 'string') return;
    var host = S.role === 'host';
    switch (msg.t) {
      case 'hello': if (host) onHello(msg); break;
      case 'ans': if (host) onGuestAnswer(msg); break;
      case 'rematch-ask':
        if (host) ui().toast('O oponente quer jogar de novo. Toque em “Jogar de novo” para escolher o tema.', 'info');
        break;
      case 'welcome': if (!host) onWelcome(msg); break;
      case 'start': if (!host) onStart(msg); break;
      case 'q': if (!host) onQuestionMessage(msg); break;
      case 'opp': onOppAnswered(msg); break;
      case 'reveal': if (!host) applyReveal(msg); break;
      case 'end': if (!host) applyEnd(msg); break;
      case 'lobby': if (!host) onLobbyAgain(); break;
      case 'quit': onOpponentQuit(); break;
      case 'reject':
        setStatus(msg.reason || 'O anfitrião recusou a conexão.', 'error');
        break;
      default:
        if (msg.t.indexOf('a:') === 0 && variants[S.variant] && typeof variants[S.variant].onMessage === 'function') {
          variants[S.variant].onMessage(msg, kit);
        }
        break;
    }
  }

  function handleClose(transport, reason) {
    if (transport !== S.transport) return;
    var phase = S.phase;
    var variant = variants[S.variant];
    if ((phase === 'playing' || phase === 'ended') && variant && typeof variant.onClose === 'function' && variant.onClose(phase, reason, kit)) return;
    if (phase === 'setup' || phase === 'connecting') {
      var role = S.uiRole;
      closeLink();
      S.phase = 'setup';
      var note = 'A conexão não foi concluída. Confira se os dois aparelhos estão na mesma rede Wi-Fi e tente de novo.';
      if (role === 'host') { S.pendingNote = note; startHostLink(); }
      else { setDisabled('#mp-join-go', false); setStatus(note, 'error'); }
    } else if (phase === 'lobby') {
      teardown();
      ui().toast('O outro jogador saiu da sala.', 'error');
      openSetup('O outro jogador saiu da sala. Crie uma nova sala ou entre em outra.', true);
    } else if (phase === 'question' || phase === 'reveal' || phase === 'playing') {
      clearAllTimers();
      teardown();
      ui().openModal({
        title: 'Conexão encerrada',
        message: 'A conexão com o oponente foi perdida' + (reason === 'timeout' ? ' (sem resposta da rede)' : '') +
          '. A partida foi cancelada e não será registrada no histórico.',
        confirmLabel: 'Voltar ao menu',
        showCancel: false,
        dismissible: false,
        onConfirm: function () { ui().showScreen('menu', { history: false, clearHistory: true }); }
      });
    } else if (phase === 'ended') {
      S.closed = true;
    }
  }

  function onHello(msg) {
    if (S.phase !== 'setup' && S.phase !== 'connecting') return;
    if (msg.v !== PROTOCOL) {
      send({ t: 'reject', reason: 'Versões diferentes do jogo. Atualize a página nos dois aparelhos.' });
      return;
    }
    clearTimer('connect');
    S.oppName = sanitizeName(msg.name, 'Jogador 2');
    readNick();
    S.phase = 'lobby';
    send({ t: 'welcome', name: S.meName, variant: S.variant });
    goTheme();
  }

  function onWelcome(msg) {
    if (S.phase !== 'connecting' && S.phase !== 'setup') return;
    S.oppName = sanitizeName(msg.name, 'Anfitrião');
    if (typeof msg.variant === 'string' && (msg.variant === 'classic' || variants[msg.variant])) S.variant = msg.variant;
    S.phase = 'lobby';
    goWait();
  }

  // ---------- tela 3: anfitrião escolhe o tema / convidado aguarda ----------

  function themeCount(theme) {
    var b = bank();
    if (!b || typeof b.list !== 'function' || !b.loaded()) return 0;
    return b.list().filter(function (q) { return theme === 'all' || q.theme === theme; }).length;
  }

  function renderThemes() {
    var api = ui();
    var container = api.el('#mp-themes');
    if (!container) return;
    clearNode(container);
    var cfg = config();
    var options = [{ value: 'all', label: 'Aleatório', hint: 'Um tema sorteado a cada pergunta', count: themeCount('all') }];
    (Array.isArray(cfg.themes) ? cfg.themes : []).forEach(function (theme) {
      var count = themeCount(theme);
      options.push({ value: theme, label: label(cfg.themeLabels, theme, theme), hint: count + (count === 1 ? ' pergunta' : ' perguntas'), count: count, theme: theme });
    });
    options.forEach(function (option) {
      var fragment = api.cloneTemplate('tpl-choice');
      var button = fragment && fragment.querySelector ? fragment.querySelector('.bq5-choice') : null;
      if (!button) return;
      var title = button.querySelector('.bq5-choice__label');
      var hint = button.querySelector('.bq5-choice__hint');
      if (title) title.textContent = option.label;
      if (hint) hint.textContent = option.hint;
      var selected = option.value === S.theme;
      button.setAttribute('data-value', option.value);
      button.setAttribute('data-action', 'mp-select-theme');
      button.setAttribute('aria-checked', selected ? 'true' : 'false');
      button.setAttribute('tabindex', selected ? '0' : '-1');
      if (option.theme) button.setAttribute('data-theme', option.theme);
      if (option.count <= 0) { button.disabled = true; button.setAttribute('aria-disabled', 'true'); }
      container.appendChild(fragment);
    });
    bindRadioKeys(container);
    var p = params();
    var count = themeCount(S.theme);
    var altParams = variants[S.variant] && typeof variants[S.variant].params === 'function' ? variants[S.variant].params() : null;
    var rounds = altParams ? altParams.rounds : Math.min(p.totalRounds, count);
    api.text('#mp-theme-hint', (altParams ? 'A dificuldade das cartas é sorteada. A partida terá até ' : 'A dificuldade das perguntas é sorteada. A partida terá até ') + rounds +
      (rounds === 1 ? ' rodada.' : ' rodadas.'));
    setDisabled('#mp-start', count <= 0 || !S.transport || !S.transport.isOpen());
  }

  function goTheme() {
    ui().text('#mp-theme-lead', displayOpp() + ' está conectado. Escolha o tema das perguntas e comece a partida.');
    renderThemes();
    return ui().showScreen('mp-theme', { history: false, clearHistory: true });
  }

  function goWait() {
    ui().text('#mp-wait-text', 'O anfitrião (' + displayOpp() + ') está escolhendo o tema da partida.');
    return ui().showScreen('mp-wait', { history: false, clearHistory: true });
  }

  function selectTheme(value) {
    var themes = ['all'].concat(Array.isArray(config().themes) ? config().themes : []);
    if (S.role !== 'host' || themes.indexOf(value) === -1 || themeCount(value) <= 0) return false;
    S.theme = value;
    renderThemes();
    return true;
  }

  // ---------- sorteio das perguntas (somente anfitrião) ----------

  function pickRandom(list) { return list[Math.floor(Math.random() * list.length)]; }

  function unique(list) {
    var seen = [];
    list.forEach(function (item) { if (seen.indexOf(item) === -1) seen.push(item); });
    return seen;
  }

  function weightedPick(items, weights) {
    var total = 0;
    var table = items.map(function (item) {
      var w = weights && isFinite(Number(weights[item])) && Number(weights[item]) >= 0 ? Number(weights[item]) : 1;
      total += w;
      return { item: item, w: w };
    });
    if (total <= 0) return pickRandom(items);
    var roll = Math.random() * total;
    for (var i = 0; i < table.length; i++) {
      roll -= table[i].w;
      if (roll < 0) return table[i].item;
    }
    return table[table.length - 1].item;
  }

  function instantiate(q) {
    var order = BQ5.util && typeof BQ5.util.shuffle === 'function' ? BQ5.util.shuffle([0, 1, 2, 3]) : [0, 1, 2, 3];
    return {
      id: q.id,
      txt: q.question,
      o: order.map(function (i) { return q.options[i]; }),
      a: order.indexOf(q.answer),
      d: q.difficulty,
      e: q.explanation == null ? '' : q.explanation,
      t: q.theme,
      reg: q.region
    };
  }

  // Dificuldade sorteada a cada rodada; tema sorteado quando theme === 'all'.
  function buildQuiz(theme, total) {
    var b = bank();
    if (!b || typeof b.list !== 'function' || !b.loaded()) return [];
    var pool = b.list().filter(function (q) { return theme === 'all' || q.theme === theme; });
    var weights = params().difficultyWeights;
    var quiz = [];
    while (quiz.length < total && pool.length) {
      var diff = weightedPick(unique(pool.map(function (q) { return q.difficulty; })), weights);
      var candidates = pool.filter(function (q) { return q.difficulty === diff; });
      if (theme === 'all') {
        var chosenTheme = pickRandom(unique(candidates.map(function (q) { return q.theme; })));
        candidates = candidates.filter(function (q) { return q.theme === chosenTheme; });
      }
      var pick = pickRandom(candidates);
      pool = pool.filter(function (q) { return q !== pick; });
      quiz.push(instantiate(pick));
    }
    return quiz;
  }

  // ---------- início da partida ----------

  function resetMatch() {
    clearAllTimers();
    S.quiz = null;
    S.i = -1;
    S.cur = null;
    S.abs = { host: { right: 0, points: 0 }, guest: { right: 0, points: 0 } };
    S.answers = {};
    S.review = [];
    S.over = null;
    S.selected = null;
    S.myAnswered = false;
    S.oppAnswered = false;
    S.result = null;
  }

  function announceMatchStart() {
    if (BQ5.engine && typeof BQ5.engine.abort === 'function') BQ5.engine.abort();
    S.startedAt = now();
    ui().emit('game:started', { mode: '1x1', variant: S.variant, theme: S.theme, count: S.total });
  }

  function hostBegin() {
    if (S.role !== 'host' || S.phase !== 'lobby') return { ok: false, code: 'BAD_STATE' };
    if (!S.transport || !S.transport.isOpen()) {
      ui().toast('A conexão com o oponente foi perdida.', 'error');
      return { ok: false, code: 'NO_CONNECTION' };
    }
    if (S.variant !== 'classic') {
      var other = variants[S.variant];
      if (!other || typeof other.hostStart !== 'function') {
        ui().toast('Este modo ainda não está disponível.', 'info');
        return { ok: false, code: 'MODE_UNAVAILABLE' };
      }
      S.phase = 'playing';
      var started = other.hostStart(kit);
      if (!started || started.ok === false) {
        S.phase = 'lobby';
        ui().toast((started && started.message) || 'Não foi possível iniciar a partida.', 'error');
        return started || { ok: false, code: 'START_FAILED' };
      }
      return { ok: true };
    }
    var p = params();
    var quiz = buildQuiz(S.theme, p.totalRounds);
    if (!quiz.length) {
      ui().toast('Não há perguntas suficientes para este tema.', 'error');
      return { ok: false, code: 'NO_QUESTIONS' };
    }
    resetMatch();
    S.quiz = quiz;
    S.total = quiz.length;
    S.target = Math.min(p.targetRight, S.total);
    S.limitMs = p.limitMs;
    S.revealMs = p.revealMs;
    send({ t: 'start', variant: S.variant, theme: S.theme, total: S.total, target: S.target, limitMs: S.limitMs, name: S.meName });
    announceMatchStart();
    hostSendRound(0);
    return { ok: true };
  }

  function onStart(msg) {
    if (S.phase !== 'lobby') return;
    var total = Number(msg.total), target = Number(msg.target), limit = Number(msg.limitMs);
    if (!isInt(total) || total < 1 || !isInt(target) || target < 1 || !isInt(limit) || limit < 1000) return;
    resetMatch();
    S.theme = typeof msg.theme === 'string' ? msg.theme : 'all';
    S.total = total;
    S.target = target;
    S.limitMs = limit;
    S.revealMs = params().revealMs;
    announceMatchStart();
  }

  // ---------- rodada ----------

  function publicQuestion(q) { return { txt: q.txt, o: q.o.slice(), t: q.t, reg: q.reg, d: q.d }; }

  function hostSendRound(i) {
    var p = params();
    var q = S.quiz[i];
    S.answers = {};
    var pub = publicQuestion(q);
    send({ t: 'q', i: i, q: pub, limitMs: S.limitMs });
    showQuestion(i, pub);
    clearTimer('deadline');
    S.timers.deadline = global.setTimeout(hostDeadline, S.limitMs + p.graceMs);
  }

  function onQuestionMessage(msg) {
    if (S.phase !== 'reveal' && S.phase !== 'lobby' && S.phase !== 'question') return;
    if (!isInt(msg.i) || !msg.q || !Array.isArray(msg.q.o) || msg.q.o.length !== 4) return;
    if (isInt(msg.limitMs) && msg.limitMs >= 1000) S.limitMs = msg.limitMs;
    showQuestion(msg.i, msg.q);
  }

  function difficultyLabel(d) {
    var tiers = config().tiers || {};
    var best = null;
    Object.keys(tiers).forEach(function (key) {
      var list = tiers[key];
      if (Array.isArray(list) && list.indexOf(d) !== -1 && (!best || list.length < tiers[best].length)) best = key;
    });
    return best ? label(config().tierLabels, best, best) : 'Nível ' + d;
  }

  function showQuestion(i, pub) {
    var api = ui();
    clearTimer('reveal');
    S.i = i;
    S.cur = pub;
    S.phase = 'question';
    S.selected = null;
    S.myAnswered = false;
    S.oppAnswered = false;
    S.qEnd = now() + S.limitMs;

    var needScreen = api.currentScreen() !== 'mp-play';
    if (needScreen) api.showScreen('mp-play', { history: false, clearHistory: true });

    api.hidden('#mp-feedback', true);
    api.text('#mp-feedback-title', '');
    api.text('#mp-feedback-points', '');
    api.text('#mp-feedback-text', '');
    api.text('#mp-question', pub.txt || '');
    var themeNode = api.el('#mp-tag-theme');
    var regionNode = api.el('#mp-tag-region');
    var diffNode = api.el('#mp-tag-diff');
    if (themeNode) {
      themeNode.textContent = label(config().themeLabels, pub.t, pub.t || '');
      themeNode.setAttribute('data-theme', pub.t || '');
    }
    if (regionNode) {
      regionNode.textContent = label(config().regionLabels, pub.reg, pub.reg || 'Brasil');
      regionNode.setAttribute('data-region', pub.reg || '');
    }
    if (diffNode) diffNode.textContent = difficultyLabel(pub.d);

    var root = api.el('#mp-options');
    api.all('.bq5-option', root).forEach(function (button, index) {
      var text = button.querySelector('.bq5-option__text');
      var value = pub.o[index] != null ? String(pub.o[index]) : '';
      if (text) text.textContent = value;
      button.disabled = false;
      button.removeAttribute('data-state');
      button.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-label', OPTION_LABELS[index] + ': ' + value);
    });

    renderHud();
    renderOppStatus();
    updateButton();
    var screen = api.el('#screen-mp-play');
    if (screen && screen.classList && !api.isReducedMotion()) {
      screen.classList.remove('bq5-is-entering');
      screen.classList.add('bq5-is-entering');
    }
    startTick();
    announce('Rodada ' + (i + 1) + ' de ' + S.total + '. Selecione uma alternativa e confirme.');
  }

  function renderHud() {
    var api = ui();
    api.text('#mp-round', S.i + 1);
    api.text('#mp-total', S.total);
    api.text('#mp-target', S.target);
    api.text('#mp-score-me', myRight());
    api.text('#mp-score-opp', oppRight());
    api.text('#mp-name-me', 'Você');
    api.text('#mp-name-opp', displayOpp());
    var score = api.el('#mp-score');
    if (score) score.setAttribute('aria-label', 'Acertos: você ' + myRight() + ', ' + displayOpp() + ' ' + oppRight());

    var root = api.el('#mp-progress');
    if (!root) return;
    var done = S.review.length;
    root.setAttribute('aria-valuemin', '0');
    root.setAttribute('aria-valuemax', String(S.total));
    root.setAttribute('aria-valuenow', String(done));
    root.setAttribute('aria-valuetext', done + ' de ' + S.total + ' rodadas concluídas');
    clearNode(root);
    for (var i = 0; i < S.total; i++) {
      var pip = global.document.createElement('span');
      pip.className = 'bq5-progress-pip';
      pip.setAttribute('aria-hidden', 'true');
      var state = 'pending';
      if (i < done) state = S.review[i].ok ? 'correct' : 'wrong';
      else if (i === S.i) state = 'current';
      pip.setAttribute('data-state', state);
      root.appendChild(pip);
    }
  }

  function renderOppStatus() {
    var text = '';
    if (S.phase === 'question') text = S.oppAnswered ? displayOpp() + ' já respondeu.' : displayOpp() + ' ainda está pensando…';
    ui().text('#mp-opp-status', text);
  }

  function updateButton() {
    var button = ui().el('#mp-confirm');
    if (!button) return;
    if (S.phase === 'question') {
      if (S.myAnswered) {
        button.disabled = true;
        button.textContent = 'Aguardando o oponente…';
        button.setAttribute('data-state', 'waiting');
      } else {
        button.disabled = S.selected === null;
        button.textContent = 'Confirmar';
        button.setAttribute('data-state', 'choosing');
      }
    } else if (S.phase === 'reveal') {
      var seconds = Math.max(0, Math.ceil((S.revealEnd - now()) / 1000));
      button.disabled = true;
      button.textContent = (S.over ? 'Resultado em ' : 'Próxima rodada em ') + seconds + ' s';
      button.setAttribute('data-state', 'revealed');
    } else {
      button.disabled = true;
    }
  }

  // ---------- cronômetro (sem pausa) ----------

  function updateTimerDisplay(remaining) {
    var api = ui();
    var bar = api.el('#mp-timer');
    var text = api.el('#mp-time-left');
    var ratio = S.limitMs > 0 ? Math.max(0, Math.min(1, remaining / S.limitMs)) : 0;
    var seconds = Math.max(0, Math.ceil(remaining / 1000));
    if (bar) {
      bar.setAttribute('data-level', ratio < 0.2 ? 'danger' : (ratio < 0.5 ? 'warn' : 'ok'));
      if (bar.style && typeof bar.style.setProperty === 'function') bar.style.setProperty('--p', String(ratio));
      bar.setAttribute('aria-label', 'Tempo restante: ' + seconds + ' segundos');
    }
    if (text) text.textContent = seconds + ' s';
  }

  function startTick() {
    clearTimer('tick');
    var tick = function () {
      if (S.phase !== 'question') { clearTimer('tick'); return; }
      var remaining = Math.max(0, S.qEnd - now());
      updateTimerDisplay(remaining);
      if (remaining <= 0) {
        clearTimer('tick');
        if (!S.myAnswered) submitMine(-1);
      }
    };
    tick();
    if (S.phase === 'question') S.timers.tick = global.setInterval(tick, 100);
  }

  // ---------- respostas ----------

  function selectOption(index) {
    if (S.phase !== 'question' || S.myAnswered || !isInt(index) || index < 0 || index > 3) return false;
    S.selected = index;
    ui().all('.bq5-option', ui().el('#mp-options')).forEach(function (button, i) {
      if (i === index) { button.setAttribute('data-state', 'selected'); button.setAttribute('aria-pressed', 'true'); }
      else { button.removeAttribute('data-state'); button.setAttribute('aria-pressed', 'false'); }
    });
    updateButton();
    return true;
  }

  function lockOptions() {
    ui().all('.bq5-option', ui().el('#mp-options')).forEach(function (button) { button.disabled = true; });
  }

  // choice: 0..3 ou -1 (tempo esgotado). Depois de enviada, não pode ser mudada.
  function submitMine(choice) {
    if (S.phase !== 'question' || S.myAnswered) return { ok: false, code: 'BAD_STATE' };
    if (choice !== -1 && (!isInt(choice) || choice < 0 || choice > 3)) return { ok: false, code: 'BAD_CHOICE' };
    var rem = Math.max(0, Math.min(S.limitMs, S.qEnd - now()));
    S.myAnswered = true;
    S.selected = choice === -1 ? null : choice;
    lockOptions();
    updateButton();
    renderOppStatus();
    announce(choice === -1 ? 'Tempo esgotado. Aguardando o oponente.' : 'Resposta enviada. Aguardando o oponente.');
    if (S.role === 'host') hostRecord('host', choice, rem);
    else send({ t: 'ans', i: S.i, choice: choice, rem: rem });
    return { ok: true };
  }

  function confirmAnswer() {
    if (S.phase !== 'question' || S.myAnswered || S.selected === null) return { ok: false, code: 'NO_SELECTION' };
    return submitMine(S.selected);
  }

  function onGuestAnswer(msg) {
    if (S.phase !== 'question' || msg.i !== S.i) return;
    var choice = Number(msg.choice);
    if (choice !== -1 && (!isInt(choice) || choice < 0 || choice > 3)) return;
    var rem = Number(msg.rem);
    hostRecord('guest', choice, isFinite(rem) ? Math.max(0, Math.min(S.limitMs, rem)) : 0);
  }

  function onOppAnswered(msg) {
    if (S.phase !== 'question' || msg.i !== S.i) return;
    S.oppAnswered = true;
    renderOppStatus();
  }

  // ---------- anfitrião: corrige a rodada ----------

  function hostRecord(who, choice, rem) {
    if (S.phase !== 'question' || S.answers[who]) return;
    S.answers[who] = { choice: choice, rem: rem };
    if (who === 'guest') { S.oppAnswered = true; renderOppStatus(); }
    else send({ t: 'opp', i: S.i });
    if (S.answers.host && S.answers.guest) hostResolve();
  }

  function hostDeadline() {
    S.timers.deadline = null;
    if (S.phase !== 'question') return;
    ['host', 'guest'].forEach(function (who) {
      if (!S.answers[who]) S.answers[who] = { choice: -1, rem: 0 };
    });
    hostResolve();
  }

  function pointsFor(q, remMs) {
    var cfg = config();
    var base = (cfg.pointsBase || {})[q.d] || 0;
    var cap = isInt(cfg.timeBonusMax) ? cfg.timeBonusMax : 7;
    return base + Math.min(Math.max(0, Math.round(remMs / 1000)), cap);
  }

  function hostResolve() {
    if (S.phase !== 'question') return;
    clearTimer('deadline');
    var q = S.quiz[S.i];
    var res = {};
    ['host', 'guest'].forEach(function (who) {
      var a = S.answers[who] || { choice: -1, rem: 0 };
      var ok = a.choice === q.a;
      var pts = ok ? pointsFor(q, a.rem) : 0;
      res[who] = { choice: a.choice, ok: ok, pts: pts };
      if (ok) S.abs[who].right++;
      S.abs[who].points += pts;
    });
    var hr = S.abs.host.right, gr = S.abs.guest.right;
    var T = S.target;
    var over = null;
    if (hr >= T || gr >= T) {
      over = { reason: 'target', outcome: hr >= T && gr >= T ? 'draw' : (hr >= T ? 'host' : 'guest') };
    } else if (S.i + 1 >= S.total) {
      over = { reason: 'rounds', outcome: hr > gr ? 'host' : (gr > hr ? 'guest' : 'draw') };
    }
    var msg = { t: 'reveal', i: S.i, a: q.a, e: q.e, res: res, abs: S.abs, over: over, revealMs: S.revealMs };
    send(msg);
    applyReveal(msg);
    if (S.role === 'host') {
      clearTimer('reveal');
      var index = S.i;
      S.timers.reveal = global.setTimeout(function () {
        S.timers.reveal = null;
        if (S.phase !== 'reveal' || S.i !== index) return;
        if (over) hostFinish(over);
        else hostSendRound(index + 1);
      }, S.revealMs);
    }
  }

  function hostFinish(over) {
    var msg = { t: 'end', outcome: over.outcome, reason: over.reason, abs: S.abs, rounds: S.review.length };
    send(msg);
    applyEnd(msg);
  }

  // ---------- revelação (anfitrião e convidado) ----------

  function applyReveal(msg) {
    if (S.phase !== 'question' || msg.i !== S.i || !msg.res || !msg.abs) return;
    var api = ui();
    clearTimer('tick');
    clearTimer('deadline');
    S.phase = 'reveal';
    S.abs = msg.abs;
    S.over = msg.over || null;
    S.myAnswered = true;
    var mine = msg.res[meKey()] || { choice: -1, ok: false, pts: 0 };
    var opp = msg.res[oppKey()] || { choice: -1, ok: false, pts: 0 };
    var q = S.cur;
    var correctText = q.o[msg.a];
    S.review.push({
      q: { txt: q.txt, o: q.o.slice(), a: msg.a, e: msg.e || '', t: q.t, d: q.d, reg: q.reg },
      choice: mine.choice,
      ok: !!mine.ok,
      pts: mine.pts
    });

    api.all('.bq5-option', api.el('#mp-options')).forEach(function (button, index) {
      button.disabled = true;
      button.setAttribute('aria-pressed', index === mine.choice ? 'true' : 'false');
      if (index === msg.a) button.setAttribute('data-state', 'correct');
      else if (index === mine.choice) button.setAttribute('data-state', 'wrong');
      else button.setAttribute('data-state', 'dimmed');
    });

    var timedOut = mine.choice === -1;
    var kind = timedOut ? 'timeout' : (mine.ok ? 'correct' : 'wrong');
    var box = api.el('#mp-feedback');
    if (box) { box.hidden = false; box.setAttribute('data-kind', kind); }
    api.text('#mp-feedback-title', timedOut ? 'Tempo esgotado!' : (mine.ok ? 'Muito bem!' : 'Não foi dessa vez.'));
    api.text('#mp-feedback-points', mine.pts > 0 ? '+' + mine.pts + ' pontos' : '0 pontos');
    var oppText = opp.choice === -1 ? displayOpp() + ' não respondeu a tempo.' : (opp.ok ? displayOpp() + ' acertou.' : displayOpp() + ' errou.');
    var explanation = msg.e || 'Continue explorando os cinco eixos da Geografia do Brasil.';
    api.text('#mp-feedback-text', oppText + ' ' + (mine.ok ? '' : 'Resposta correta: ' + correctText + '. ') + explanation);
    api.emit('sfx:play', { cue: mine.ok ? 'correct' : (timedOut ? 'timeout' : 'wrong') });
    var pointsNode = api.el('#mp-feedback-points');
    if (pointsNode && pointsNode.classList && !api.isReducedMotion()) {
      pointsNode.classList.remove('bq5-anim-pop');
      void pointsNode.offsetWidth;
      pointsNode.classList.add('bq5-anim-pop');
    }
    announce((mine.ok ? 'Você acertou. ' : 'Você errou. ') + oppText + ' Placar de acertos: você ' + myRight() + ', ' + displayOpp() + ' ' + oppRight() + '.');

    renderHud();
    renderOppStatus();
    var rem = isInt(msg.revealMs) && msg.revealMs > 0 ? msg.revealMs : S.revealMs;
    S.revealEnd = now() + rem;
    updateButton();
    clearTimer('reveal');
    if (S.role !== 'host') S.timers.reveal = null;
    // contagem regressiva visual (o anfitrião mantém seu próprio timeout de avanço)
    var ticker = global.setInterval(function () {
      if (S.phase !== 'reveal') { global.clearInterval(ticker); return; }
      updateButton();
      if (now() >= S.revealEnd) global.clearInterval(ticker);
    }, 250);
    S.revealTicker = ticker;
  }

  // ---------- fim da partida ----------

  function stopRevealTicker() {
    if (S.revealTicker) global.clearInterval(S.revealTicker);
    S.revealTicker = null;
  }

  function buildResult(outcome, reason) {
    var rounds = S.review.length;
    var right = myRight();
    var rankMe = outcome === 'loss' ? 2 : 1;
    var rankOpp = outcome === 'win' ? 2 : 1;
    var detail = function (r, p) { return r + (r === 1 ? ' acerto' : ' acertos') + ' · ' + p + ' pontos'; };
    return {
      mode: '1x1',
      variant: S.variant,
      variantLabel: 'Modo clássico',
      theme: S.theme,
      diff: null,
      score: myPoints(),
      right: right,
      wrong: Math.max(0, rounds - right),
      total: rounds,
      review: S.review.map(function (entry) { return entry; }),
      outcome: outcome,
      reason: reason || null,
      playerId: 'me',
      winnerId: outcome === 'win' ? 'me' : (outcome === 'loss' ? 'opp' : null),
      players: [
        { id: 'me', name: S.meName + ' (você)', score: myPoints(), right: right, rank: rankMe, scoreText: detail(right, myPoints()) },
        { id: 'opp', name: displayOpp(), score: oppPoints(), right: oppRight(), rank: rankOpp, scoreText: detail(oppRight(), oppPoints()) }
      ]
    };
  }

  function showResult(outcome, reason) {
    clearAllTimers();
    stopRevealTicker();
    S.phase = 'ended';
    var result = buildResult(outcome, reason);
    S.result = result;
    dropReplay();
    S.offReplay = ui().on('results:replay', onReplay);
    ui().emit('game:finished', result);
    var results = BQ5.screens && BQ5.screens.results;
    if (results && typeof results.show === 'function') return results.show(result);
    ui().openModal({
      title: outcome === 'win' ? 'Vitória' : (outcome === 'loss' ? 'Você perdeu' : 'Empate'),
      message: 'Acertos: você ' + myRight() + ' × ' + oppRight() + ' ' + displayOpp() + '.',
      confirmLabel: 'Voltar ao menu',
      showCancel: false,
      onConfirm: function () { ui().showScreen('menu', { history: false, clearHistory: true }); }
    });
    return { ok: true };
  }

  function applyEnd(msg) {
    if (S.phase !== 'reveal' && S.phase !== 'question') return;
    if (msg.abs) S.abs = msg.abs;
    var outcome = msg.outcome === 'draw' ? 'draw' : (msg.outcome === meKey() ? 'win' : 'loss');
    return showResult(outcome, msg.reason);
  }

  // ---------- sair, abandono e jogar de novo ----------

  function quitMatch() {
    ui().openModal({
      title: 'Sair do duelo?',
      message: 'Sair conta como abandono: o oponente vence. Não existe pausa e o cronômetro continua correndo enquanto esta confirmação estiver aberta.',
      cancelLabel: 'Continuar jogando',
      confirmLabel: 'Sair do duelo',
      onConfirm: function () {
        if (S.phase !== 'question' && S.phase !== 'reveal') return;
        send({ t: 'quit' });
        if (S.review.length >= 1) showResult('loss', 'quit');
        else leaveToMenu();
      }
    });
  }

  function onOpponentQuit() {
    var phase = S.phase;
    if (phase === 'playing' && variants[S.variant] && typeof variants[S.variant].onQuit === 'function') {
      variants[S.variant].onQuit(kit);
      return;
    }
    if (phase === 'question' || phase === 'reveal') {
      if (S.review.length >= 1) {
        ui().toast(displayOpp() + ' saiu do duelo. Vitória por abandono.', 'info');
        showResult('win', 'quit');
      } else {
        ui().toast(displayOpp() + ' saiu do duelo antes da primeira rodada.', 'info');
        leaveToMenu();
      }
    } else if (phase === 'lobby') {
      handleClose(S.transport, 'quit');
    }
  }

  function leaveToMenu() {
    teardown();
    ui().showScreen('menu', { history: false, clearHistory: true });
  }

  function leaveRoom() {
    ui().openModal({
      title: 'Sair da sala?',
      message: 'A conexão com o outro jogador será encerrada.',
      cancelLabel: 'Ficar',
      confirmLabel: 'Sair da sala',
      onConfirm: function () { send({ t: 'quit' }); leaveToMenu(); }
    });
  }

  function dropReplay() {
    if (typeof S.offReplay === 'function') S.offReplay();
    S.offReplay = null;
  }

  // "Jogar de novo" no resultado 1x1: o anfitrião escolhe o tema de novo; o convidado pede.
  function onReplay() {
    if (!S.transport || S.closed || !S.transport.isOpen()) {
      teardown();
      ui().toast('A conexão com o outro jogador foi encerrada. Crie uma nova sala.', 'info');
      S.variant = 'classic';
      openSetup('', true);
      return { ok: false, code: 'CLOSED' };
    }
    if (S.role === 'host') {
      resetMatch();
      S.phase = 'lobby';
      send({ t: 'lobby' });
      goTheme();
      return { ok: true };
    }
    send({ t: 'rematch-ask' });
    ui().toast('Pedido enviado ao anfitrião.', 'success');
    return { ok: true };
  }

  function onLobbyAgain() {
    if (S.phase !== 'ended' && S.phase !== 'lobby') return;
    resetMatch();
    S.phase = 'lobby';
    goWait();
  }

  // ---------- limpeza ----------

  function teardown() {
    stopQrScanner(false);
    Object.keys(variants).forEach(function (key) {
      if (variants[key] && typeof variants[key].reset === 'function') variants[key].reset();
    });
    clearAllTimers();
    stopRevealTicker();
    dropReplay();
    var link = S.link;
    var transport = S.transport;
    var variant = S.variant;
    var theme = S.theme;
    var name = S.meName;
    S = freshState();
    S.variant = variant;
    S.theme = theme;
    S.meName = name;
    if (link && typeof link.close === 'function') {
      try { link.close(); } catch (error) { /* ignora */ }
    } else if (transport && typeof transport.close === 'function') {
      try { transport.close(); } catch (error2) { /* ignora */ }
    }
  }

  function onScreenChange(detail) {
    if (!detail) return;
    var to = detail.to, from = detail.from;
    if (from === 'mp-setup' && to !== 'mp-setup') stopQrScanner(false);
    if (HIDE_BACK.indexOf(to) !== -1) ui().hidden('#bq5-back', true);
    if (from === 'results') dropReplay();
    if (S.phase === 'idle' && !S.transport && !S.link) return;
    if (to === 'results') return;
    if (MP_SCREENS.indexOf(to) !== -1) {
      if (to === 'mp-mode' && from === 'mp-setup') { closeLink(); S.phase = 'idle'; S.role = null; }
      return;
    }
    teardown();
  }

  // ---------- ações de entrada ----------

  function show() {
    var ready = init();
    if (!ready.ok) return ready;
    teardown();
    S.phase = 'idle';
    renderModeScreen();
    return ui().showScreen('mp-mode');
  }

  function pickMode(value) {
    if (value === 'classic') {
      S.variant = 'classic';
      return openSetup();
    }
    if (value === 'alternative' && variants.alternative) {
      S.variant = 'alternative';
      return openSetup();
    }
    ui().toast('O modo alternativo ainda não está disponível.', 'info');
    return { ok: false, code: 'MODE_UNAVAILABLE' };
  }

  function bindActions() {
    var api = ui();
    unsubscribers.push(api.on('intent:multiplayer', function () { show(); }));
    unsubscribers.push(api.onAction('mp-pick-mode', function (d) { pickMode(d.value); }));
    unsubscribers.push(api.onAction('mp-role', function (d) { selectRole(d.value); }));
    unsubscribers.push(api.onAction('mp-copy', function (d) { copyCode(d.value); }));
    unsubscribers.push(api.onAction('mp-qr-toggle', function (d) { toggleQr(d.value); }));
    unsubscribers.push(api.onAction('mp-qr-scan', function (d) { startQrScanner(d.value, d.element); }));
    unsubscribers.push(api.onAction('mp-qr-photo', function (d) { startQrPhoto(d.value, d.element); }));
    unsubscribers.push(api.onAction('mp-qr-scan-close', function () { stopQrScanner(true); }));
    unsubscribers.push(api.onAction('mp-host-connect', hostConnect));
    unsubscribers.push(api.onAction('mp-join-go', guestJoin));
    unsubscribers.push(api.onAction('mp-select-theme', function (d) { selectTheme(d.value); }));
    unsubscribers.push(api.onAction('mp-start', hostBegin));
    unsubscribers.push(api.onAction('mp-confirm', confirmAnswer));
    unsubscribers.push(api.onAction('mp-quit', quitMatch));
    unsubscribers.push(api.onAction('mp-leave', leaveRoom));
    unsubscribers.push(api.on('screen:change', onScreenChange));
  }

  function clickOption(event) {
    if (!event || !event.target) return;
    var target = event.target.nodeType === 3 ? event.target.parentElement : event.target;
    var button = target && target.closest ? target.closest('.bq5-option[data-index]') : null;
    if (!button || button.disabled) return;
    if (selectOption(Number(button.getAttribute('data-index'))) && typeof button.focus === 'function') button.focus();
  }

  function init() {
    if (initialized) return { ok: true, alreadyInitialized: true };
    if (!ui() || typeof ui().onAction !== 'function') return { ok: false, code: 'NO_UI' };
    var options = ui().el('#mp-options');
    if (options && options.addEventListener) options.addEventListener('click', clickOption);
    var fileInput = ui().el('#mp-qr-file');
    if (fileInput && fileInput.addEventListener) fileInput.addEventListener('change', onPhotoSelected);
    bindRadioKeys(ui().el('#mp-role'));
    bindActions();
    if (global.document && global.document.addEventListener) global.document.addEventListener('visibilitychange', onVisibilityChange);
    updateScannerAvailability();
    initialized = true;
    return { ok: true };
  }

  function getState() {
    return {
      phase: S.phase,
      role: S.role,
      variant: S.variant,
      theme: S.theme,
      round: S.i + 1,
      total: S.total,
      target: S.target,
      limitMs: S.limitMs,
      right: { me: S.role ? myRight() : 0, opp: S.role ? oppRight() : 0 },
      points: { me: S.role ? myPoints() : 0, opp: S.role ? oppPoints() : 0 },
      myAnswered: S.myAnswered,
      oppAnswered: S.oppAnswered,
      rounds: S.review.length,
      connected: !!(S.transport && S.transport.isOpen && S.transport.isOpen()),
      meName: S.meName,
      oppName: S.oppName
    };
  }

  // Interface oferecida às variantes (multiplayer/alt.js): a conexão, os nomes, o anfitrião
  // e a saída continuam sendo deste módulo; a variante cuida só das regras e das telas dela.
  var kit = {
    isHost: function () { return S.role === 'host'; },
    meKey: meKey,
    oppKey: oppKey,
    send: send,
    connected: function () { return !!(S.transport && typeof S.transport.isOpen === 'function' && S.transport.isOpen()); },
    meName: function () { return S.meName; },
    oppName: displayOpp,
    theme: function () { return S.theme; },
    phase: function () { return S.phase; },
    setPhase: function (value) { S.phase = value; },
    markClosed: function () { S.closed = true; },
    leaveToMenu: leaveToMenu,
    draw: { pickRandom: pickRandom, unique: unique, weightedPick: weightedPick, instantiate: instantiate },
    newRoom: function () {
      teardown();
      openSetup('', true);
    },
    recordResult: function (result) {
      var results = BQ5.screens && BQ5.screens.results;
      return results && typeof results.record === 'function' ? results.record(result) : false;
    }
  };

  function registerVariant(id, impl) {
    if (!id || !impl || id === 'classic') return { ok: false, code: 'BAD_VARIANT' };
    variants[id] = impl;
    if (initialized) renderModeScreen();
    return { ok: true };
  }

  var Multiplayer = {
    registerVariant: registerVariant,
    kit: kit,
    init: init,
    show: show,
    state: getState,
    params: params,
    selectOption: selectOption,
    confirm: confirmAnswer,
    start: hostBegin,
    selectTheme: selectTheme,
    quit: quitMatch,
    teardown: teardown,
    // Para testes e desenvolvimento: liga um transporte já criado (ex.: BQ5.lan.loopbackPair()).
    attachTransport: function (role, transport, names) {
      init();
      teardown();
      S.phase = 'connecting';
      if (names && names.me) S.meName = sanitizeName(names.me, DEFAULT_NAME);
      attach(role, transport);
      return { ok: true };
    },
    _buildQuiz: buildQuiz
  };

  BQ5.screens = BQ5.screens || {};
  BQ5.screens.multiplayer = Multiplayer;
  if (global.document) init();
})(globalThis);
