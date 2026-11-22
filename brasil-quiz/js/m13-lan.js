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
    hostReady: false, guestReady: false, theme: 'all', themeOrder: [],
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
  function status(message) { text('#lan-status', message); }
  function showLan() {
    if (state.resultShown) cleanup(true);
    var api = ui();
    if (api && typeof api.showScreen === 'function') api.showScreen('lan', { history: false });
    else show(el('#screen-lan'), true);
    status('Conecte dois aparelhos na mesma rede Wi-Fi. O código de sala é trocado diretamente entre vocês.');
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
      renderPlayers();
      status('Você entrou na sala de ' + state.remoteName + '. Aguarde a escolha do tema.');
      return;
    }
    if (message.type === 'error') { status(message.message || 'A sala recusou a conexão.'); return; }
    if (!state.sessionId || envelope.sessionId !== state.sessionId || !Number.isInteger(envelope.seq) || envelope.seq <= state.inSeq) return;
    state.inSeq = envelope.seq;
    if (state.role === 'host') receiveHost(message);
    else receiveGuest(message);
  }
  function receiveHost(message) {
    if (!state.game) {
      if (message.type === 'ready') {
        state.guestReady = true;
        publishLobby();
      }
      return;
    }
    if (message.type === 'action') processAction('p2', message.action, message.payload || {});
  }
  function receiveGuest(message) {
    if (message.type === 'lobby') {
      state.theme = message.theme || 'all';
      state.themeOrder = Array.isArray(message.themeOrder) ? message.themeOrder.slice() : state.themeOrder;
      state.hostReady = !!message.hostReady;
      state.guestReady = !!message.guestReady;
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
      cleanup(false);
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
      status('Conexão encerrada. Você pode criar ou entrar em outra sala.');
      show(el('#m13-lobby'), false);
      setConnectionUi(false, false);
      renderPlayers();
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
    state.hostReady = false; state.guestReady = false; state.theme = 'all'; state.themeOrder = [];
    state.remoteJoined = false; state.game = null; state.gameStarted = false; state.lastView = null; state.resultShown = false; state.disconnected = false;
    state.remoteName = 'Convidado';
    if (resetUi) {
      ['#lan-host-code', '#lan-host-answer', '#lan-join-offer', '#lan-join-code'].forEach(function (selector) { var n = el(selector); if (n) n.value = ''; });
      show(el('#lan-role'), true); show(el('#lan-panel-host'), true); show(el('#lan-panel-join'), false);
      var roleChoices = el('#lan-role'); if (roleChoices) Array.prototype.forEach.call(roleChoices.querySelectorAll('[role="radio"]'), function (node) { var selected = node.getAttribute('data-value') === 'host'; node.setAttribute('aria-checked', selected ? 'true' : 'false'); node.tabIndex = selected ? 0 : -1; });
      show(el('#m13-name-wrap'), true);
      var players = el('#lan-players'); var playersSection = players && players.closest('.bq5-section'); if (playersSection) show(playersSection, true);
      var screen = el('#screen-lan'); var footer = screen && screen.querySelector('.bq5-actionbar'); if (footer) show(footer, true);
      show(el('#m13-lobby'), false); show(el('#m13-game'), false);
      var start = el('#lan-start'); if (start) start.disabled = true;
    }
  }

  function ensureUi() {
    var screen = el('#screen-lan');
    if (!screen || !global.document) return false;
    if (el('#m13-player-name')) return true;
    var header = screen.querySelector('.bq5-screen__head');
    var nameWrap = global.document.createElement('label');
    nameWrap.id = 'm13-name-wrap';
    nameWrap.className = 'bq5-field m13-name-field';
    var nameLabel = global.document.createElement('span'); nameLabel.className = 'bq5-label'; nameLabel.textContent = 'Seu nome';
    var nameInput = global.document.createElement('input'); nameInput.id = 'm13-player-name'; nameInput.className = 'bq5-input'; nameInput.type = 'text'; nameInput.maxLength = 24; nameInput.autocomplete = 'nickname'; nameInput.value = 'Jogador';
    nameWrap.appendChild(nameLabel); nameWrap.appendChild(nameInput);
    if (header && header.parentNode) header.parentNode.insertBefore(nameWrap, header.nextSibling); else screen.insertBefore(nameWrap, screen.firstChild);

    var hostPanel = el('#lan-panel-host');
    if (hostPanel) {
      var create = global.document.createElement('button');
      create.type = 'button'; create.className = 'bq5-btn bq5-btn--primary bq5-btn--block';
      create.id = 'm13-create-room'; create.setAttribute('data-m13-action', 'create-room'); create.textContent = 'Gerar código da sala';
      hostPanel.insertBefore(create, hostPanel.firstChild);
    }
    var players = el('#lan-players');
    var playersSection = players && players.closest('.bq5-section');
    if (playersSection) {
      var lobby = global.document.createElement('section'); lobby.id = 'm13-lobby'; lobby.className = 'bq5-section m13-panel'; lobby.hidden = true;
      playersSection.parentNode.insertBefore(lobby, playersSection.nextSibling);
    }
    var game = global.document.createElement('section'); game.id = 'm13-game'; game.className = 'm13-game'; game.hidden = true;
    screen.appendChild(game);
    return true;
  }
  function renderPlayers() {
    var root = el('#lan-players'); if (!root) return;
    while (root.firstChild) root.removeChild(root.firstChild);
    var names = state.role === 'guest'
      ? [{ name: state.remoteName, label: 'Anfitrião' }, { name: state.localName, label: 'Você' }]
      : [{ name: state.localName, label: 'Você' }, { name: state.remoteName, label: state.connected ? 'Convidado' : 'Aguardando' }];
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
    show(el('#lan-role'), !paired);
    show(el('#lan-panel-host'), !paired && (!state.role || state.role === 'host'));
    show(el('#lan-panel-join'), !paired && state.role === 'guest');
    show(el('#m13-name-wrap'), !paired && !inGame);
    var players = el('#lan-players');
    var playersSection = players && players.closest('.bq5-section');
    if (playersSection) show(playersSection, !inGame);
    var footer = screen.querySelector('.bq5-actionbar');
    if (footer) show(footer, !paired);
  }
  function renderLobby() {
    var root = el('#m13-lobby'); if (!root) return;
    var paired = !!(state.connected && state.sessionId && state.localPlayerId && state.remoteJoined);
    setConnectionUi(paired, false);
    root.hidden = !paired;
    if (root.hidden) return;
    status('Dois jogadores conectados. Definam o tema e iniciem a partida.');
    while (root.firstChild) root.removeChild(root.firstChild);
    var title = global.document.createElement('h2'); title.className = 'bq5-section__title'; title.textContent = 'Tema da partida'; root.appendChild(title);
    var summary = global.document.createElement('p'); summary.className = 'bq5-hint';
    summary.textContent = state.role === 'host' ? 'Escolha o tema compartilhado. O convidado verá a mesma seleção.' : 'O anfitrião escolherá um tema compartilhado para os dois jogadores.';
    root.appendChild(summary);
    var select = global.document.createElement('select'); select.id = 'm13-theme-select'; select.className = 'bq5-input'; select.setAttribute('aria-label', 'Tema do duelo');
    var labels = BQ5.multiplayer.duel.themeLabels();
    state.themeOrder.forEach(function (key) {
      var option = global.document.createElement('option'); option.value = key; option.textContent = labels[key]; select.appendChild(option);
    });
    select.value = state.theme;
    if (state.role !== 'host' || state.hostReady) select.disabled = true;
    root.appendChild(select);
    var themeLabel = global.document.createElement('p'); themeLabel.className = 'm13-current-theme';
    themeLabel.textContent = 'Tema definido: ' + (labels[state.theme] || 'Tema livre'); root.appendChild(themeLabel);
    var readyInfo = global.document.createElement('p'); readyInfo.className = 'bq5-hint';
    readyInfo.textContent = 'Anfitrião: ' + (state.hostReady ? 'pronto' : 'aguardando') + ' · Convidado: ' + (state.guestReady ? 'pronto' : 'aguardando'); root.appendChild(readyInfo);
    var actions = global.document.createElement('div'); actions.className = 'm13-actions';
    if (state.role === 'guest' && !state.guestReady) {
      var ready = actionButton('Pronto para jogar', 'ready'); actions.appendChild(ready);
    }
    if (state.role === 'host') {
      var hostReady = actionButton(state.hostReady ? 'Você está pronto' : 'Confirmar tema e ficar pronto', 'ready');
      hostReady.disabled = state.hostReady; actions.appendChild(hostReady);
      var start = actionButton('Iniciar duelo', 'start'); start.disabled = !(state.hostReady && state.guestReady); actions.appendChild(start);
    }
    var leave = actionButton('Sair da sala', 'leave'); leave.className = 'bq5-btn bq5-btn--ghost'; actions.appendChild(leave);
    root.appendChild(actions);
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
    renderPlayers(); renderLobby();
    if (state.role === 'host') send({ type: 'lobby', theme: state.theme, themeOrder: state.themeOrder, hostReady: state.hostReady, guestReady: state.guestReady, hostName: state.localName });
  }

  function createRoom() {
    cleanup(false);
    state.role = 'host'; state.localName = getName(); state.localPlayerId = 'p1';
    setConnectionUi(false, false);
    state.sessionId = randomId('s-'); state.fingerprint = fingerprint(); state.themeOrder = shuffledThemes(); state.theme = 'all';
    if (!state.fingerprint || !bankQuestions().length) { toast('O banco de questões ainda não está carregado.', 'error'); return; }
    try { state.pc = makePeerConnection(); }
    catch (error) { status(error.message); return; }
    var channel = state.pc.createDataChannel('bq5-m13', { ordered: true }); bindChannel(channel);
    state.pc.createOffer().then(function (offer) {
      return state.pc.setLocalDescription(offer);
    }).then(function () { return waitForIce(state.pc); }).then(function () {
      state.roomCode = makeCode('offer', state.pc.localDescription, state.sessionId);
      var field = el('#lan-host-code'); if (field) field.value = state.roomCode;
      renderPlayers();
      status('Código criado. Envie-o ao outro aparelho conectado à mesma rede Wi-Fi. Depois, cole aqui o código de resposta.');
    }).catch(function (error) {
      status('Não foi possível gerar a sala: ' + (error && error.message ? error.message : error));
      closePeer();
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
      status('Resposta gerada. Envie este código ao anfitrião e aguarde a confirmação.');
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
    state.pc.setRemoteDescription(payload.description).then(function () {
      status('Resposta aceita. Estabelecendo conexão entre os aparelhos…');
    }).catch(function (error2) { status('Não foi possível aceitar a resposta: ' + (error2 && error2.message ? error2.message : error2)); });
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
    if (state.role !== 'host' || !state.hostReady || !state.guestReady || !state.connected) return;
    var created = BQ5.multiplayer.duel.create({
      questions: bankQuestions(), theme: state.theme,
      player1Name: state.localName, player2Name: state.remoteName
    });
    if (!created.ok) { toast(created.message || 'Não foi possível iniciar a partida.', 'error'); return; }
    state.game = created.game; state.resultShown = false; state.gameStarted = true;
    var api = ui(); if (api) api.emit('game:started', { mode: '1v1', theme: state.theme, count: 15 });
    setConnectionUi(true, true);
    show(el('#m13-lobby'), false); show(el('#m13-game'), true);
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
    if (self) box.setAttribute('data-self', 'true');
    appendText(box, 'h3', 'm13-player-box__name', player.name + (self ? ' (Você)' : ''));
    appendText(box, 'strong', 'm13-player-box__hp', player.hp + ' HP');
    var hpTrack = global.document.createElement('div'); hpTrack.className = 'm13-hp-track';
    var hpFill = global.document.createElement('span'); hpFill.className = 'm13-hp-fill';
    hpFill.style.transform = 'scaleX(' + Math.max(0, Math.min(1, Number(player.hpRatio) || 0)) + ')';
    hpTrack.appendChild(hpFill); box.appendChild(hpTrack);
    var cards = global.document.createElement('div'); cards.className = 'm13-card-strip';
    player.hand.forEach(function (card) {
      var label = global.document.createElement('span'); label.className = 'm13-card-chip';
      label.textContent = card.themeLabel + ' · ' + card.difficultyLabel;
      cards.appendChild(label);
    });
    box.appendChild(cards);
    return box;
  }
  function renderCardButtons(parent, cards, action, label, enabled) {
    var list = global.document.createElement('div'); list.className = 'm13-card-list';
    cards.forEach(function (card) {
      var button = actionButton('', action, card.cardId); button.className = 'm13-card-button';
      appendText(button, 'strong', 'm13-card-button__theme', card.themeLabel);
      appendText(button, 'span', 'm13-card-button__difficulty', card.difficultyLabel);
      appendText(button, 'span', 'm13-card-button__cta', label);
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
    else if (action === 'ready') {
      if (state.role === 'host') { state.hostReady = true; publishLobby(); }
      else if (state.role === 'guest') { state.guestReady = true; send({ type: 'ready' }); status('Pronto. Aguardando o anfitrião iniciar.'); }
      renderLobby();
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
    var screen = el('#screen-lan'); if (!screen || screen.__m13Bound) return;
    screen.__m13Bound = true;
    screen.addEventListener('click', function (event) {
      var target = event.target && event.target.closest ? event.target.closest('[data-m13-action], [data-action]') : null;
      if (!target || !screen.contains(target)) return;
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
    var selectTheme = screen;
    selectTheme.addEventListener('change', function (event) {
      if (event.target && event.target.id === 'm13-theme-select' && state.role === 'host' && !state.hostReady) {
        state.theme = event.target.value; publishLobby();
      }
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
      theme: state.theme, hostReady: state.hostReady, guestReady: state.guestReady };
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
