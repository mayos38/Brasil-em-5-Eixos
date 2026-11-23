/* ============================================================
 * Brasil em 5 Eixos — leitor local de QR Code (js/multiplayer/qr-reader.js)
 *
 * Duas formas de ler, ambas 100% locais (nenhum dado sai do aparelho):
 *   1) câmera ao vivo  -> exige HTTPS ou localhost (regra dos navegadores)
 *   2) foto/imagem     -> funciona até em HTTP; abre a câmera ou a galeria
 *
 * Motor de decodificação:
 *   - BarcodeDetector nativo, quando o navegador oferece (Chrome/Android);
 *   - senão, jsQR (MIT) carregado SOB DEMANDA de js/vendor/jsQR.min.js.
 *     O arquivo só é baixado/executado quando o jogador toca em ler QR,
 *     então não pesa na abertura do jogo.
 *
 * Cuidados com memória: um único canvas de amostragem é reutilizado e
 * liberado ao fechar; fotos grandes são reduzidas antes de decodificar;
 * a câmera é desligada ao fechar ou ao sair da aba.
 *
 * API (BQ5.qrReader):
 *   liveSupported()                  -> câmera ao vivo possível neste contexto?
 *   startLive({video,onText,onStatus}) -> { ready:Promise, stop() }
 *       onText(texto) pode retornar true (aceito: encerra), string (mensagem
 *       e continua) ou Promise dos dois.
 *   decodeFile(file)                 -> Promise<string> (rejeita com .code)
 *   release()                        -> libera canvas/memória
 * ============================================================ */
