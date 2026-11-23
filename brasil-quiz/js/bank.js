/* ============================================================
 * brasil-quiz v0.2 modular — js/bank.js  (MÓDULO 4)
 * Responsabilidade: camada de carregamento e validação do banco de questões.
 *
 * Fonte oficial dos dados: data/questions.json
 * Arquitetura (decisão estabelecida): o banco é INDEPENDENTE da lógica do jogo.
 *   - questions.json contém exclusivamente os dados;
 *   - bank.js carrega, valida, organiza e disponibiliza as questões;
 *   - engine.js usa BQ5.bank sem conhecer a origem física dos dados;
 *   - nenhuma pergunta é codificada neste arquivo (nem em nenhum módulo JS).
 *
 * ESQUEMA DE DADOS (contrato para edições manuais de questions.json):
 * {
 *   "version": 1,            // opcional — inteiro
 *   "source": "texto",      // opcional — origem do banco
 *   "count": 508,            // opcional (valor ilustrativo) — se presente, deve bater com o tamanho real; divergência => apenas aviso. Pode ser omitido: o total é sempre calculado de questions.length
 *   "questions": [           // OBRIGATÓRIO — array não vazio
 *     {
 *       "id": 0,             // OBRIGATÓRIO — inteiro único no banco
 *       "theme": "cultura",  // OBRIGATÓRIO — um dos BQ5.config.themes
 *       "region": "norte",   // OBRIGATÓRIO — uma das BQ5.config.regions
 *       "difficulty": 1,     // OBRIGATÓRIO — inteiro com chave em BQ5.config.pointsBase (1..4)
 *       "question": "texto", // OBRIGATÓRIO — string não vazia
 *       "options": ["a","b","c","d"],  // OBRIGATÓRIO — exatamente 4 strings não vazias e únicas
 *       "answer": 0,         // OBRIGATÓRIO — índice (0..3) da alternativa correta em options
 *       "explanation": ""    // opcional — string (vira '' quando ausente)
 *     }, ...
 *   ]
 * }
 * Nota: theme/region/difficulty são validados contra BQ5.config (fonte única de
 * constantes do domínio). Para criar um NOVO tema/região, atualize antes config.js.
 * Adicionar/remover/editar questões NÃO exige mudança em bank/engine/ui — desde
 * que o esquema acima seja respeitado. Quantidades nunca ficam fixas em código:
 * totais e distribuições são sempre calculados dinamicamente (stats()).
 *
 * INTERFACE ESTÁVEL DE CARREGAMENTO (a origem física pode mudar sem tocar no jogo):
 *   BQ5.bank.load(url)      -> Promise (fetch; para servidor local/remoto)
 *   BQ5.bank.fromText(txt)  -> síncrono (arquivo lido, import manual, asset empacotado)
 *   BQ5.bank.adopt(obj)     -> síncrono (objeto JSON já parseado)
 * Os três funilam para o mesmo estado interno; load() SEMPRE resolve com um
 * resultado estruturado {ok, code?, errors?, count?, stats?} — nunca rejeita.
 * Codes de erro: NO_FETCH | FETCH | HTTP | JSON | SCHEMA.
 *
 * Offline / file://: fetch() de arquivo externo pode ser bloqueado em file://.
 * A arquitetura não duplica o banco dentro do JS. Procedimento recomendado:
 *   1) na pasta raiz do projeto: python -m http.server (qualquer servidor HTTP local serve)
 *   2) abrir http://localhost:<porta>/brasil-quiz/index.html
 * Em contextos sem fetch (ex.: empacotamento mobile futuro), use fromText/adopt.
 *
 * Sem async/await (limitação do ambiente de teste). Carregar depois de config.js,
 * util.js e storage.js. Não toca DOM, timers ou rede além do fetch opcional em load().
 * ============================================================ */
