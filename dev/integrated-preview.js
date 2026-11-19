/* ============================================================
 * Brasil em 5 Eixos — M15 INTERMEDIÁRIO · preview integrado (DEV)
 *
 * Carrega a interface real de brasil-quiz/index.html, injeta o corpo,
 * executa os scripts src em ordem e então carrega o banco oficial.
 * Inclui a verificação do M12; M13/M14 e o M15 final continuam pendentes.
 * Não duplica regras do motor, questões, cronômetro ou persistência.
 * Não existe pausa.
 * ============================================================ */
(function (global) {
  'use strict';
  if (!global.document || global.__BQ5_IP_BOOTED__) return;
  global.__BQ5_IP_BOOTED__ = true;

  var doc = global.document;
  var SHELL_URL = '../brasil-quiz/index.html';
  var BANK_URL = '../brasil-quiz/data/questions.json';
  var loader = doc.getElementById('dev-loader');
  var booting = false;

  function log(message) {
    if (global.console && typeof global.console.info === 'function') global.console.info('[M15 preview] ' + message);
  }
  function errorLog(message) {
    if (global.console && typeof global.console.error === 'function') global.console.error('[M15 preview] ' + message);
  }
  function el(id) { return doc.getElementById(id); }
  function textNode(tag, value) {
    var node = doc.createElement(tag);
    node.textContent = String(value == null ? '' : value);
    return node;
  }
  function clear(node) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
  }
  function fatal(errors) {
    errors = Array.isArray(errors) && errors.length ? errors : ['Falha desconhecida.'];
    errorLog(errors.join(' | '));
    if (!loader) return;
    clear(loader);
    loader.className = 'bq5ip-loader bq5ip-loader--error';
    loader.appendChild(textNode('h1', 'Não foi possível carregar o preview integrado'));
    loader.appendChild(textNode('p', 'A interface e o banco são carregados por fetch(). Execute o projeto por um servidor HTTP local, não por file://.'));
    var list = doc.createElement('ul');
    errors.forEach(function (message) { list.appendChild(textNode('li', message)); });
    loader.appendChild(list);
    loader.appendChild(textNode('p', 'Na raiz do projeto, execute: python -m http.server 8000. Depois abra http://localhost:8000/dev/integrated-preview.html.'));
    loader.style.display = '';
  }

  function fetchShell() {
    if (typeof global.fetch !== 'function') return Promise.reject(new Error('fetch() não está disponível neste navegador.'));
    return global.fetch(SHELL_URL).then(function (response) {
      if (!response || !response.ok) throw new Error('Falha HTTP ao buscar index.html (status ' + (response ? response.status : 'desconhecido') + ').');
      return response.text();
    });
  }

  function injectShell(html) {
    var parsed;
    try { parsed = new global.DOMParser().parseFromString(String(html), 'text/html'); }
    catch (error) { throw new Error('Não foi possível interpretar brasil-quiz/index.html: ' + error.message); }
    if (!parsed.body || !parsed.body.childNodes) throw new Error('A interface real não possui um body válido.');

    var nodes = [];
    for (var i = 0; i < parsed.body.childNodes.length; i++) nodes.push(parsed.body.childNodes[i]);
    var scripts = [];
    nodes.forEach(function (node) {
      if (!node || node.nodeType !== 1) return;
      if (/^script$/i.test(node.nodeName)) {
        if (String(node.textContent || '').replace(/\s/g, '')) throw new Error('O preview aceita apenas scripts externos <script src>, não scripts inline.');
        var src = node.getAttribute('src');
        if (src && src.trim()) scripts.push(src.trim());
      } else if (!/^noscript$/i.test(node.nodeName)) {
        doc.body.appendChild(node);
      }
    });
    if (parsed.title) doc.title = parsed.title;
    if (loader) loader.style.display = 'none';
    return scripts;
  }

  function resolveSrc(src) {
    src = String(src).trim();
    return src.indexOf('js/') === 0 ? '../brasil-quiz/' + src : src;
  }

  function loadScripts(scripts) {
    var chain = Promise.resolve();
    scripts.forEach(function (src) {
      chain = chain.then(function () {
        return new Promise(function (resolve, reject) {
          var script = doc.createElement('script');
          script.src = resolveSrc(src);
          script.onload = function () { resolve(true); };
          script.onerror = function () { reject(new Error('Falha ao carregar ' + script.src)); };
          (doc.head || doc.body).appendChild(script);
        });
      });
    });
    return chain;
  }

  function setBoot(state, details) {
    var screen = el('screen-boot');
    if (!screen) return;
    screen.setAttribute('data-state', state);
    var list = el('boot-error-details');
    if (list) {
      clear(list);
      (Array.isArray(details) ? details : details ? [details] : []).forEach(function (item) {
        list.appendChild(textNode('li', item));
      });
    }
  }

  function addImportControl() {
    var block = el('boot-error');
    if (!block || block.querySelector('.bq5ip-import')) return;
    var wrap = doc.createElement('div');
    wrap.className = 'bq5ip-import';
    wrap.style.margin = '10px 0';
    wrap.appendChild(textNode('p', 'Alternativa: importe manualmente o arquivo data/questions.json.'));
    var input = doc.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    var button = textNode('button', 'Importar banco JSON');
    button.type = 'button';
    button.className = 'bq5-btn bq5-btn--secondary';
    button.addEventListener('click', function () {
      var file = input.files && input.files[0];
      if (!file) { global.BQ5.ui.toast('Selecione o arquivo questions.json.', 'error'); return; }
      var reader = new global.FileReader();
      reader.onload = function () {
        var result = global.BQ5.bank.fromText(String(reader.result));
        if (result && result.ok) {
          var shown = global.BQ5.screens.menu.show();
          if (!shown || !shown.ok) setBoot('error', ['Banco importado, mas o menu não pôde ser exibido.']);
        } else setBoot('error', result && result.errors ? result.errors : ['Falha ao importar questions.json.']);
      };
      reader.onerror = function () { setBoot('error', ['Não foi possível ler o arquivo selecionado.']); };
      reader.readAsText(file);
    });
    wrap.appendChild(input);
    wrap.appendChild(button);
    var retry = el('boot-retry');
    block.insertBefore(wrap, retry || null);
  }

  function showBootError(details) {
    setBoot('error', details);
    addImportControl();
  }

  function missingModules() {
    var missing = [];
    var bq = global.BQ5;
    if (!bq) return ['BQ5: os módulos não foram carregados.'];
    ['config', 'util', 'storage', 'bank', 'engine', 'ui'].forEach(function (name) {
      if (!bq[name]) missing.push('BQ5.' + name);
    });
    var screens = bq.screens || {};
    ['menu', 'setup', 'play', 'results', 'campaign'].forEach(function (name) {
      if (!screens[name]) missing.push('BQ5.screens.' + name);
    });
    return missing;
  }

  function bindRetry() {
    var api = global.BQ5 && global.BQ5.ui;
    if (!api || typeof api.onAction !== 'function') return;
    if (typeof api.hasListeners === 'function' && api.hasListeners('action:retry-boot')) return;
    api.onAction('retry-boot', loadBank);
  }

  function loadBank() {
    var api = global.BQ5 && global.BQ5.bank;
    if (!api || typeof api.load !== 'function') { showBootError(['BQ5.bank.load() não está disponível.']); return; }
    if (booting) return;
    booting = true;
    setBoot('loading');
    log('Carregando banco oficial: ' + BANK_URL);
    var request;
    try { request = api.load(BANK_URL); }
    catch (error) {
      booting = false;
      showBootError(['Erro ao chamar bank.load(): ' + error.message]);
      return;
    }
    if (!request || typeof request.then !== 'function') {
      booting = false;
      showBootError(['bank.load() não retornou uma Promise.']);
      return;
    }
    request.then(function (result) {
      booting = false;
      if (result && result.ok) {
        log('Banco carregado: ' + result.count + ' questões.');
        var shown = global.BQ5.screens.menu.show();
        if (!shown || !shown.ok) showBootError(['O banco carregou, mas o menu não pôde ser exibido.']);
      } else {
        var details = [];
        if (result && result.code) details.push('Código: ' + result.code);
        if (result && Array.isArray(result.errors)) details = details.concat(result.errors);
        showBootError(details.length ? details : ['Não foi possível carregar o banco oficial.']);
      }
    }, function (error) {
      booting = false;
      showBootError(['Erro inesperado ao carregar o banco: ' + error.message]);
    });
  }

  function boot() {
    var missing = missingModules();
    if (missing.length) { showBootError(['Módulo(s) ausente(s): ' + missing.join(', ')]); return; }
    bindRetry();
    loadBank();
  }

  global.__BQ5_IP__ = { loadBank: loadBank, setBoot: setBoot, resolveSrc: resolveSrc, boot: boot };
  log('Iniciando preview integrado M1–M12.');
  fetchShell().then(function (html) {
    var scripts = injectShell(html);
    log('Interface injetada; carregando ' + scripts.length + ' scripts na ordem declarada.');
    return loadScripts(scripts);
  }).then(function () {
    boot();
  }).catch(function (error) {
    fatal([String(error && error.message || error)]);
  });
})(globalThis);
