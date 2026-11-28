/* ============================================================
 * Brasil em 5 Eixos — M13: Multiplayer 1×1 pela rede local
 *
 * Transporte: WebRTC DataChannel direto na LAN. Não há servidor de sala,
 * serviço de sinalização, STUN, TURN, CDN de jogo ou backend externo.
 * A sinalização é manual: anfitrião copia a oferta; convidado devolve a
 * resposta; ambos usam os campos já presentes em #screen-lan. O transporte
 * desse texto entre aparelhos fica a cargo dos jogadores; não há QR,
 * descoberta local automática ou servidor de sinalização nesta versão.
 *
 * IMPORTANTE SOBRE “OFFLINE”:
 * - Esta versão pressupõe que a página já foi carregada por HTTPS (ex.: Pages).
 * - A conexão entre os dois aparelhos é direta na rede local e não usa serviço
 *   externo de sinalização. O app ainda não é empacotado/cacheado para abrir
 *   pela primeira vez sem Internet.
 * - FUTURO (não implementar neste M13): PWA/Service Worker para pré-cache de
 *   HTML/CSS/JS/perguntas e distribuição local. A conexão LAN já deve continuar
 *   separada do mecanismo de carregamento do app.
 *
 * Requisitos de segurança/consistência: o anfitrião é autoridade do jogo;
 * recebe ações, valida fase/carta/resposta, sorteia questões, coordena o
 * motor de duelo (que delega HP ao M18) e envia vistas filtradas. O convidado nunca recebe gabarito nem enunciado de
 * carta alheia antes da escolha. Mensagens têm versão, sessão e sequência.
 * ============================================================ */