(function () {
  'use strict';

  var _state = { loaded: false, data: null }; // data = { version, source, questions:[...] }

  function isInt(n) { return typeof n === 'number' && isFinite(n) && Math.floor(n) === n; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function allowedThemes()    { var c = BQ5.config || {}; return Array.isArray(c.themes) ? c.themes : []; }
  function allowedRegions()   { var c = BQ5.config || {}; return Array.isArray(c.regions) ? c.regions : []; }
  function allowedDifficulties() {
    var c = BQ5.config || {};
    if (c.pointsBase && typeof c.pointsBase === 'object') return Object.keys(c.pointsBase).map(Number);
    return [1, 2, 3];
  }

  // Validação PURA: não altera estado. Devolve {ok, errors, warnings, data}.
  function validateBank(raw) {
    var errors = [], warnings = [];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, errors: ['raiz do banco deve ser um objeto JSON'], warnings: [] };
    }

    var qs = raw.questions;
    if (!Array.isArray(qs)) {
      errors.push('campo "questions" ausente ou não é um array');
    } else if (qs.length === 0) {
      errors.push('"questions" está vazio');
    }

    var seenIds = {};
    if (Array.isArray(qs)) {
      for (var i = 0; i < qs.length; i++) {
        var q = qs[i];
        var label = 'questão[' + i + ']';
        if (!q || typeof q !== 'object') { errors.push(label + ': não é um objeto'); continue; }

        if (!isInt(q.id)) {
          errors.push(label + '.id: deve ser número inteiro');
        } else if (seenIds[q.id] != null) {
          errors.push(label + '.id: id ' + q.id + ' duplicado (já usado na questão[' + seenIds[q.id] + '])');
        } else {
          seenIds[q.id] = i;
        }

        if (typeof q.theme !== 'string' || allowedThemes().indexOf(q.theme) === -1)
          errors.push(label + '.theme: valor desconhecido (' + JSON.stringify(q.theme) + ')');
        if (typeof q.region !== 'string' || allowedRegions().indexOf(q.region) === -1)
          errors.push(label + '.region: valor desconhecido (' + JSON.stringify(q.region) + ')');
        if (!isInt(q.difficulty) || allowedDifficulties().indexOf(q.difficulty) === -1)
          errors.push(label + '.difficulty: deve ser inteiro com pontos definidos em config.pointsBase (achado ' + JSON.stringify(q.difficulty) + ')');

        if (typeof q.question !== 'string' || !q.question.trim())
          errors.push(label + '.question: texto ausente ou vazio');

        var opts = q.options;
        if (!Array.isArray(opts)) {
          errors.push(label + '.options: deve ser um array de exatamente 4 strings');
        } else {
          if (opts.length !== 4)
            errors.push(label + '.options: esperado exatamente 4 alternativas, achado ' + opts.length);
          var seenOpt = {};
          for (var k = 0; k < opts.length; k++) {
            var o = opts[k];
            if (typeof o !== 'string' || !o.trim()) { errors.push(label + '.options[' + k + ']: deve ser string não vazia'); continue; }
            if (seenOpt[o] != null) errors.push(label + '.options: alternativa duplicada ("' + o + '")');
            else seenOpt[o] = k;
          }
        }

        var nOpts = Array.isArray(opts) ? opts.length : 0;
        if (!isInt(q.answer) || q.answer < 0 || q.answer >= nOpts)
          errors.push(label + '.answer: índice inválido (' + JSON.stringify(q.answer) + ') para ' + nOpts + ' alternativas');

        if (q.explanation !== undefined && typeof q.explanation !== 'string')
          errors.push(label + '.explanation: deve ser string quando presente');
      }
    }

    // Avisos não bloqueiam a adoção.
    if (raw.count !== undefined) {
      if (!isInt(raw.count)) warnings.push('campo "count" não é inteiro; ignorado');
      else if (Array.isArray(qs) && raw.count !== qs.length)
        warnings.push('"count" (' + raw.count + ') diverge do número real de questões (' + qs.length + ')');
    }

    var ok = errors.length === 0;
    return { ok: ok, errors: errors, warnings: warnings, data: ok ? normalize(raw) : null };
  }

  // Cópia isolada (deep clone) para o banco interno nunca ser afetado por quem o forneceu.
  function normalize(raw) {
    var d = clone(raw);
    for (var i = 0; i < d.questions.length; i++) {
      if (d.questions[i].explanation === undefined || d.questions[i].explanation === null)
        d.questions[i].explanation = '';
    }
    return { version: isInt(raw.version) ? raw.version : null, source: typeof raw.source === 'string' ? raw.source : '', questions: d.questions };
  }

  var B = {};

  // Validação pura — útil também para checar um JSON importado sem adotá-lo.
  B.validate = function (raw) { return validateBank(raw); };

  // Adoção síncrona de um banco já parseado. Substitui o banco atual.
  // Retorna {ok:true, count, stats, warnings} ou {ok:false, code:'SCHEMA', errors}.
  B.adopt = function (raw) {
    var v = validateBank(raw);
    if (!v.ok) return { ok: false, code: 'SCHEMA', errors: v.errors };
    _state.data = v.data;
    _state.loaded = true;
    return { ok: true, count: v.data.questions.length, stats: B.stats(), warnings: v.warnings || [] };
  };

  // Adoção a partir de string JSON (arquivo lido, import manual, asset empacotado).
  B.fromText = function (text) {
    var raw;
    try { raw = JSON.parse(String(text)); }
    catch (e) { return { ok: false, code: 'JSON', errors: ['JSON inválido: ' + ((e && e.message) || String(e))] }; }
    return B.adopt(raw);
  };

  // Carregamento assíncrono via fetch(). SEMPRE resolve com resultado estruturado.
  B.load = function (url) {
    if (typeof Promise !== 'function') return null; // ambiente sem Promises: use adopt/fromText
    if (typeof fetch !== 'function') {
      return Promise.resolve({ ok: false, code: 'NO_FETCH', errors: ['fetch() não está disponível neste ambiente'] });
    }
    var p;
    try { p = fetch(url); } catch (e) {
      return Promise.resolve({ ok: false, code: 'FETCH', errors: [String((e && e.message) || e)] });
    }
    if (!p || typeof p.then !== 'function') {
      return Promise.resolve({ ok: false, code: 'FETCH', errors: ['fetch() não retornou uma Promise'] });
    }
    return p.then(function (r) {
      var status = (r && typeof r.status === 'number') ? r.status : 0;
      if (!r || !r.ok) {
        return { ok: false, code: 'HTTP', status: status, errors: ['falha HTTP ao carregar o banco (status ' + status + ')'] };
      }
      var jp = (typeof r.json === 'function') ? r.json() : null;
      if (!jp || typeof jp.then !== 'function') {
        return { ok: false, code: 'HTTP', status: status, errors: ['resposta HTTP sem método json()'] };
      }
      return jp.then(function (parsed) {
        if (typeof parsed === 'string') return B.fromText(parsed); // servidor devolveu texto puro
        return B.adopt(parsed);
      }, function (e) {
        return { ok: false, code: 'JSON', errors: ['falha ao ler o JSON da resposta: ' + String((e && e.message) || e)] };
      });
    }, function (e) {
      return { ok: false, code: 'FETCH', errors: [String((e && e.message) || e)] };
    });
  };

  B.loaded = function () { return _state.loaded; };
  B.count = function () { return _state.loaded ? _state.data.questions.length : 0; };

  // Retorna CÓPIAS (mutações externas não afetam o banco interno).
  B.getQuestion = function (id) {
    if (!_state.loaded) return null;
    for (var i = 0; i < _state.data.questions.length; i++)
      if (_state.data.questions[i].id === id) return clone(_state.data.questions[i]);
    return null;
  };
  B.list = function () { return _state.loaded ? clone(_state.data.questions) : []; };

  // Estatísticas SEMPRE calculadas dinamicamente (sem quantidades fixas em código).
  B.stats = function () {
    var byTheme = {}, byRegion = {}, byDifficulty = {};
    var c = BQ5.config || {};
    allowedThemes().forEach(function (t) { byTheme[t] = 0; });
    allowedRegions().forEach(function (r) { byRegion[r] = 0; });
    allowedDifficulties().forEach(function (d) { byDifficulty[d] = 0; });
    if (_state.loaded)
      _state.data.questions.forEach(function (q) {
        byTheme[q.theme] = (byTheme[q.theme] || 0) + 1;
        byRegion[q.region] = (byRegion[q.region] || 0) + 1;
        byDifficulty[q.difficulty] = (byDifficulty[q.difficulty] || 0) + 1;
      });
    return { total: _state.loaded ? _state.data.questions.length : 0, byTheme: byTheme, byRegion: byRegion, byDifficulty: byDifficulty };
  };

  // Metadados do arquivo (versão/origem), quando presentes.
  B.meta = function () {
    if (!_state.loaded) return { version: null, source: '' };
    return { version: _state.data.version, source: _state.data.source };
  };

  // Limpa o estado (útil em testes e ao reimportar um banco diferente).
  B.clear = function () { _state.loaded = false; _state.data = null; };

  globalThis.BQ5 = globalThis.BQ5 || {};
  BQ5.bank = B;
})();
