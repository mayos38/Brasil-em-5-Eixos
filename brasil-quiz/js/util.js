/* ============================================================
 * brasil-quiz v0.2 modular — js/util.js
 * Responsabilidade: utilitários puros e de baixo nível usados pelos demais módulos:
 *   - embaralhamento (Fisher-Yates), escape de HTML;
 *   - sons curtos via WebAudio (sem áudio => no-op silencioso);
 *   - cópia para área de transferência com fallback offline;
 *   - atalho $ = document.querySelector.
 * Não conhece regras do jogo, nem storage. Carregar depois de config.js.
 * ============================================================ */
(function () {
  'use strict';

  const U = {};

  // Embaralha e devolve uma CÓPIA (não muta o array original).
  U.shuffle = function (a) {
    const arr = (a || []).slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  };

  // Escapa caracteres especiais de HTML para inserção segura em templates.
  U.esc = function (s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  };

  // Delay com fallback para ambientes sem setTimeout (ex.: suíte de testes).
  U.delay = function (fn, ms) {
    if (typeof setTimeout === 'function') return setTimeout(fn, ms);
    fn();
    return null;
  };

  let AC = null;
  function audioCtx() {
    const Ctor = (typeof AudioContext !== 'undefined') ? AudioContext : (typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null);
    if (!Ctor) return null;
    try {
      AC = AC || new Ctor();
      if (AC.state === 'suspended') { try { AC.resume(); } catch (e) {} }
      return AC;
    } catch (e) { return null; }
  }

  // Bipe curto. Retorna false sem lançar erro quando não há áudio disponível.
  U.beep = function (freq, dur, type, gain) {
    const ac = audioCtx();
    if (!ac) return false;
    try {
      const o = ac.createOscillator(), g = ac.createGain();
      const d = dur || 0.12;
      o.type = type || 'sine';
      o.frequency.value = freq;
      g.gain.value = gain || 0.15;
      o.connect(g); g.connect(ac.destination);
      o.start();
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + d);
      o.stop(ac.currentTime + d + 0.02);
    } catch (e) { return false; }
    return true;
  };

  // Feedback sonoro de acerto/erro.
  U.soundGood = function () { U.beep(660, .12); U.delay(function () { U.beep(880, .15); }, 90); };
  U.soundBad = function () { U.beep(200, .2, 'sawtooth', .12); };

  // Copia texto para a área de transferência. Retorna true se a cópia foi aceita.
  // Tenta a API moderna; em falha/ausência usa textarea + execCommand (funciona offline).
  U.copyText = function (text) {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        const p = navigator.clipboard.writeText(text);
        if (p && typeof p.then === 'function') p.then(function () {}, function () {});
        return true; // chamada aceita pela API do navegador
      }
    } catch (e) { /* cai no fallback abaixo */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      let ok = false;
      if (typeof document.execCommand === 'function') { try { ok = document.execCommand('copy'); } catch (e) {} }
      if (ta.parentNode) ta.parentNode.removeChild(ta);
      return !!ok;
    } catch (e) { return false; }
  };

  // Atalho de consulta DOM.
  U.$ = function (s) { return document.querySelector(s); };

  globalThis.BQ5 = globalThis.BQ5 || {};
  BQ5.util = U;
})();
