/* ============================================================
 * Brasil em 5 Eixos — js/multiplayer/lan.js (camada de transporte)
 * Responsabilidade: ligar DOIS aparelhos na mesma rede (Wi-Fi/LAN) por WebRTC,
 * sem servidor e sem internet, trocando dois códigos de texto:
 *   1) o anfitrião gera o CÓDIGO DA SALA;
 *   2) o convidado cola esse código e recebe o CÓDIGO DE RESPOSTA;
 *   3) o anfitrião cola a resposta e o canal de dados abre.
 * A UI também pode exibir cada código em QR local; a troca de texto permanece.
 *
 * Esta camada NÃO conhece regras do jogo, telas, storage ou engine. Ela só
 * entrega um "transporte" com a interface abaixo, usada por multiplayer/local.js:
 *
 *   transport.send(obj)        -> true/false (serializa em JSON)
 *   transport.onOpen(fn)       -> chamado quando o canal abre
 *   transport.onMessage(fn)    -> fn(obj) para cada mensagem recebida
 *   transport.onClose(fn)      -> fn(reason) quando o canal fecha/cai
 *   transport.isOpen()         -> boolean
 *   transport.close()
 *
 * API pública (BQ5.lan):
 *   supported()                -> WebRTC disponível?
 *   host()                     -> { ready:Promise<codigoSala>, accept(codigoResposta):Promise, transport, close() }
 *   join(codigoSala)           -> { ready:Promise<codigoResposta>, transport, close() }
 *   loopbackPair()             -> [a, b] transportes ligados em memória (testes/desenvolvimento)
 *
 * Códigos: texto curto "BQ5-O-…" (sala) / "BQ5-A-…" (resposta). Usam deflate
 * quando o navegador oferece CompressionStream; senão, base64 simples
 * (prefixo minúsculo "o"/"a").
 *
 * Limitação conhecida: sem servidor STUN/TURN, só funciona quando os aparelhos
 * conseguem se enxergar na rede (mesmo Wi-Fi, sem "isolamento de clientes").
 * Sem async/await (padrão do projeto); usa Promises.
 * ============================================================ */