(function (global) {
  'use strict';
  var BQ5 = global.BQ5 = global.BQ5 || {};
  var M13 = {};
  var PROTOCOL = 1;
  var MAX_CODE_CHARS = 120000;
  var MAX_MESSAGE_CHARS = 65536;
  var initialized = false;
  var listeners = [];
  var state = {
    role: null, pc: null, channel: null, connected: false,
    sessionId: null, localPlayerId: null, localName: 'Jogador',
    remoteName: 'Convidado', roomCode: '', answerCode: '', remoteJoined: false,
    outSeq: 0, inSeq: 0, fingerprint: '',
    theme: 'all', themeOrder: [],
    game: null, gameStarted: false, timerInterval: null, transitionTimeout: null,
    timerDeadline: null, currentRemaining: 0, lastView: null,
    resultShown: false, disconnected: false
  };

  function ui() { return BQ5.ui || null; }
  function el(selector) { return global.document ? global.document.querySelector(selector) : null; }
  function text(selector, value) { var n = el(selector); if (n) n.textContent = value == null ? '' : String(value); }
  function show(node, visible) { if (node) node.hidden = !visible; }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function safeString(value, fallback) { return String(value == null || value === '' ? fallback : value).slice(0, 24); }
  function getName() { var n = el('#m13-player-name'); return safeString(n && n.value, 'Jogador'); }
  function toast(message, kind) { var api = ui(); if (api && typeof api.toast === 'function') api.toast(message, kind || 'info'); else text('#lan-status', message); }
  function status(message) {
    text('#lan-status', message);
    text('#m13-lobby-status', message);
  }
  function navigateScreen(name) {
    var app = el('#bq5-app');
    if (app && app.getAttribute('data-screen') === name) return { ok: true, screen: name };
    var api = ui();
    if (api && typeof api.showScreen === 'function') return api.showScreen(name, { history: false });
    var next = el('#screen-' + name);
    if (!next) return { ok: false, code: 'UNKNOWN_SCREEN' };
    Array.prototype.forEach.call(global.document.querySelectorAll('.bq5-screen'), function (screen) {
      screen.hidden = screen !== next;
    });
    if (app) app.setAttribute('data-screen', name);
    return { ok: true, screen: name };
  }
  function showLan() {
    if (state.resultShown || state.role || state.pc) cleanup(true);
    navigateScreen('lan');
    setConnectionUi(false, false);
    status('Crie uma sala ou cole o código recebido. Os dois aparelhos precisam estar na mesma rede Wi-Fi.');
  }
  function bankQuestions() {
    return BQ5.bank && typeof BQ5.bank.list === 'function' ? BQ5.bank.list() : [];
  }
  function fingerprint() {
    var list = bankQuestions().slice().sort(function (a, b) { return Number(a.id) - Number(b.id); });
    var canonical = list.map(function (q) {
      return [q.id, q.theme, q.difficulty, q.question, (q.options || []).join('\u001f'), q.answer, q.explanation || ''].join('\u001e');
    }).join('\u001d');
    var hash = 2166136261;
    for (var i = 0; i < canonical.length; i++) {
      hash ^= canonical.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return list.length + '-' + (hash >>> 0).toString(16);
  }
  function randomId(prefix) {
    var bytes = new Uint8Array(12);
    if (global.crypto && typeof global.crypto.getRandomValues === 'function') global.crypto.getRandomValues(bytes);
    else for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    var out = '';
    for (var j = 0; j < bytes.length; j++) out += bytes[j].toString(16).padStart(2, '0');
    return (prefix || '') + out;
  }
  function utf8ToBase64(value) {
    return global.btoa(unescape(encodeURIComponent(value))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }
  function base64ToUtf8(value) {
    var padded = String(value).replace(/-/g, '+').replace(/_/g, '/');
    while (padded.length % 4) padded += '=';
    return decodeURIComponent(escape(global.atob(padded)));
  }
  function makeCode(kind, description, sessionId) {
    var payload = { app: 'BQ5-M13', protocol: PROTOCOL, kind: kind, sessionId: sessionId, description: description };
    return 'BQ5M13.' + utf8ToBase64(JSON.stringify(payload));
  }
  function parseCode(code, expectedKind) {
    var value = String(code || '').trim();
    if (!value || value.length > MAX_CODE_CHARS || value.indexOf('BQ5M13.') !== 0) throw new Error('Código vazio, grande demais ou incompatível.');
    var payload;
    try { payload = JSON.parse(base64ToUtf8(value.slice(7))); }
    catch (error) { throw new Error('Não foi possível ler o código. Copie novamente, sem cortar caracteres.'); }
    if (!payload || payload.app !== 'BQ5-M13' || payload.protocol !== PROTOCOL || payload.kind !== expectedKind ||
        !payload.description || !payload.description.type || !payload.description.sdp) {
      throw new Error('Código inválido ou de outra versão do M13.');
    }
    return payload;
  }
  function waitForIce(pc) {
    return new Promise(function (resolve, reject) {
      if (pc.iceGatheringState === 'complete') return resolve();
      var finished = false;
      var timeout = global.setTimeout(function () {
        if (finished) return;
        finished = true;
        pc.removeEventListener('icegatheringstatechange', check);
        reject(new Error('A coleta de candidatos locais demorou demais. Verifique a rede Wi-Fi e tente gerar o código novamente.'));
      }, 15000);
      function check() {
        if (pc.iceGatheringState !== 'complete' || finished) return;
        finished = true;
        global.clearTimeout(timeout);
        pc.removeEventListener('icegatheringstatechange', check);
        resolve();
      }
      pc.addEventListener('icegatheringstatechange', check);
    });
  }
  function makePeerConnection() {
    if (typeof global.RTCPeerConnection !== 'function') {
      throw new Error('Este navegador não oferece suporte à conexão WebRTC necessária ao M13.');
    }
    // Sem STUN/TURN: nenhum servidor externo é consultado. A conexão usa
    // candidatos diretos disponíveis na mesma LAN; redes com isolamento de
    // clientes podem impedir o tráfego entre os dois aparelhos.
    var pc = new global.RTCPeerConnection({ iceServers: [], iceCandidatePoolSize: 0 });
    pc.oniceconnectionstatechange = function () {
      if (pc.iceConnectionState === 'failed') status('A rede não permitiu a conexão direta. Confirme a mesma rede Wi-Fi e desative isolamento entre clientes.');
      if (pc.iceConnectionState === 'disconnected') status('A conexão local foi interrompida. Tentando recuperar o enlace…');
    };
    pc.onconnectionstatechange = function () {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') markDisconnected();
    };
    return pc;
  }
  function bindChannel(channel) {
    state.channel = channel;
    channel.onopen = function () {
      state.connected = true;
      if (state.role === 'guest') {
        send({ type: 'join', name: state.localName, fingerprint: state.fingerprint });
        status('Conexão estabelecida. Aguardando confirmação da sala…');
      } else {
        status('Canal local aberto. Aguardando o jogador entrar…');
      }
    };
    channel.onmessage = function (event) { receive(event.data); };
    channel.onerror = function () { status('O canal de comunicação apresentou um erro.'); };
    channel.onclose = function () { markDisconnected(); };
  }
  function send(message) {
    var channel = state.channel;
    if (!channel || channel.readyState !== 'open') return false;
    var envelope = {
      app: 'BQ5-M13', protocol: PROTOCOL,
      sessionId: state.sessionId,
      seq: ++state.outSeq,
      message: message
    };
    var serialized = JSON.stringify(envelope);
    if (serialized.length > MAX_MESSAGE_CHARS) { status('Mensagem maior que o limite de segurança do M13.'); return false; }
    try { channel.send(serialized); return true; }
    catch (error) { status('Falha ao enviar dados pela conexão local.'); return false; }
  }
  function receive(raw) {
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_CHARS) return;
    var envelope;
    try { envelope = JSON.parse(raw); } catch (ignored) { return; }
    if (!envelope || envelope.app !== 'BQ5-M13' || envelope.protocol !== PROTOCOL || !envelope.message) return;
    var message = envelope.message;
    if (state.role === 'host' && message.type === 'join') {
      if (state.remoteJoined || envelope.sessionId !== state.sessionId || !Number.isInteger(envelope.seq) || envelope.seq <= state.inSeq) return;
      state.inSeq = envelope.seq;
      if (message.fingerprint !== state.fingerprint) {
        send({ type: 'error', message: 'As versões do banco de questões são diferentes. Atualizem os dois aparelhos antes de jogar.' });
        return;
      }
      state.remoteName = safeString(message.name, 'Convidado');
      state.localPlayerId = 'p1';
      state.remoteJoined = true;
      send({ type: 'welcome', sessionId: state.sessionId, hostName: state.localName, guestName: state.remoteName, themeOrder: state.themeOrder });
      publishLobby();
      return;
    }
    if (state.role === 'guest' && message.type === 'welcome') {
      if (envelope.sessionId !== state.sessionId || !Number.isInteger(envelope.seq) || envelope.seq <= state.inSeq) return;
      state.inSeq = envelope.seq;
      state.sessionId = message.sessionId;
      state.localPlayerId = 'p2';
      state.remoteJoined = true;
      state.remoteName = safeString(message.hostName, 'Anfitrião');
      state.themeOrder = Array.isArray(message.themeOrder) ? message.themeOrder.slice() : [];
      renderLobby();
      status('Conectado à sala de ' + state.remoteName + '. O anfitrião está preparando a partida.');
      return;
    }
    if (message.type === 'error') { status(message.message || 'A sala recusou a conexão.'); return; }
    if (!state.sessionId || envelope.sessionId !== state.sessionId || !Number.isInteger(envelope.seq) || envelope.seq <= state.inSeq) return;
    state.inSeq = envelope.seq;
    if (state.role === 'host') receiveHost(message);
    else receiveGuest(message);
  }
  function receiveHost(message) {
    if (!state.game) return;
    if (message.type === 'action') processAction('p2', message.action, message.payload || {});
  }
  function receiveGuest(message) {
    if (message.type === 'lobby') {
      state.theme = message.theme || 'all';
      state.themeOrder = Array.isArray(message.themeOrder) ? message.themeOrder.slice() : state.themeOrder;
      state.remoteName = safeString(message.hostName, 'Anfitrião');
      renderLobby();
      return;
    }
    if (message.type === 'state') {
      if (!state.gameStarted) {
        state.gameStarted = true;
        var api = ui(); if (api) api.emit('game:started', { mode: '1v1', theme: message.view && message.view.theme || state.theme, count: 15 });
      }
      state.lastView = message.view;
      state.currentRemaining = Number(message.remainingMs) || 0;
      setConnectionUi(true, true);
      renderGame(message.view, message.question || null, state.currentRemaining);
      return;
    }
    if (message.type === 'timer') {
      state.currentRemaining = Math.max(0, Number(message.remainingMs) || 0);
      state.timerDeadline = Date.now() + state.currentRemaining;
      renderTimer();
      return;
    }
    if (message.type === 'finish') {
      state.lastView = message.view || state.lastView;
      finishLocal(message.result);
    }
    if (message.type === 'aborted') {
      toast('O anfitrião encerrou a partida.', 'info');
      cleanup(true);
      showLan();
    }
  }
  function markDisconnected() {
    if (state.disconnected) return;
    state.disconnected = true;
    closePeer();
    state.connected = false;
    if (state.game && !state.resultShown) {
      status('Conexão perdida. A partida foi interrompida e não será registrada como vitória ou derrota.');
      toast('Conexão perdida. Esta partida não será registrada; saia do duelo para criar outra sala.', 'error');
    } else if (state.role) {
      cleanup(true);
      navigateScreen('lan');
      status('Conexão encerrada. Você pode criar ou entrar em outra sala.');
    }
  }
  function stopTimers() {
    if (state.timerInterval) global.clearInterval(state.timerInterval);
    if (state.transitionTimeout) global.clearTimeout(state.transitionTimeout);
    state.timerInterval = null; state.transitionTimeout = null; state.timerDeadline = null;
  }
  function closePeer() {
    stopTimers();
    try { if (state.channel && state.channel.readyState !== 'closed') state.channel.close(); } catch (ignored) {}
    try { if (state.pc && state.pc.signalingState !== 'closed') state.pc.close(); } catch (ignored2) {}
    state.pc = null; state.channel = null; state.connected = false;
  }
  function cleanup(resetUi) {
    closePeer();
    state.role = null; state.sessionId = null; state.localPlayerId = null;
    state.roomCode = ''; state.answerCode = ''; state.outSeq = 0; state.inSeq = 0;
    state.theme = 'all'; state.themeOrder = [];
    state.remoteJoined = false; state.game = null; state.gameStarted = false; state.lastView = null; state.resultShown = false; state.disconnected = false;
    state.remoteName = 'Convidado';
    if (resetUi) {
      ['#lan-host-code', '#lan-host-answer', '#lan-join-offer', '#lan-join-code'].forEach(function (selector) { var n = el(selector); if (n) n.value = ''; });
      show(el('#lan-role'), true); show(el('#lan-panel-host'), true); show(el('#lan-panel-join'), false);
      var roleChoices = el('#lan-role'); if (roleChoices) Array.prototype.forEach.call(roleChoices.querySelectorAll('[role="radio"]'), function (node) { var selected = node.getAttribute('data-value') === 'host'; node.setAttribute('aria-checked', selected ? 'true' : 'false'); node.tabIndex = selected ? 0 : -1; });
      var hostAnswer = el('#lan-host-answer'); if (hostAnswer) show(hostAnswer.closest('.bq5-field'), false);
      var guestAnswer = el('#lan-join-code'); if (guestAnswer) show(guestAnswer.closest('.bq5-field'), false);
      show(el('#m13-name-wrap'), true);
      var createButton = el('#m13-create-room');
      if (createButton) { createButton.disabled = false; createButton.textContent = 'Criar sala e gerar convite'; show(createButton, true); }
      var joinButton = el('#lan-join-connect'); if (joinButton) { joinButton.disabled = false; show(joinButton, true); }
      var acceptButton = el('#lan-host-accept'); if (acceptButton) { acceptButton.disabled = false; acceptButton.textContent = 'Confirmar conexão'; }
      show(el('#m13-connect-reset'), false);
      var players = el('#lan-players'); var playersSection = players && players.closest('.bq5-section'); if (playersSection) show(playersSection, false);
      var oldFooter = el('#screen-lan .bq5-actionbar'); if (oldFooter) show(oldFooter, false);
      var lobby = el('#m13-lobby'); if (lobby) while (lobby.firstChild) lobby.removeChild(lobby.firstChild);
      var game = el('#m13-game'); if (game) while (game.firstChild) game.removeChild(game.firstChild);
      var start = el('#lan-start'); if (start) start.disabled = true;
    }
  }

  function ensureUi() {
    var screen = el('#screen-lan');
    var main = el('#bq5-main');
    if (!screen || !main || !global.document) return false;

    if (!el('#m13-player-name')) {
      var header = screen.querySelector('.bq5-screen__head');
      var nameWrap = global.document.createElement('label');
      nameWrap.id = 'm13-name-wrap'; nameWrap.className = 'bq5-field m13-name-field';
      var nameLabel = global.document.createElement('span'); nameLabel.className = 'bq5-label'; nameLabel.textContent = 'Seu nome';
      var nameInput = global.document.createElement('input'); nameInput.id = 'm13-player-name'; nameInput.className = 'bq5-input'; nameInput.type = 'text'; nameInput.maxLength = 24; nameInput.autocomplete = 'nickname'; nameInput.value = 'Jogador';
      nameWrap.appendChild(nameLabel); nameWrap.appendChild(nameInput);
      if (header && header.parentNode) header.parentNode.insertBefore(nameWrap, header.nextSibling); else screen.insertBefore(nameWrap, screen.firstChild);
    }

    var hostPanel = el('#lan-panel-host');
    if (hostPanel && !el('#m13-create-room')) {
      var create = global.document.createElement('button');
      create.type = 'button'; create.className = 'bq5-btn bq5-btn--primary bq5-btn--block m13-create-room';
      create.id = 'm13-create-room'; create.setAttribute('data-m13-action', 'create-room'); create.textContent = 'Criar sala e gerar convite';
      hostPanel.insertBefore(create, hostPanel.firstChild);
    }

    var hostCopy = el('#lan-host-copy'); if (hostCopy) hostCopy.textContent = 'Copiar convite';
    var acceptButton = el('#lan-host-accept'); if (acceptButton) acceptButton.textContent = 'Confirmar conexão';
    var guestCopy = el('#lan-join-copy'); if (guestCopy) guestCopy.textContent = 'Copiar resposta';
    var guestAnswerLabel = el('#lan-join-code');
    if (guestAnswerLabel) { var label = guestAnswerLabel.closest('.bq5-field'); var labelText = label && label.querySelector('.bq5-label'); if (labelText) labelText.textContent = 'Sua resposta — envie ao anfitrião'; }

    var hostAnswer = el('#lan-host-answer');
    if (hostAnswer) show(hostAnswer.closest('.bq5-field'), false);
    var guestAnswer = el('#lan-join-code');
    if (guestAnswer) show(guestAnswer.closest('.bq5-field'), false);

    if (!el('#m13-connect-reset')) {
      var resetWrap = global.document.createElement('div'); resetWrap.id = 'm13-connect-reset'; resetWrap.className = 'm13-connect-reset'; resetWrap.hidden = true;
      var reset = global.document.createElement('button'); reset.type = 'button'; reset.className = 'bq5-btn bq5-btn--ghost'; reset.setAttribute('data-m13-action', 'reset'); reset.textContent = 'Trocar opção';
      resetWrap.appendChild(reset); screen.appendChild(resetWrap);
    }

    var roleSection = el('#lan-role');
    if (roleSection) roleSection.classList.add('m13-role-switch');
    var hostPanelNode = el('#lan-panel-host'); if (hostPanelNode) hostPanelNode.classList.add('m13-connect-panel');
    var joinPanelNode = el('#lan-panel-join'); if (joinPanelNode) joinPanelNode.classList.add('m13-connect-panel');
    var statusNode = el('#lan-status'); if (statusNode) statusNode.classList.add('m13-connect-status');
    var players = el('#lan-players');
    var playersSection = players && players.closest('.bq5-section');
    if (playersSection) playersSection.classList.add('m13-connect-players');
    var oldStart = el('#lan-start'); if (oldStart) oldStart.hidden = true;
    var oldFooter = el('#screen-lan .bq5-actionbar'); if (oldFooter) oldFooter.hidden = true;

    if (!el('#screen-m13-lobby')) {
      var lobbyScreen = global.document.createElement('section');
      lobbyScreen.id = 'screen-m13-lobby'; lobbyScreen.className = 'bq5-screen m13-lobby-screen'; lobbyScreen.setAttribute('data-screen', 'm13-lobby'); lobbyScreen.setAttribute('aria-labelledby', 'm13-lobby-title'); lobbyScreen.hidden = true;
      var lobbyHead = global.document.createElement('header'); lobbyHead.className = 'bq5-screen__head';
      var lobbyTitle = global.document.createElement('h1'); lobbyTitle.id = 'm13-lobby-title'; lobbyTitle.className = 'bq5-screen__title'; lobbyTitle.textContent = 'Preparação do duelo';
      var lobbyLead = global.document.createElement('p'); lobbyLead.className = 'bq5-screen__lead'; lobbyLead.textContent = 'O anfitrião define o tema. Os dois jogadores acompanham a preparação nesta tela.';
      lobbyHead.appendChild(lobbyTitle); lobbyHead.appendChild(lobbyLead); lobbyScreen.appendChild(lobbyHead);
      var lobbyBody = global.document.createElement('div'); lobbyBody.className = 'm13-lobby-body';
      var lobbyContent = global.document.createElement('section'); lobbyContent.id = 'm13-lobby'; lobbyContent.className = 'm13-lobby-content';
      lobbyBody.appendChild(lobbyContent); lobbyScreen.appendChild(lobbyBody);
      main.appendChild(lobbyScreen);
    }

    if (!el('#screen-m13-game')) {
      var gameScreen = global.document.createElement('section');
      gameScreen.id = 'screen-m13-game'; gameScreen.className = 'bq5-screen m13-game-screen'; gameScreen.setAttribute('data-screen', 'm13-game'); gameScreen.setAttribute('aria-labelledby', 'm13-game-title'); gameScreen.hidden = true;
      var gameHead = global.document.createElement('header'); gameHead.className = 'bq5-screen__head m13-game-screen__head';
      var gameTitle = global.document.createElement('h1'); gameTitle.id = 'm13-game-title'; gameTitle.className = 'bq5-screen__title'; gameTitle.textContent = 'Duelo 1×1';
      gameHead.appendChild(gameTitle); gameScreen.appendChild(gameHead);
      var gameRoot = global.document.createElement('div'); gameRoot.id = 'm13-game'; gameRoot.className = 'm13-game'; gameRoot.setAttribute('aria-live', 'polite');
      gameScreen.appendChild(gameRoot); main.appendChild(gameScreen);
    }
    return true;
  }

  function renderPlayers() {
    var root = el('#lan-players'); if (!root) return;
    while (root.firstChild) root.removeChild(root.firstChild);
    var names = state.role === 'guest'
      ? [{ name: state.remoteName, label: 'Anfitrião' }, { name: state.localName, label: 'Você' }]
      : [{ name: state.localName, label: 'Você' }, { name: state.remoteName, label: state.connected ? 'Convidado' : 'Aguardando convidado' }];
    names.forEach(function (entry) {
      var row = global.document.createElement('div'); row.className = 'bq5-list__item m13-player';
      var strong = global.document.createElement('strong'); strong.textContent = entry.name;
      var small = global.document.createElement('span'); small.className = 'm13-player__role'; small.textContent = entry.label;
      row.appendChild(strong); row.appendChild(small); root.appendChild(row);
    });
  }
  function shuffledThemes() {
    var themes = BQ5.multiplayer.duel.themes();
    for (var i = themes.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1)); var t = themes[i]; themes[i] = themes[j]; themes[j] = t;
    }
    return themes;
  }
  function setConnectionUi(paired, inGame) {
    var screen = el('#screen-lan');
    if (!screen) return;
    if (inGame) { navigateScreen('m13-game'); return; }
    if (paired) { navigateScreen('m13-lobby'); return; }
    navigateScreen('lan');
    show(el('#lan-role'), !state.role);
    show(el('#lan-panel-host'), !state.role || state.role === 'host');
    show(el('#lan-panel-join'), state.role === 'guest');
    show(el('#m13-name-wrap'), true);
    show(el('#m13-connect-reset'), !!state.role && !state.connected);
    var players = el('#lan-players');
    var playersSection = players && players.closest('.bq5-section');
    if (playersSection) show(playersSection, !!(state.role && state.pc));
  }
  function themeGlyph(theme) {
    return ({ all: '✦', cultura: '◈', economia: '↗', animais: '◉', natureza: '❋', cidades: '▦' })[theme] || '◆';
  }
  function themeDescription(theme) {
    return ({ all: 'Questões dos cinco eixos', cultura: 'Patrimônio, costumes e sociedade', economia: 'Produção, trabalho e circulação', animais: 'Fauna e biodiversidade brasileira', natureza: 'Vegetação, biomas, clima e relevo', cidades: 'Território e vida urbana' })[theme] || 'Tema do duelo';
  }
  function renderLobby() {
    var root = el('#m13-lobby'); if (!root) return;
    var paired = !!(state.connected && state.sessionId && state.localPlayerId && state.remoteJoined);
    if (!paired) { setConnectionUi(false, false); return; }
    setConnectionUi(true, false);
    while (root.firstChild) root.removeChild(root.firstChild);

    var roster = global.document.createElement('div'); roster.className = 'm13-lobby-roster';
    [
      { name: state.role === 'host' ? state.localName : state.remoteName, role: 'Anfitrião', self: state.role === 'host' },
      { name: state.role === 'guest' ? state.localName : state.remoteName, role: 'Convidado', self: state.role === 'guest' }
    ].forEach(function (player) {
      var card = global.document.createElement('div'); card.className = 'm13-lobby-player';
      card.setAttribute('data-self', player.self ? 'true' : 'false');
      var icon = global.document.createElement('span'); icon.className = 'm13-lobby-player__icon'; icon.setAttribute('aria-hidden', 'true'); icon.textContent = player.self ? '◎' : '○';
      var info = global.document.createElement('span'); info.className = 'm13-lobby-player__info';
      appendText(info, 'strong', 'm13-lobby-player__name', player.name);
      appendText(info, 'small', 'm13-lobby-player__role', player.role + (player.self ? ' · Você' : ''));
      var online = global.document.createElement('span'); online.className = 'm13-lobby-player__online'; online.textContent = 'Conectado';
      card.appendChild(icon); card.appendChild(info); card.appendChild(online); roster.appendChild(card);
    });
    root.appendChild(roster);

    var section = global.document.createElement('section'); section.className = 'm13-theme-section';
    appendText(section, 'h2', 'bq5-section__title', 'Escolha o tema da partida');
    appendText(section, 'p', 'm13-theme-intro', state.role === 'host'
      ? 'Selecione o eixo temático. A escolha será atualizada no aparelho do convidado.'
      : 'O anfitrião está escolhendo o tema. Você acompanha a seleção, sem controles nesta etapa.');
    var grid = global.document.createElement('div'); grid.className = 'm13-theme-grid'; grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', 'Temas disponíveis');
    var labels = BQ5.multiplayer.duel.themeLabels();
    var order = state.themeOrder && state.themeOrder.length ? state.themeOrder : BQ5.multiplayer.duel.themes();
    order.forEach(function (key) {
      var button = global.document.createElement('button'); button.type = 'button'; button.className = 'm13-theme-card';
      button.setAttribute('data-m13-action', 'theme'); button.setAttribute('data-value', key); button.setAttribute('data-theme', key);
      button.setAttribute('aria-pressed', state.theme === key ? 'true' : 'false');
      button.disabled = state.role !== 'host';
      var symbol = global.document.createElement('span'); symbol.className = 'm13-theme-card__symbol'; symbol.setAttribute('aria-hidden', 'true'); symbol.textContent = themeGlyph(key);
      var title = global.document.createElement('strong'); title.className = 'm13-theme-card__title'; title.textContent = labels[key] || key;
      var description = global.document.createElement('span'); description.className = 'm13-theme-card__description'; description.textContent = themeDescription(key);
      var mark = global.document.createElement('span'); mark.className = 'm13-theme-card__mark'; mark.textContent = state.theme === key ? 'Selecionado' : (state.role === 'host' ? 'Selecionar' : 'Aguardando');
      button.appendChild(symbol); button.appendChild(title); button.appendChild(description); button.appendChild(mark); grid.appendChild(button);
    });
    section.appendChild(grid);
    var selected = global.document.createElement('p'); selected.className = 'm13-theme-selected';
    selected.textContent = 'Tema atual: ' + (labels[state.theme] || 'Tema livre'); section.appendChild(selected);
    root.appendChild(section);

    var statusPanel = global.document.createElement('div'); statusPanel.className = 'm13-lobby-status';
    var statusIcon = global.document.createElement('span'); statusIcon.className = 'm13-lobby-status__icon'; statusIcon.textContent = state.role === 'host' ? '◆' : '…';
    statusPanel.appendChild(statusIcon);
    var statusText = appendText(statusPanel, 'p', 'm13-lobby-status__text', state.role === 'host'
      ? 'Você controla a configuração. Inicie quando estiver satisfeito com a seleção.'
      : 'Aguarde nesta tela. A partida começará automaticamente quando o anfitrião iniciar.');
    statusText.id = 'm13-lobby-status';
    root.appendChild(statusPanel);

    if (state.role === 'host') {
      var actions = global.document.createElement('div'); actions.className = 'm13-lobby-actions';
      var start = actionButton('Iniciar duelo', 'start'); start.className = 'bq5-btn bq5-btn--primary bq5-btn--lg';
      actions.appendChild(start);
      var leave = actionButton('Sair da sala', 'leave'); leave.className = 'bq5-btn bq5-btn--ghost'; actions.appendChild(leave);
      root.appendChild(actions);
    }
  }
  function actionButton(label, action, value) {
    var button = global.document.createElement('button');
    button.type = 'button'; button.className = 'bq5-btn bq5-btn--secondary';
    button.setAttribute('data-m13-action', action);
    if (value != null) button.setAttribute('data-value', String(value));
    button.textContent = label;
    return button;
  }
  function publishLobby() {
    renderLobby();
    if (state.role === 'host') send({ type: 'lobby', theme: state.theme, themeOrder: state.themeOrder, hostName: state.localName });
  }

  function createRoom() {
    cleanup(false);
    state.role = 'host'; state.localName = getName(); state.localPlayerId = 'p1';
    setConnectionUi(false, false);
    state.sessionId = randomId('s-'); state.fingerprint = fingerprint(); state.themeOrder = shuffledThemes(); state.theme = 'all';
    if (!state.fingerprint || !bankQuestions().length) { toast('O banco de questões ainda não está carregado.', 'error'); return; }
    var createButton = el('#m13-create-room'); if (createButton) { createButton.disabled = true; createButton.textContent = 'Gerando convite…'; }
    try { state.pc = makePeerConnection(); }
    catch (error) { status(error.message); if (createButton) { createButton.disabled = false; createButton.textContent = 'Criar sala e gerar convite'; } return; }
    var channel = state.pc.createDataChannel('bq5-m13', { ordered: true }); bindChannel(channel);
    state.pc.createOffer().then(function (offer) {
      return state.pc.setLocalDescription(offer);
    }).then(function () { return waitForIce(state.pc); }).then(function () {
      state.roomCode = makeCode('offer', state.pc.localDescription, state.sessionId);
      var field = el('#lan-host-code'); if (field) field.value = state.roomCode;
      renderPlayers();
      var answerField = el('#lan-host-answer'); if (answerField) show(answerField.closest('.bq5-field'), true);
      var createButton = el('#m13-create-room'); if (createButton) show(createButton, false);
      status('Convite pronto. Envie este código ao convidado. Quando ele devolver a resposta, cole-a no campo abaixo para concluir a conexão.');
    }).catch(function (error) {
      status('Não foi possível gerar a sala: ' + (error && error.message ? error.message : error));
      closePeer();
      if (createButton) { createButton.disabled = false; createButton.textContent = 'Criar sala e gerar convite'; }
    });
  }
  function joinRoom() {
    cleanup(false);
    state.role = 'guest'; state.localName = getName(); state.fingerprint = fingerprint();
    setConnectionUi(false, false);
    var input = el('#lan-join-offer');
    var payload;
    try { payload = parseCode(input && input.value, 'offer'); }
    catch (error) { status(error.message); return; }
    state.sessionId = payload.sessionId; state.themeOrder = [];
    if (!state.fingerprint || !bankQuestions().length) { toast('O banco de questões ainda não está carregado.', 'error'); return; }
    try { state.pc = makePeerConnection(); }
    catch (error2) { status(error2.message); return; }
    state.pc.ondatachannel = function (event) { bindChannel(event.channel); };
    state.pc.setRemoteDescription(payload.description).then(function () {
      return state.pc.createAnswer();
    }).then(function (answer) {
      return state.pc.setLocalDescription(answer);
    }).then(function () { return waitForIce(state.pc); }).then(function () {
      state.answerCode = makeCode('answer', state.pc.localDescription, state.sessionId);
      var field = el('#lan-join-code'); if (field) field.value = state.answerCode;
      if (field) show(field.closest('.bq5-field'), true);
      var joinButton = el('#lan-join-connect'); if (joinButton) show(joinButton, false);
      status('Resposta gerada. Copie este código e envie ao anfitrião. Você avançará automaticamente quando ele confirmar.');
    }).catch(function (error3) {
      status('Não foi possível entrar na sala: ' + (error3 && error3.message ? error3.message : error3));
      closePeer();
    });
  }
  function acceptAnswer() {
    if (state.role !== 'host' || !state.pc) { status('Gere primeiro um código de sala.'); return; }
    var input = el('#lan-host-answer');
    var payload;
    try { payload = parseCode(input && input.value, 'answer'); }
    catch (error) { status(error.message); return; }
    if (payload.sessionId !== state.sessionId) { status('O código de resposta pertence a outra sala.'); return; }
    var acceptButton = el('#lan-host-accept');
    if (acceptButton) { acceptButton.disabled = true; acceptButton.textContent = 'Conectando…'; }
    state.pc.setRemoteDescription(payload.description).then(function () {
      status('Resposta aceita. Estabelecendo conexão entre os aparelhos…');
    }).catch(function (error2) {
      status('Não foi possível aceitar a resposta: ' + (error2 && error2.message ? error2.message : error2));
      if (acceptButton) { acceptButton.disabled = false; acceptButton.textContent = 'Confirmar conexão'; }
    });
  }
  function copyValue(selector) {
    var field = el(selector); if (!field || !field.value) { status('Não há código disponível para copiar.'); return; }
    if (global.navigator && global.navigator.clipboard && typeof global.navigator.clipboard.writeText === 'function') {
      global.navigator.clipboard.writeText(field.value).then(function () { toast('Código copiado.', 'success'); }, function () { fallbackCopy(field); });
    } else fallbackCopy(field);
  }
  function fallbackCopy(field) {
    field.focus(); field.select();
    var ok = false;
    try { ok = global.document.execCommand('copy'); } catch (ignored) {}
    toast(ok ? 'Código copiado.' : 'Selecione o código e copie manualmente.', ok ? 'success' : 'info');
  }

  function emitAction(action, payload) {
    if (!state.game) return;
    if (state.role === 'host') processAction('p1', action, payload || {});
    else send({ type: 'action', action: action, payload: payload || {} });
  }
  function processAction(playerId, action, payload) {
    if (!state.game || state.role !== 'host') return;
    var game = state.game;
    var result;
    if (action === 'gift') result = game.submitGift(playerId, payload.cardId);
    else if (action === 'discard') result = game.submitDiscard(playerId, payload.cardId);
    else if (action === 'question') result = game.submitQuestion(playerId, payload.cardId);
    else if (action === 'answer') result = game.submitAnswer(playerId, payload.choice);
    else return;
    if (!result || !result.ok) {
      if (playerId === 'p1') toast(result && result.message || 'Ação inválida.', 'error');
      return;
    }
    if (action === 'question' && result.complete) beginAnswerWindow();
    else if (action === 'answer' && result.complete) resolveAndAdvance();
    else publishGameState();
  }
  function startMatch() {
    if (state.role !== 'host' || !state.connected || !state.remoteJoined) return;
    var created = BQ5.multiplayer.duel.create({
      questions: bankQuestions(), theme: state.theme,
      player1Name: state.localName, player2Name: state.remoteName
    });
    if (!created.ok) { toast(created.message || 'Não foi possível iniciar a partida.', 'error'); return; }
    state.game = created.game; state.resultShown = false; state.gameStarted = true;
    var api = ui(); if (api) api.emit('game:started', { mode: '1v1', theme: state.theme, count: 15 });
    setConnectionUi(true, true);
    publishGameState();
  }
  function beginAnswerWindow() {
    stopTimers();
    state.timerDeadline = Date.now() + 30000;
    state.currentRemaining = 30000;
    publishGameState();
    send({ type: 'timer', remainingMs: state.currentRemaining });
    state.timerInterval = global.setInterval(function () {
      state.currentRemaining = Math.max(0, state.timerDeadline - Date.now());
      send({ type: 'timer', remainingMs: state.currentRemaining });
      renderTimer();
      if (state.currentRemaining <= 0) {
        stopTimers();
        var result = state.game.expireAnswers();
        if (result && result.ok) showRoundResolution(result);
      }
    }, 250);
  }
  function resolveAndAdvance() {
    stopTimers();
    var result = state.game.resolveRound();
    if (result && result.ok) showRoundResolution(result);
  }
  function showRoundResolution(result) {
    publishGameState();
    if (result.phase === 'finished') {
      finishHost();
      return;
    }
    state.transitionTimeout = global.setTimeout(function () {
      var next = state.game.nextRound();
      if (next && next.ok) publishGameState();
    }, 4000);
  }
  function publishGameState() {
    if (!state.game) return;
    var localView = state.game.viewFor('p1');
    var localQuestion = state.game.questionFor('p1');
    renderGame(localView, localQuestion, state.currentRemaining);
    if (state.channel && state.channel.readyState === 'open') {
      send({ type: 'state', view: state.game.viewFor('p2'), question: state.game.questionFor('p2'), remainingMs: state.currentRemaining });
    }
  }
  function finishHost() {
    if (state.resultShown || !state.game) return;
    stopTimers();
    var guestResult = state.game.resultFor('p2');
    send({ type: 'finish', view: state.game.viewFor('p2'), result: guestResult });
    finishLocal(state.game.resultFor('p1'));
  }
  function finishLocal(result) {
    if (state.resultShown) return;
    state.resultShown = true; stopTimers();
    var api = ui();
    if (api) api.emit('game:finished', result);
    if (BQ5.screens && BQ5.screens.results && typeof BQ5.screens.results.show === 'function') {
      BQ5.screens.results.show(result);
    } else if (api && typeof api.showScreen === 'function') {
      api.toast('Partida encerrada, mas o módulo de resultados não está disponível.', 'error');
      api.showScreen('menu', { history: false });
    }
  }

  function renderGame(view, question, remainingMs) {
    var root = el('#m13-game'); if (!root || !view) return;
    navigateScreen('m13-game');
    root.hidden = false;
    state.lastView = view;
    while (root.firstChild) root.removeChild(root.firstChild);
    var top = global.document.createElement('div'); top.className = 'm13-game__top';
    appendText(top, 'p', 'm13-round', 'RODADA ' + view.round + ' / ' + view.maxRounds);
    appendText(top, 'p', 'm13-theme', view.themeLabel);
    root.appendChild(top);
    var board = global.document.createElement('div'); board.className = 'm13-board';
    board.appendChild(renderPlayerBox(view.self, true));
    board.appendChild(renderPlayerBox(view.opponent, false));
    root.appendChild(board);
    var body = global.document.createElement('section'); body.className = 'm13-phase';
    root.appendChild(body);
    if (view.phase === 'initial-gift') {
      appendText(body, 'h2', 'm13-phase__title', 'Preparação inicial');
      appendText(body, 'p', 'bq5-hint', 'Escolha uma das suas duas cartas para oferecer uma cópia ao adversário. A carta original permanece na sua mão.');
      renderCardButtons(body, view.self.hand, 'gift', 'Oferecer cópia desta carta', !view.giftsSubmitted);
      appendText(body, 'p', 'm13-wait', view.giftsSubmitted ? 'Escolha registrada. Aguardando o outro jogador.' : 'Sua mão terá três cartas antes da primeira rodada.');
    } else if (view.phase === 'discard') {
      appendText(body, 'h2', 'm13-phase__title', 'Descarte estratégico');
      appendText(body, 'p', 'm13-instruction', 'Escolha uma carta do oponente para descartar');
      renderCardButtons(body, view.opponent.hand, 'discard', 'Descartar esta carta', !view.discardsSubmitted);
      if (view.discardsSubmitted) appendText(body, 'p', 'm13-wait', 'Descarte registrado. Aguardando o adversário.');
    } else if (view.phase === 'choose-question') {
      appendText(body, 'h2', 'm13-phase__title', view.questionSubmitted ? 'Sua pergunta foi selecionada' : 'Escolha sua pergunta');
      appendText(body, 'p', 'bq5-hint', 'O adversário vê somente o tema e a dificuldade. O enunciado é revelado apenas no aparelho de quem selecionou a carta.');
      if (view.questionSubmitted && question) {
        appendText(body, 'h3', 'm13-question', question.question);
        var previewOptions = global.document.createElement('div'); previewOptions.className = 'm13-options';
        question.options.forEach(function (option, index) {
          var preview = actionButton(String.fromCharCode(65 + index) + ' · ' + option, 'answer', index);
          preview.disabled = true;
          previewOptions.appendChild(preview);
        });
        body.appendChild(previewOptions);
        appendText(body, 'p', 'm13-wait', 'Aguardando o outro jogador selecionar sua pergunta. O prazo comum de 30 segundos começa quando ambos tiverem escolhido.');
      } else {
        renderCardButtons(body, view.self.hand, 'question', 'Selecionar esta pergunta', true);
      }
    } else if (view.phase === 'answer') {
      appendText(body, 'h2', 'm13-phase__title', 'Responda antes do tempo acabar');
      var timer = global.document.createElement('div'); timer.id = 'm13-timer'; timer.className = 'm13-timer';
      appendText(timer, 'strong', 'm13-timer__value', formatTime(remainingMs));
      var meter = global.document.createElement('div'); meter.className = 'm13-timer__track';
      var fill = global.document.createElement('span'); fill.className = 'm13-timer__fill'; fill.style.transform = 'scaleX(' + Math.max(0, Math.min(1, remainingMs / 30000)) + ')'; meter.appendChild(fill); timer.appendChild(meter); body.appendChild(timer);
      if (question) {
        appendText(body, 'h3', 'm13-question', question.question);
        var options = global.document.createElement('div'); options.className = 'm13-options';
        question.options.forEach(function (option, index) {
          var button = actionButton(String.fromCharCode(65 + index) + ' · ' + option, 'answer', index);
          if (view.answersSubmitted) button.disabled = true;
          options.appendChild(button);
        });
        body.appendChild(options);
      } else {
        appendText(body, 'p', 'bq5-hint', 'Aguardando a seleção ou resposta do jogador neste aparelho.');
      }
      if (view.answersSubmitted) appendText(body, 'p', 'm13-wait', 'Resposta bloqueada. Aguarde a revelação simultânea.');
    } else if (view.phase === 'transition') {
      appendText(body, 'h2', 'm13-phase__title', 'Resolução da rodada');
      renderRoundSummary(body, view);
      appendText(body, 'p', 'm13-wait', 'Próxima rodada em 4 segundos…');
    } else if (view.phase === 'finished') {
      appendText(body, 'h2', 'm13-phase__title', 'Partida encerrada');
      renderRoundSummary(body, view);
    }
    var leave = actionButton('Sair do duelo', 'leave'); leave.className = 'bq5-btn bq5-btn--ghost m13-leave'; root.appendChild(leave);
    renderTimer();
  }
  function appendText(parent, tag, className, value) {
    var node = global.document.createElement(tag); if (className) node.className = className;
    node.textContent = value == null ? '' : String(value); parent.appendChild(node); return node;
  }
  function renderPlayerBox(player, self) {
    var box = global.document.createElement('section'); box.className = 'm13-player-box';
    box.setAttribute('data-self', self ? 'true' : 'false');
    var top = global.document.createElement('div'); top.className = 'm13-player-box__top';
    appendText(top, 'h3', 'm13-player-box__name', player.name + (self ? ' · Você' : ''));
    var role = global.document.createElement('span'); role.className = 'm13-player-box__role'; role.textContent = self ? 'SEU PAINEL' : 'OPONENTE';
    top.appendChild(role); box.appendChild(top);
    var hpLine = global.document.createElement('div'); hpLine.className = 'm13-player-box__hp-line';
    appendText(hpLine, 'strong', 'm13-player-box__hp', String(player.hp));
    appendText(hpLine, 'span', 'm13-player-box__hp-label', 'HP');
    hpLine.appendChild(global.document.createElement('span')).className = 'm13-player-box__spacer';
    appendText(hpLine, 'span', 'm13-player-box__hp-max', '/' + (player.hpMax || 1000));
    box.appendChild(hpLine);
    var hpTrack = global.document.createElement('div'); hpTrack.className = 'm13-hp-track';
    var hpFill = global.document.createElement('span'); hpFill.className = 'm13-hp-fill';
    hpFill.style.transform = 'scaleX(' + Math.max(0, Math.min(1, Number(player.hpRatio) || 0)) + ')';
    hpTrack.appendChild(hpFill); box.appendChild(hpTrack);
    var hand = global.document.createElement('div'); hand.className = 'm13-card-strip';
    player.hand.forEach(function (card) {
      var chip = global.document.createElement('span'); chip.className = 'm13-card-chip'; chip.setAttribute('data-theme', card.theme || 'all');
      chip.textContent = card.themeLabel + ' · ' + card.difficultyLabel;
      hand.appendChild(chip);
    });
    box.appendChild(hand);
    return box;
  }
  function renderCardButtons(parent, cards, action, label, enabled) {
    var list = global.document.createElement('div'); list.className = 'm13-card-list';
    cards.forEach(function (card, index) {
      var theme = card.theme || 'all';
      var button = actionButton('', action, card.cardId); button.className = 'm13-card-button';
      button.setAttribute('data-theme', theme);
      button.setAttribute('aria-label', card.themeLabel + ', ' + card.difficultyLabel + '. ' + label);
      var head = global.document.createElement('span'); head.className = 'm13-card-button__head';
      appendText(head, 'span', 'm13-card-button__serial', 'CARTA ' + String(index + 1).padStart(2, '0'));
      appendText(head, 'span', 'm13-card-button__stamp', 'BQ5');
      button.appendChild(head);
      var emblem = global.document.createElement('span'); emblem.className = 'm13-card-button__emblem'; emblem.setAttribute('aria-hidden', 'true'); emblem.textContent = themeGlyph(theme); button.appendChild(emblem);
      appendText(button, 'strong', 'm13-card-button__theme', card.themeLabel);
      var footer = global.document.createElement('span'); footer.className = 'm13-card-button__footer';
      appendText(footer, 'span', 'm13-card-button__difficulty', card.difficultyLabel);
      appendText(footer, 'span', 'm13-card-button__cta', label);
      button.appendChild(footer);
      if (!enabled) button.disabled = true;
      list.appendChild(button);
    });
    parent.appendChild(list);
  }
  function renderRoundSummary(parent, view) {
    var result = view.lastRound;
    if (!result) return;
    ['p1', 'p2'].forEach(function (id) {
      var item = result.players[id]; if (!item) return;
      appendText(parent, 'p', 'm13-round-line', (id === view.self.id ? 'Você' : 'Adversário') + ': ' +
        (item.timedOut ? 'tempo esgotado' : (item.correct ? 'acertou' : 'errou')) +
        (item.damage ? ' · causou ' + item.damage + ' de dano' : ' · sem dano') + ' · ' + item.hp + ' HP');
    });
  }
  function formatTime(ms) { return Math.ceil(Math.max(0, Number(ms) || 0) / 1000) + ' s'; }
  function renderTimer() {
    var timer = el('#m13-timer'); if (!timer) return;
    var left = state.timerDeadline ? Math.max(0, state.timerDeadline - Date.now()) : state.currentRemaining;
    var label = timer.querySelector('.m13-timer__value'); if (label) label.textContent = formatTime(left);
    var fill = timer.querySelector('.m13-timer__fill'); if (fill) fill.style.transform = 'scaleX(' + Math.max(0, Math.min(1, left / 30000)) + ')';
  }

  function handleAction(action, value) {
    if (action === 'create-room') createRoom();
    else if (action === 'join-room') joinRoom();
    else if (action === 'accept-answer') acceptAnswer();
    else if (action === 'copy-host') copyValue('#lan-host-code');
    else if (action === 'copy-guest') copyValue('#lan-join-code');
    else if (action === 'reset') { cleanup(true); navigateScreen('lan'); status('Escolha criar uma sala ou entrar em uma sala existente.'); }
    else if (action === 'theme') {
      if (state.role === 'host' && state.connected && state.remoteJoined && BQ5.multiplayer.duel.themes().indexOf(String(value)) !== -1) {
        state.theme = String(value); publishLobby();
      }
    } else if (action === 'start') startMatch();
    else if (action === 'gift' || action === 'discard' || action === 'question' || action === 'answer') {
      if (action === 'answer') emitAction('answer', { choice: Number(value) });
      else emitAction(action, { cardId: String(value) });
    } else if (action === 'leave') {
      if (state.role === 'host' && state.channel && state.channel.readyState === 'open') send({ type: 'aborted' });
      cleanup(true); showLan(); status('Você saiu da sala.');
    }
  }
  function bindDom() {
    var app = el('#bq5-app'); if (!app || app.__m13Bound) return;
    app.__m13Bound = true;
    app.addEventListener('click', function (event) {
      var target = event.target && event.target.closest ? event.target.closest('[data-m13-action], [data-action^="lan-"]') : null;
      if (!target || !app.contains(target)) return;
      var action = target.getAttribute('data-m13-action');
      var legacy = target.getAttribute('data-action');
      if (!action && legacy === 'lan-join') action = 'join-room';
      else if (!action && legacy === 'lan-accept') action = 'accept-answer';
      else if (!action && legacy === 'lan-copy') action = target.id === 'lan-host-copy' ? 'copy-host' : 'copy-guest';
      else if (!action && legacy === 'lan-start') action = 'start';
      if (!action) return;
      event.preventDefault(); event.stopPropagation();
      handleAction(action, target.getAttribute('data-value'));
    }, true);
    var role = el('#lan-role');
    if (role) role.addEventListener('click', function (event) {
      var button = event.target && event.target.closest ? event.target.closest('[data-value]') : null;
      if (!button || state.connected || state.pc) return;
      var value = button.getAttribute('data-value');
      Array.prototype.forEach.call(role.querySelectorAll('[role="radio"]'), function (node) {
        var selected = node === button; node.setAttribute('aria-checked', selected ? 'true' : 'false'); node.tabIndex = selected ? 0 : -1;
      });
      show(el('#lan-panel-host'), value === 'host'); show(el('#lan-panel-join'), value === 'join');
    });
  }
  function init() {
    if (initialized) return { ok: true, alreadyInitialized: true };
    if (!global.document || !BQ5.ui || !BQ5.multiplayer || !BQ5.multiplayer.duel || !BQ5.bank) return { ok: false, code: 'MISSING_DEPENDENCY' };
    ensureUi(); bindDom();
    var api = ui();
    if (api && typeof api.on === 'function') {
      listeners.push(api.on('intent:lan', showLan));
    }
    initialized = true;
    return { ok: true };
  }
  M13.init = init;
  M13.state = function () {
    return { initialized: initialized, role: state.role, connected: state.connected,
      phase: state.game ? state.game.phase() : null, sessionId: state.sessionId,
      theme: state.theme };
  };
  M13.destroy = function () {
    listeners.forEach(function (off) { if (typeof off === 'function') off(); });
    listeners = []; cleanup(false); initialized = false; return { ok: true };
  };
  BQ5.multiplayer = BQ5.multiplayer || {};
  BQ5.multiplayer.M13 = M13;
  BQ5.screens = BQ5.screens || {};
  BQ5.screens.lan = M13;
  if (global.document) init();
})(globalThis);
