/* ============================================================
 * Brasil em 5 Eixos — M15 INTERMEDIÁRIO · preview integrado (DEV)
 * Arquivo : dev/integrated-preview.js   |   Carregado por: dev/integrated-preview.html
 *
 * Responsabilidade (bootstrap provisório do Módulo 15, apenas para testes):
 *   1. Busca a interface REAL (brasil-quiz/index.html) via fetch — sem cópias;
 *   2. Injeta o conteúdo real no documento (body E links do head, ex.: Google
 *      Fonts) e executa os módulos reais na ordem declarada em index.html
 *   3. Tela boot: data-state="loading" durante a carga do banco;
 *   4. Carrega o banco REAL data/questions.json via BQ5.bank.load();
 *   5. Sucesso -> BQ5.screens.menu.show() (menu aparece automaticamente);
 *      Falha   -> #screen-boot[data-state="error"] com detalhes, ação retry-boot
 *                 e importação manual opcional via BQ5.bank.fromText.
 *
 * Carrega TODOS os <script src> declarados em index.html — incluindo o módulo 12
 * (js/campaign.js + js/screens/campaign.js) quando estão ativos.
 * NÃO reimplementa motor, regras, pontuação, cronômetro, telas ou persistência.
 * Sem pausa (não existe no projeto). Sem async/await.
 * ============================================================ */
