/* Prévia visual temporária do menu.
 * Uso: abrir brasil-quiz/index.html?preview=menu por servidor local.
 * Este arquivo não carrega banco nem inicia uma partida; será removido no Módulo 15.
 */
(function (global) {
  'use strict';
  if (!global.location || typeof global.location.search !== 'string') return;
  var match = /(?:^|[?&])preview=([^&]+)/.exec(global.location.search);
  if (!match || decodeURIComponent(match[1]) !== 'menu') return;
  if (global.BQ5 && BQ5.screens && BQ5.screens.menu && typeof BQ5.screens.menu.show === 'function') {
    BQ5.screens.menu.show();
  }
})(globalThis);