(function (global) {
  'use strict';

  var BQ5 = global.BQ5 = global.BQ5 || {};

  var GATHER_TIMEOUT_MS = 4000;      // tempo máximo esperando os candidatos ICE
  var HEARTBEAT_MS = 4000;           // batimento enviado a cada 4 s
  var SILENCE_LIMIT_MS = 15000;      // sem nada recebido por 15 s => conexão considerada perdida
  var PING = '~';                    // tipo interno do batimento (nunca chega à aplicação)

  function cfg() { return BQ5.config || {}; }

  function supported() {
    return typeof global.RTCPeerConnection === 'function';
  }

  // ---------- códigos (texto <-> SDP) ----------

  function toB64Url(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return global.btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function fromB64Url(text) {
    var b64 = String(text).replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    var bin = global.atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function streamToBytes(stream) {
    return new global.Response(stream).arrayBuffer().then(function (buffer) { return new Uint8Array(buffer); });
  }

  function deflate(text) {
    var input = new global.Blob([text]).stream().pipeThrough(new global.CompressionStream('deflate-raw'));
    return streamToBytes(input);
  }

  function inflate(bytes) {
    var input = new global.Blob([bytes]).stream().pipeThrough(new global.DecompressionStream('deflate-raw'));
    return streamToBytes(input).then(function (out) { return new global.TextDecoder().decode(out); });
  }

  function canCompress() {
    return typeof global.CompressionStream === 'function' && typeof global.DecompressionStream === 'function' &&
      typeof global.Blob === 'function' && typeof global.Response === 'function';
  }

  function utf8Bytes(text) { return new global.TextEncoder().encode(text); }

  // kind: 'O' (sala) | 'A' (resposta)
  function encodeCode(kind, sdp) {
    var plain = function () { return 'BQ5-' + kind.toLowerCase() + '-' + toB64Url(utf8Bytes(sdp)); };
    if (!canCompress()) return Promise.resolve(plain());
    return deflate(sdp).then(function (bytes) { return 'BQ5-' + kind + '-' + toB64Url(bytes); }, plain);
  }

  // Retorna Promise<{kind, sdp}>; rejeita com Error de mensagem amigável.
  function decodeCode(raw) {
    var text = String(raw == null ? '' : raw).replace(/\s+/g, '');
    var match = /^BQ5-([OAoa])-([A-Za-z0-9_-]+)$/.exec(text);
    if (!match) return Promise.reject(new Error('Código inválido. Confira se copiou o código inteiro.'));
    var letter = match[1];
    var kind = letter.toUpperCase();
    var compressed = letter === kind;
    var bytes;
    try { bytes = fromB64Url(match[2]); }
    catch (error) { return Promise.reject(new Error('Código inválido. Confira se copiou o código inteiro.')); }
    if (!compressed) {
      return Promise.resolve({ kind: kind, sdp: new global.TextDecoder().decode(bytes) });
    }
    if (!canCompress()) return Promise.reject(new Error('Este navegador não consegue ler códigos compactados. Use um navegador mais recente.'));
    return inflate(bytes).then(function (sdp) { return { kind: kind, sdp: sdp }; },
      function () { return Promise.reject(new Error('Código inválido. Confira se copiou o código inteiro.')); });
  }

  // ---------- transporte sobre RTCDataChannel ----------

  function makeTransport() {
    var openHandlers = [];
    var messageHandlers = [];
    var closeHandlers = [];
    var channel = null;
    var closed = false;
    var lastHeard = 0;
    var beat = null;

    function now() { return Date.now(); }

    function stopBeat() {
      if (beat !== null && typeof global.clearInterval === 'function') global.clearInterval(beat);
      beat = null;
    }

    function fireClose(reason) {
      if (closed) return;
      closed = true;
      stopBeat();
      closeHandlers.slice().forEach(function (fn) { try { fn(reason || 'closed'); } catch (e) { /* ignora */ } });
    }

    var T = {
      send: function (obj) {
        if (!channel || channel.readyState !== 'open') return false;
        try { channel.send(JSON.stringify(obj)); return true; }
        catch (error) { return false; }
      },
      onOpen: function (fn) { if (typeof fn === 'function') openHandlers.push(fn); },
      onMessage: function (fn) { if (typeof fn === 'function') messageHandlers.push(fn); },
      onClose: function (fn) { if (typeof fn === 'function') closeHandlers.push(fn); },
      isOpen: function () { return !closed && !!channel && channel.readyState === 'open'; },
      close: function () {
        var was = closed;
        try { if (channel) channel.close(); } catch (e) { /* ignora */ }
        if (!was) fireClose('local');
      },
      // uso interno (somente deste arquivo)
      _bind: function (dc) {
        channel = dc;
        dc.onopen = function () {
          lastHeard = now();
          stopBeat();
          if (typeof global.setInterval === 'function') {
            beat = global.setInterval(function () {
              if (closed) { stopBeat(); return; }
              T.send({ t: PING });
              if (now() - lastHeard > SILENCE_LIMIT_MS) {
                try { dc.close(); } catch (e) { /* ignora */ }
                fireClose('timeout');
              }
            }, HEARTBEAT_MS);
          }
          openHandlers.slice().forEach(function (fn) { try { fn(); } catch (e) { /* ignora */ } });
        };
        dc.onmessage = function (event) {
          lastHeard = now();
          var data;
          try { data = JSON.parse(event.data); } catch (error) { return; }
          if (!data || typeof data !== 'object' || data.t === PING) return;
          messageHandlers.slice().forEach(function (fn) { try { fn(data); } catch (e) { /* ignora */ } });
        };
        dc.onclose = function () { fireClose('closed'); };
        dc.onerror = function () { /* o fechamento é tratado em onclose */ };
        if (dc.readyState === 'open') dc.onopen();
      },
      _fail: function (reason) { fireClose(reason); }
    };
    return T;
  }

  // ---------- RTCPeerConnection ----------

  function newPeer() {
    var servers = cfg().lanIceServers;
    return new global.RTCPeerConnection({ iceServers: Array.isArray(servers) ? servers : [] });
  }

  // Espera o fim da coleta de candidatos (ou o tempo limite) e devolve o SDP final.
  function gathered(pc) {
    return new Promise(function (resolve) {
      var done = false;
      var timer = null;
      function finish() {
        if (done) return;
        done = true;
        if (timer !== null) global.clearTimeout(timer);
        try { pc.removeEventListener('icegatheringstatechange', onChange); } catch (e) { /* ignora */ }
        resolve(pc.localDescription && pc.localDescription.sdp ? pc.localDescription.sdp : '');
      }
      function onChange() { if (pc.iceGatheringState === 'complete') finish(); }
      if (pc.iceGatheringState === 'complete') { finish(); return; }
      pc.addEventListener('icegatheringstatechange', onChange);
      timer = global.setTimeout(finish, GATHER_TIMEOUT_MS);
    });
  }

  function watchPeer(pc, transport) {
    pc.addEventListener('connectionstatechange', function () {
      if (pc.connectionState === 'failed') transport._fail('failed');
      else if (pc.connectionState === 'closed') transport._fail('closed');
    });
  }

  function host() {
    if (!supported()) {
      return { ready: Promise.reject(new Error('Este navegador não oferece WebRTC.')), accept: function () { return Promise.reject(new Error('WebRTC indisponível.')); }, transport: null, close: function () {} };
    }
    var pc = newPeer();
    var transport = makeTransport();
    watchPeer(pc, transport);
    transport._bind(pc.createDataChannel('bq5', { ordered: true }));

    var ready = pc.createOffer()
      .then(function (offer) { return pc.setLocalDescription(offer); })
      .then(function () { return gathered(pc); })
      .then(function (sdp) {
        if (!sdp) return Promise.reject(new Error('Não foi possível gerar o código da sala.'));
        return encodeCode('O', sdp);
      });

    var accepted = false;
    return {
      ready: ready,
      transport: transport,
      accept: function (code) {
        if (accepted) return Promise.reject(new Error('Este código de resposta já foi usado. Gere uma nova sala.'));
        return decodeCode(code).then(function (decoded) {
          if (decoded.kind !== 'A') return Promise.reject(new Error('Esse é o código da sala. Cole aqui o CÓDIGO DE RESPOSTA do outro jogador.'));
          accepted = true;
          return pc.setRemoteDescription({ type: 'answer', sdp: decoded.sdp });
        }).catch(function (error) {
          return Promise.reject(error instanceof Error ? error : new Error('Código de resposta inválido.'));
        });
      },
      close: function () { transport.close(); try { pc.close(); } catch (e) { /* ignora */ } }
    };
  }

  function join(code) {
    if (!supported()) {
      return { ready: Promise.reject(new Error('Este navegador não oferece WebRTC.')), transport: null, close: function () {} };
    }
    var pc = newPeer();
    var transport = makeTransport();
    watchPeer(pc, transport);
    pc.addEventListener('datachannel', function (event) { transport._bind(event.channel); });

    var ready = decodeCode(code).then(function (decoded) {
      if (decoded.kind !== 'O') return Promise.reject(new Error('Esse é um código de resposta. Cole aqui o CÓDIGO DA SALA do anfitrião.'));
      return pc.setRemoteDescription({ type: 'offer', sdp: decoded.sdp });
    }).then(function () { return pc.createAnswer(); })
      .then(function (answer) { return pc.setLocalDescription(answer); })
      .then(function () { return gathered(pc); })
      .then(function (sdp) {
        if (!sdp) return Promise.reject(new Error('Não foi possível gerar o código de resposta.'));
        return encodeCode('A', sdp);
      });

    return {
      ready: ready,
      transport: transport,
      close: function () { transport.close(); try { pc.close(); } catch (e) { /* ignora */ } }
    };
  }

  // ---------- transporte em memória (testes e desenvolvimento) ----------

  function loopbackPair() {
    function side() {
      var o = [], m = [], c = [];
      return {
        peer: null, closed: false, handlers: { o: o, m: m, c: c },
        send: function (obj) {
          var self = this;
          if (self.closed || !self.peer || self.peer.closed) return false;
          var raw = JSON.stringify(obj);
          var target = self.peer;
          var deliver = function () {
            if (target.closed) return;
            var data = JSON.parse(raw);
            target.handlers.m.slice().forEach(function (fn) { fn(data); });
          };
          if (typeof global.setTimeout === 'function') global.setTimeout(deliver, 0); else deliver();
          return true;
        },
        onOpen: function (fn) { o.push(fn); },
        onMessage: function (fn) { m.push(fn); },
        onClose: function (fn) { c.push(fn); },
        isOpen: function () { return !this.closed && !!this.peer && !this.peer.closed; },
        close: function () {
          if (this.closed) return;
          this.closed = true;
          var other = this.peer;
          c.slice().forEach(function (fn) { fn('local'); });
          if (other && !other.closed) {
            other.closed = true;
            var notify = function () { other.handlers.c.slice().forEach(function (fn) { fn('closed'); }); };
            if (typeof global.setTimeout === 'function') global.setTimeout(notify, 0); else notify();
          }
        },
        open: function () { o.slice().forEach(function (fn) { fn(); }); }
      };
    }
    var a = side(), b = side();
    a.peer = b; b.peer = a;
    return [a, b];
  }

  BQ5.lan = {
    supported: supported,
    host: host,
    join: join,
    loopbackPair: loopbackPair,
    // expostos para teste
    _encodeCode: encodeCode,
    _decodeCode: decodeCode
  };
})(globalThis);