(function (global) {
  'use strict';

  if (!global.document || global.__BQ5_IP_BOOTED__) return; // evita inicialização duplicada
  global.__BQ5_IP_BOOTED__ = true;

  var doc = global.document;
  var SHELL_URL = '../brasil-quiz/index.html';
  var BANK_URL = '../brasil-quiz/data/questions.json';

  function log(msg) { if (global.console && typeof global.console.info === 'function') global.console.info('[M15 preview] ' + msg); }
  function failLog(msg) { if (global.console && typeof global.console.error === 'function') global.console.error('[M15 preview] ' + msg); }

  function el(id) { try { return doc.getElementById ? doc.getElementById(id) : null; } catch (e) { return null; } }
  function clearNode(node) { if (!node || typeof node.removeChild !== 'function') return; while (node.firstChild) node.removeChild(node.firstChild); }
  function makeText(tag, text) { var n = doc.createElement(tag); try { n.textContent = String(text == null ? '' : text); } catch (e) {} return n; }

  // ---------- loader próprio (antes da interface real existir / em falha fatal) ----------
  var loaderEl = el('dev-loader');

  function setLoaderFatal(res) {
    failLog((res && res.errors ? res.errors.join(' | ') : 'falha desconhecida'));
    if (!loaderEl) return;
    try {
      clearNode(loaderEl);
      loaderEl.className = 'bq5ip-loader bq5ip-loader--error';
      if (loaderEl.style) loaderEl.style.display = '';
      var errors = (res && Array.isArray(res.errors)) ? res.errors : ['erro desconhecido'];
      loaderEl.appendChild(makeText('h1', 'Não foi possível carregar o preview integrado'));
      loaderEl.appendChild(makeText('p', 'O preview depende de um servidor HTTP local: a interface real e o banco oficial são carregados via fetch().'));
      var ul = doc.createElement('ul');
      for (var i = 0; i < errors.length; i++) ul.appendChild(makeText('li', errors[i]));
      loaderEl.appendChild(ul);
      loaderEl.appendChild(makeText('p', 'Como executar: na raiz do projeto (a pasta que contém brasil-quiz/ e dev/) rode  python -m http.server 8000  e abra  http://localhost:8000/dev/integrated-preview.html'));
    } catch (e) { failLog('setLoaderFatal: ' + String((e && e.message) || e)); }
  }

  // ---------- 1. carga da interface real ----------
  function fetchShell() {
    if (typeof global.fetch !== 'function') {
      return Promise.resolve({ ok: false, code: 'NO_FETCH', errors: ['fetch() não está disponível neste navegador/contexto.'] });
    }
    var p;
    // cache:'no-store': o preview deve SEMPRE refletir o index.html atual em disco.
    // Sem isso, um HTML antigo em cache do navegador (ex.: sem as tags <script>
    // do módulo 12) impede que novos módulos carreguem no preview.
    try { p = global.fetch(SHELL_URL, { cache: 'no-store' }); } catch (e) {
      return Promise.resolve({ ok: false, code: 'FETCH', errors: [String((e && e.message) || e)] });
    }
    if (!p || typeof p.then !== 'function') return Promise.resolve({ ok: false, code: 'FETCH', errors: ['fetch() não retornou uma Promise'] });
    return p.then(function (r) {
      var status = r && typeof r.status === 'number' ? r.status : 0;
      if (!r || !r.ok) return { ok: false, code: 'HTTP', status: status, errors: ['falha HTTP ao carregar a interface real (status ' + status + ')'] };
      return r.text().then(function (txt) { return { ok: true, html: txt }; }, function (e) {
        return { ok: false, code: 'READ', errors: ['não foi possível ler o texto da resposta: ' + String((e && e.message) || e)] };
      });
    }, function (e) {
      return { ok: false, code: 'FETCH', errors: [String((e && e.message) || e)] };
    });
  }

  function injectShell(html) {
    var parsed;
    try { parsed = new global.DOMParser().parseFromString(String(html), 'text/html'); }
    catch (e) { return { ok: false, errors: ['falha ao interpretar o HTML da interface real: ' + String((e && e.message) || e)] }; }
    var pBody = parsed && parsed.body;
    if (!pBody || !pBody.childNodes) return { ok: false, errors: ['interface real sem <body> reconhecível'] };

    // snapshot primeiro (a lista childNodes é viva — mover durante a iteração saltaria nós)
    var total = pBody.childNodes.length;
    var nodes = [];
    for (var i = 0; i < total; i++) nodes.push(pBody.childNodes[i]);

    var scripts = [];
    for (var j = 0; j < nodes.length; j++) {
      var node = nodes[j];
      if (!node || node.nodeType !== 1) continue; // texto/comentários não são necessários
      if (/^script$/i.test(node.nodeName)) {
        var inline = typeof node.textContent === 'string' ? node.textContent.replace(/\s/g, '') : '';
        if (inline) return { ok: false, errors: ['script inline encontrado em index.html — este preview só suporta <script src>'] };
        var srcAttr = null;
        try { srcAttr = node.getAttribute('src'); } catch (e2) {}
        if (srcAttr && String(srcAttr).trim()) scripts.push(String(srcAttr).trim()); // ordem original preservada
      } else if (/^noscript$/i.test(node.nodeName)) {
        continue; // a página dev já tem o próprio <noscript>
      } else {
        try { doc.body.appendChild(node); } catch (e3) {} // move para o documento vivo
      }
    }

    // Alpha #4: os links do <head> da interface real também precisam chegar à
    // página de preview — sem isso, as fontes Google Fonts (Pixelify Sans +
    // Silkscreen) só funcionariam abrindo o index.html diretamente.
    var pHead = parsed && parsed.head;
    if (pHead && pHead.childNodes) {
      // Dedupe por URL ABSOLUTA: o index.html declara 'css/style.css' (relativo
      // a /brasil-quiz/) e esta página já liga '../brasil-quiz/css/style.css';
      // comparar strings cruas injetaria um <link> quebrado (/dev/css/…).
      function absHref(h) {
        if (!h) return h;
        try { if (global.URL && doc.baseURI) return new global.URL(String(h), doc.baseURI).href; } catch (e10) {}
        return String(h);
      }
      var existing = {};
      var docLinks = (doc.querySelectorAll ? doc.querySelectorAll('link') : []);
      for (var k = 0; k < docLinks.length; k++) {
        var eh = null; try { eh = docLinks[k].getAttribute('href'); } catch (e6) {}
        if (eh) existing[absHref(eh)] = true;
      }
      var totalL = pHead.childNodes.length;
      for (var m = 0; m < totalL; m++) {
        var ln = pHead.childNodes[m];
        if (!ln || ln.nodeType !== 1 || !/^link$/i.test(ln.nodeName)) continue;
        var href = null, rel = '';
        try { href = ln.getAttribute('href'); rel = String(ln.getAttribute('rel') || ''); } catch (e7) {}
        var tokens = rel.split(/\s+/);
        var hrefKey = absHref(href);
        if (!href || existing[hrefKey] || (tokens.indexOf('stylesheet') === -1 && tokens.indexOf('preconnect') === -1)) continue;
        // dedupe: ex.: style.css já é carregado pela própria página de preview
        var copy = doc.createElement('link');
        for (var a = 0; a < ln.attributes.length; a++) {
          var attr = ln.attributes[a];
          try { copy.setAttribute(attr.name, attr.value); } catch (e8) {}
        }
        (doc.head || doc.body).appendChild(copy);
        existing[hrefKey] = true;
      }
    }

    if (parsed && parsed.title && typeof doc.title !== 'undefined') { try { doc.title = String(parsed.title); } catch (e4) {} }
    if (loaderEl && loaderEl.style) { try { loaderEl.style.display = 'none'; } catch (e5) {} }
    return { ok: true, scripts: scripts };
  }

  // ---------- 2. módulos reais na ordem de dependência ----------
  function resolveSrc(src) {
    var s = String(src).trim();
    if (s.indexOf('js/') === 0) return '../brasil-quiz/' + s; // js/config.js -> ../brasil-quiz/js/config.js
    return s; // ex.: '../dev/ui-preview.js' já resolve corretamente a partir de dev/
  }

  function loadScripts(scripts) {
    var chain = Promise.resolve();
    for (var i = 0; i < scripts.length; i++) {
      (function (src) {
        chain = chain.then(function () {
          return new Promise(function (resolve, reject) {
            try {
              var s = doc.createElement('script');
              s.src = src;
              s.onload = function () { resolve(true); };
              s.onerror = function () { reject(new Error('falha ao carregar o script ' + src)); };
              (doc.head || doc.body).appendChild(s);
            } catch (e) { reject(e); }
          });
        });
      })(resolveSrc(scripts[i])); // carregamento sequencial => ordem de dependência garantida
    }
    return chain;
  }

  // ---------- 3. bootstrap M15 intermediário: boot -> banco real -> menu ----------
  var booting = false;

  function missingModules() {
    var missing = [];
    if (!global.BQ5) return ['BQ5 (nenhum módulo foi carregado)'];
    var bases = ['config', 'util', 'storage', 'bank', 'engine', 'ui'];
    for (var i = 0; i < bases.length; i++) if (!global.BQ5[bases[i]]) missing.push('BQ5.' + bases[i]);
    var screens = global.BQ5.screens || {};
    var names = ['menu', 'setup', 'play', 'results'];
    for (var j = 0; j < names.length; j++) if (!screens[names[j]]) missing.push('BQ5.screens.' + names[j]);
    return missing;
  }

  function setBoot(state, details) {
    var screen = el('screen-boot');
    if (!screen || typeof screen.setAttribute !== 'function') return false;
    try { screen.setAttribute('data-state', state); } catch (e) { return false; }
    var list = el('boot-error-details'); // contrato: um <li> por detalhe, via textContent
    if (list && typeof list.appendChild === 'function') {
      clearNode(list);
      var items = Array.isArray(details) ? details : [String(details == null ? 'erro desconhecido' : details)];
      for (var i = 0; i < items.length; i++) list.appendChild(makeText('li', items[i]));
    }
    return true;
  }

  function addImportControl() {
    var errBlock = el('boot-error');
    if (!errBlock || typeof errBlock.appendChild !== 'function') return;
    try { // remove controles antigos => sem listeners duplicados
      var old = errBlock.querySelectorAll ? errBlock.querySelectorAll('.bq5ip-import') : [];
      for (var i = 0; i < old.length; i++) if (old[i] && old[i].parentNode === errBlock) errBlock.removeChild(old[i]);
    } catch (e) {}
    var retryBtn = el('boot-retry');
    var wrap = doc.createElement('div');
    wrap.className = 'bq5ip-import';
    try { wrap.style.margin = '10px 0'; } catch (e) {}
    var label = makeText('span', 'Alternativa se o JSON não foi encontrado: importar manualmente via BQ5.bank.fromText — ');
    var input = doc.createElement('input');
    try { input.type = 'file'; input.accept = '.json,application/json'; } catch (e) {}
    var btn = makeText('button', 'Importar questions.json');
    try { btn.type = 'button'; } catch (e) {}
    wrap.appendChild(label); wrap.appendChild(input); wrap.appendChild(btn);
    if (typeof global.FileReader === 'function' && typeof input.addEventListener === 'function') {
      function doImport() {
        var file = input.files && input.files[0];
        if (!file) { global.BQ5.ui.toast('Selecione o arquivo questions.json primeiro.', 'error'); return; }
        log('importação manual via BQ5.bank.fromText…');
        var reader = new global.FileReader();
        reader.onload = function () {
          var res = global.BQ5.bank.fromText(String(reader.result));
          if (res && res.ok === true) {
            log('banco importado manualmente: ' + res.count + ' questões.');
            var shown = global.BQ5.screens.menu.show();
            if (!shown || shown.ok === false) showBootError(['falha ao exibir o menu real após a importação']);
          } else {
            showBootError(res && Array.isArray(res.errors) ? res.errors : ['importação manual falhou']);
          }
        };
        reader.onerror = function () { showBootError(['não foi possível ler o arquivo selecionado']); };
        try { reader.readAsText(file); } catch (e) { showBootError(['erro ao ler o arquivo: ' + String((e && e.message) || e)]); }
      }
      btn.addEventListener('click', doImport);
    } else {
      try { wrap.setAttribute('data-unavailable', 'true'); } catch (e) {}
    }
    if (typeof errBlock.insertBefore === 'function') errBlock.insertBefore(wrap, retryBtn || null);
    else errBlock.appendChild(wrap);
  }

  function showBootError(details) { setBoot('error', details); addImportControl(); }

  function bindRetry() {
    var ui = global.BQ5.ui;
    if (!ui || typeof ui.onAction !== 'function') return;
    if (typeof ui.hasListeners === 'function' && ui.hasListeners('action:retry-boot')) return; // evita listener duplicado
    ui.onAction('retry-boot', function () { log('nova tentativa de carga do banco…'); loadBank(); });
  }

  function loadBank() {
    var bank = global.BQ5 && global.BQ5.bank;
    if (!bank || typeof bank.load !== 'function') { showBootError(['BQ5.bank ausente ou sem load() — verifique a carga dos módulos.']); return; }
    if (booting) return; // evita dupla carga simultânea
    booting = true;
    setBoot('loading');
    log('carregando banco real: ' + BANK_URL);
    var p;
    try { p = bank.load(BANK_URL); } catch (e) {
      booting = false;
      showBootError(['erro ao invocar BQ5.bank.load(): ' + String((e && e.message) || e)]);
      return;
    }
    if (!p || typeof p.then !== 'function') {
      booting = false;
      showBootError(['BQ5.bank.load() não retornou uma Promise neste ambiente.']);
      return;
    }
    p.then(function (res) {
      booting = false; // load() sempre resolve com resultado estruturado
      if (res && res.ok === true) {
        log('banco carregado: ' + res.count + ' questões.');
        if (global.BQ5.ui && typeof global.BQ5.ui.toast === 'function' && res.warnings && res.warnings.length) {
          global.BQ5.ui.toast('Banco carregado com ' + res.warnings.length + ' aviso(es) de validação.', 'info');
        }
        // Requisito: o menu principal aparece automaticamente após a inicialização bem-sucedida.
        var shown = global.BQ5.screens.menu.show();
        if (!shown || shown.ok === false) showBootError(['falha ao exibir o menu real: código ' + (shown && shown.code || 'desconhecido')]);
      } else {
        var details = [];
        if (res && res.code) details.push('código de erro: ' + res.code + (res.status ? ' (HTTP ' + res.status + ')' : ''));
        if (res && Array.isArray(res.errors)) details = details.concat(res.errors);
        showBootError(details.length ? details : ['falha desconhecida ao carregar o banco']);
      }
    }, function (e) { // defensividade — load() não deve rejeitar
      booting = false;
      showBootError(['erro inesperado da Promise do banco: ' + String((e && e.message) || e)]);
    });
  }

  function boot() {
    var missing = missingModules();
    if (missing.length) { showBootError(['módulo(s) ausente(s): ' + missing.join(', ')]); return false; }
    bindRetry();
    log('bootstrap M15 (intermediário) pronto — carregando o banco real…');
    loadBank();
    return true;
  }

  // API exposta para testes/debug (o jogo em si não a usa).
  global.__BQ5_IP__ = { loadBank: loadBank, setBoot: setBoot, resolveSrc: resolveSrc, boot: boot };

  log('iniciando preview integrado…');
  fetchShell().then(function (res) {
    if (!res || !res.ok) { setLoaderFatal(res); return; }
    var inj = injectShell(res.html);
    if (!inj.ok) { setLoaderFatal({ errors: inj.errors }); return; }
    log('interface real injetada; carregando ' + inj.scripts.length + ' módulos na ordem de dependência…');
    loadScripts(inj.scripts).then(function () {
      log('módulos reais carregados. Executando bootstrap M15 (intermediário)…');
      boot();
    }, function (e) { setLoaderFatal({ errors: [String((e && e.message) || e)] }); });
  });
})(globalThis);