(function (global) {
  'use strict';

  var BQ5 = global.BQ5 = global.BQ5 || {};

  var VENDOR_SRC = 'js/vendor/jsQR.min.js';
  var LIVE_SAMPLE_MAX = 800;          // maior lado da amostra analisada ao vivo (px)
  var FILE_SIZES = [1600, 1000, 2400]; // tentativas para fotos (maior lado, px)
  var SCAN_INTERVAL_MS = 280;         // pausa entre análises (não é loop contínuo)

  var sampleCanvas = null;
  var nativePromise = null;
  var jsqrPromise = null;
  var loadAttempts = 0;
  var lastIssue = '';

  function fail(code, message) {
    var error = new Error(message || code);
    error.code = code;
    return error;
  }

  // ---------- suporte ----------

  function liveSupported() {
    return !!(global.isSecureContext && global.navigator && global.navigator.mediaDevices &&
      typeof global.navigator.mediaDevices.getUserMedia === 'function');
  }

  // ---------- motores ----------

  function getNative() {
    if (nativePromise) return nativePromise;
    var Detector = global.BarcodeDetector;
    if (!Detector) { nativePromise = Promise.resolve(null); return nativePromise; }
    var formats = typeof Detector.getSupportedFormats === 'function'
      ? Detector.getSupportedFormats() : Promise.resolve(['qr_code']);
    nativePromise = Promise.resolve(formats).then(function (list) {
      return list.indexOf('qr_code') === -1 ? null : new Detector({ formats: ['qr_code'] });
    }, function () { return null; });
    return nativePromise;
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var doc = global.document;
      var tag = doc.createElement('script');
      var scriptError = '';
      function onWindowError(event) { // erro de execução/sintaxe dentro do jsQR
        if (event && event.filename && String(event.filename).indexOf('jsQR') !== -1) scriptError = String(event.message || 'erro de script');
      }
      if (global.addEventListener) global.addEventListener('error', onWindowError);
      function cleanup() { if (global.removeEventListener) global.removeEventListener('error', onWindowError); }
      tag.src = src;
      tag.async = true;
      tag.onload = function () { cleanup(); resolve(scriptError); };
      tag.onerror = function () {
        cleanup();
        if (tag.parentNode) tag.parentNode.removeChild(tag);
        reject(fail('NO_ENGINE', 'arquivo não carregou (404, bloqueio ou cache): ' + src));
      };
      doc.head.appendChild(tag);
    });
  }

  function pickJsQr() {
    var fn = global.jsQR;
    if (fn && typeof fn !== 'function' && typeof fn.default === 'function') fn = fn.default; // alguns builds exportam { default }
    return typeof fn === 'function' ? fn : null;
  }

  // Resolve com a função jsQR, ou null se não foi possível (motivo em lastIssue).
  function getJsQr() {
    var ready = pickJsQr();
    if (ready) return Promise.resolve(ready);
    if (jsqrPromise) return jsqrPromise;
    // Da segunda tentativa em diante, ignora cache do navegador (ex.: 404 guardado).
    var src = VENDOR_SRC + (loadAttempts++ > 0 ? '?r=' + Date.now() : '');
    jsqrPromise = loadScript(src).then(function (scriptError) {
      var fn = pickJsQr();
      if (fn) { lastIssue = ''; return fn; }
      lastIssue = scriptError
        ? 'o arquivo carregou mas deu erro: ' + scriptError + ' (navegador antigo ou arquivo errado)'
        : 'o arquivo carregou mas não definiu jsQR (confirme que é dist/jsQR.js e não uma página de erro)';
      jsqrPromise = null;
      return null;
    }, function (error) {
      lastIssue = error && error.message ? error.message : 'falha ao carregar';
      jsqrPromise = null; // permite tentar de novo depois
      return null;
    });
    return jsqrPromise;
  }

  function runJsQr(fn, canvas) {
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    var image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var result = fn(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });
    image = null;
    return result && result.data ? String(result.data) : '';
  }

  // Decodifica o canvas de amostragem. useFallback: se o motor nativo não achar
  // nada, tenta também o jsQR (usado em fotos; ao vivo seria custo em dobro).
  function decodeCanvas(canvas, useFallback) {
    return getNative().then(function (detector) {
      if (!detector) return '';
      return detector.detect(canvas).then(function (codes) {
        return codes && codes.length ? String(codes[0].rawValue || '') : '';
      }, function () { return ''; });
    }).then(function (text) {
      if (text) return text;
      return getNative().then(function (detector) {
        if (detector && !useFallback) return '';
        return getJsQr().then(function (fn) {
          if (!fn) {
            if (!detector) throw fail('NO_ENGINE', 'Nenhum leitor de QR disponível');
            return '';
          }
          return runJsQr(fn, canvas);
        });
      });
    });
  }

  // ---------- canvas de amostragem (reutilizado) ----------

  function getCanvas(width, height) {
    if (!sampleCanvas) sampleCanvas = global.document.createElement('canvas');
    if (sampleCanvas.width !== width) sampleCanvas.width = width;
    if (sampleCanvas.height !== height) sampleCanvas.height = height;
    return sampleCanvas;
  }

  function release() {
    if (sampleCanvas) { sampleCanvas.width = 0; sampleCanvas.height = 0; }
    sampleCanvas = null;
  }

  function fitSize(w, h, maxSide) {
    var ratio = Math.min(1, maxSide / Math.max(w, h));
    return { w: Math.max(1, Math.round(w * ratio)), h: Math.max(1, Math.round(h * ratio)) };
  }

  // ---------- câmera ao vivo ----------

  function startLive(options) {
    var video = options.video;
    var onText = options.onText;
    var onStatus = options.onStatus || function () {};
    var state = { active: true, busy: false, timer: null, stream: null };
    var lastText = '';

    function stop() {
      state.active = false;
      if (state.timer != null) global.clearTimeout(state.timer);
      state.timer = null;
      if (state.stream) {
        state.stream.getTracks().forEach(function (track) { try { track.stop(); } catch (e) { /* ignora */ } });
      }
      state.stream = null;
      if (video) {
        try { video.pause(); } catch (e2) { /* ignora */ }
        video.srcObject = null;
      }
      release();
    }

    function schedule() {
      if (!state.active || state.timer != null) return;
      state.timer = global.setTimeout(tick, SCAN_INTERVAL_MS);
    }

    function tick() {
      state.timer = null;
      if (!state.active || state.busy) return;
      if (global.document && global.document.hidden) { schedule(); return; }
      if (!video || video.readyState < 2 || !video.videoWidth) { schedule(); return; }
      state.busy = true;
      var size = fitSize(video.videoWidth, video.videoHeight, LIVE_SAMPLE_MAX);
      var canvas = getCanvas(size.w, size.h);
      canvas.getContext('2d', { willReadFrequently: true }).drawImage(video, 0, 0, size.w, size.h);
      decodeCanvas(canvas, false).then(function (text) {
        if (!state.active || !text || text === lastText) return null;
        lastText = text;
        return onText(text);
      }).then(function (answer) {
        if (!state.active) return;
        if (answer === true) { stop(); return; }
        if (typeof answer === 'string') { onStatus(answer); lastText = ''; }
        state.busy = false;
        schedule();
      }, function (error) {
        state.busy = false;
        if (state.active && error && error.code === 'NO_ENGINE') {
          stop();
          if (typeof options.onError === 'function') options.onError(error);
          return;
        }
        schedule();
      });
    }

    var ready = Promise.resolve().then(function () {
      if (!liveSupported()) throw fail('NO_CAMERA', 'Câmera indisponível neste contexto');
      // Garante que há motor ANTES de acender a câmera.
      return getNative().then(function (detector) {
        return detector ? true : getJsQr().then(function (fn) {
          if (!fn) throw fail('NO_ENGINE', 'Nenhum leitor de QR disponível');
          return true;
        });
      });
    }).then(function () {
      return global.navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 15, max: 20 } }
      });
    }).then(function (stream) {
      if (!state.active) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
      state.stream = stream;
      // Foco contínuo, quando o aparelho permite (ajuda muito em QR denso).
      try {
        var track = stream.getVideoTracks()[0];
        if (track && typeof track.applyConstraints === 'function') {
          track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(function () { /* ignora */ });
        }
      } catch (e) { /* ignora */ }
      video.srcObject = stream;
      return Promise.resolve(video.play()).then(function () {
        if (!state.active) return;
        onStatus('Aponte a câmera para o QR Code do outro aparelho.');
        schedule();
      });
    });

    return { ready: ready, stop: stop };
  }

  // ---------- foto / imagem ----------

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = global.URL.createObjectURL(file);
      var img = new global.Image();
      var done = function (ok, value) {
        global.URL.revokeObjectURL(url);
        if (ok) resolve(value); else reject(value);
      };
      img.onload = function () { done(true, img); };
      img.onerror = function () { done(false, fail('BAD_IMAGE', 'Imagem inválida')); };
      img.src = url;
    });
  }

  function decodeFile(file) {
    if (!file) return Promise.reject(fail('BAD_IMAGE', 'Nenhuma imagem'));
    return loadImage(file).then(function (img) {
      var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
      var index = 0, tried = {};
      function attempt() {
        if (index >= FILE_SIZES.length) return Promise.resolve('');
        var size = fitSize(w, h, FILE_SIZES[index++]);
        var key = size.w + 'x' + size.h;
        if (tried[key]) return attempt(); // foto pequena: não repete o mesmo tamanho
        tried[key] = true;
        var canvas = getCanvas(size.w, size.h);
        canvas.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, size.w, size.h);
        return decodeCanvas(canvas, true).then(function (text) {
          if (text) return text;
          // respira entre tentativas para a interface não travar
          return new Promise(function (resolve) { global.setTimeout(resolve, 0); }).then(attempt);
        });
      }
      return attempt().then(function (text) {
        img.src = ''; // solta a imagem decodificada (pode ter dezenas de MB)
        release();
        if (!text) throw fail('NOT_FOUND', 'Nenhum QR Code encontrado na imagem');
        return text;
      }, function (error) {
        img.src = '';
        release();
        throw error;
      });
    });
  }

  BQ5.qrReader = {
    liveSupported: liveSupported,
    startLive: startLive,
    decodeFile: decodeFile,
    release: release,
    lastIssue: function () { return lastIssue; }
  };
})(globalThis);
