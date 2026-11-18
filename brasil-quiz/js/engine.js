/* ============================================================
 * brasil-quiz v0.2 modular — js/engine.js  (MÓDULO 5)
 * Responsabilidade: motor do jogo — regras e gerenciamento de partidas.
 *
 * O motor conhece as REGRAS; a interface apresenta visualmente;
 * storage cuida da persistência; bank fornece as questões;
 * config fornece os parâmetros. Este módulo NÃO toca DOM, CSS,
 * áudio, animações ou temporizadores do navegador (setInterval/
 * setTimeout): o relógio é injetável via setClock() e a interface
 * decide quando chamar answer(-1) em caso de tempo esgotado.
 *
 * REGRAS PRESERVADAS DO PROTÓTIPO (brasil-quiz-prototipo.html):
 *   - pool por tema + tier de dificuldade; se o pool do tier tiver
 *     menos de 5 questões, usa-se o banco filtrado só pelo tema;
 *   - alternativas embaralhadas preservando a associação correta;
 *   - nenhuma questão repetida dentro da mesma partida;
 *   - campanha: config.campaignQuestionsPerStage perguntas por região,
 *     dificuldade fixa 'normal', completadas com outras regiões se o
 *     pool regional for insuficiente (regra original, não simplificada);
 *   - pontos = pointsBase[dificuldade] + bônus de tempo min(segundos
 *     restantes, timeBonusMax); errada/tempo esgotado vale 0;
 *   - recorde solo e progresso da campanha persistidos via storage.
 *
 * Carregar DEPOIS de config.js, util.js, storage.js e bank.js.
 * Sem async/await (limitação do harness). Sem DOM. Sem localStorage
 * direto — só BQ5.storage.
 * ============================================================ */
(function () {
  'use strict';

  // Regra do protótipo: pool de tier com menos de 5 questões cai para o
  // banco filtrado apenas pelo tema (linha poolFor do protótipo).
  var MIN_POOL = 5;

  var G = null;          // partida ativa (estado interno, nunca exposto por referência)
  var _clock = null;     // relógio injetável (ms). null => Date.now() quando existir.

  function cfg() { return BQ5.config || {}; }
  function bank() { return BQ5.bank || null; }
  function storage() { return BQ5.storage || null; }

  function shuffle(a) {
    if (BQ5.util && typeof BQ5.util.shuffle === 'function') return BQ5.util.shuffle(a);
    // fallback mínimo apenas se util não estiver presente (não deve ocorrer)
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // Tempo (ms) por questão para a dificuldade: config.questionTimeMs pode ser
  // um objeto { tier: ms } ou, por compatibilidade, um número único.
  function timeFor(diff) {
    var c = cfg(), t = c.questionTimeMs;
    if (t && typeof t === 'object') {
      if (isInt(t[diff]) && t[diff] > 0) return t[diff];
    } else if (isInt(t) && t > 0) return t;
    return isInt(c.questionTimeDefaultMs) && c.questionTimeDefaultMs > 0 ? c.questionTimeDefaultMs : 15000;
  }

  function isInt(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function clock() {
    if (_clock) return _clock();
    try { return Date.now(); } catch (e) { return 0; }
  }

  // ---------- regras puras (espelham o protótipo) ----------

  // poolFor(theme, diff): filtra por tema e tier; se < MIN_POOL => só tema.
  function poolFor(all, theme, diff) {
    var q = all.filter(function (x) { return !theme || x.theme === theme; });
    var tiers = cfg().tiers || {};
    var tl = Array.isArray(tiers[diff]) ? tiers[diff] : null;
    var p = (tl && tl.length) ? q.filter(function (x) {
      return tl.indexOf(x.difficulty) !== -1;
    }) : [];
    if (p.length < MIN_POOL) p = q;
    return p;
  }

  // inst(q): embaralha as alternativas e remapeia a correta.
  // Carrega também o id da questão no banco (metadado para rastreio;
  // não altera regras de jogo).
  function instantiate(q) {
    var ord = shuffle([0, 1, 2, 3]);
    return {
      id: q.id,
      txt: q.question,
      o: ord.map(function (i) { return q.options[i]; }),
      a: ord.indexOf(q.answer),
      d: q.difficulty,
      e: q.explanation == null ? '' : q.explanation,
      t: q.theme,
      reg: q.region
    };
  }

  // buildQuiz(theme, diff, count, region):
  //   campanha (region): pool da região embaralhado; se faltar, completa
  //   com questões de outras regiões. Sem region: shuffle(pool).slice(count).
  function buildQuiz(all, theme, diff, count, region) {
    var base;
    if (region) {
      var rp = shuffle(all.filter(function (x) { return x.region === region; }));
      base = rp.slice(0, count);
      if (base.length < count) {
        base = base.concat(
          shuffle(all.filter(function (x) { return x.region !== region; }))
                 .slice(0, count - base.length)
        );
      }
    } else {
      base = shuffle(poolFor(all, theme, diff)).slice(0, count);
    }
    return base.map(instantiate);
  }

  // ---------- finalização (persistência via storage) ----------

  function finalize() {
    var total = G.quiz.length;
    var result = {
      mode: G.mode,
      score: G.score,
      right: G.right,
      total: total,
      review: clone(G.review)
    };
    if (G.mode === 'solo') {
      // protótipo: pct = round(right/total*100); recorde em 'bq5_best_solo'
      result.pct = Math.round((G.right / total) * 100);
      var rec = storage() ? storage().recordSoloScore(G.score) : { prev: G.score, best: G.score };
      result.record = { prev: rec.prev, best: rec.best };
    } else if (G.mode === 'campaign') {
      // protótipo endStage(): done[region]=true; best só aumenta
      var r2 = storage() ? storage().completeStage(G.region, G.score) : null;
      result.stage = r2
        ? { region: G.region, done: true, best: r2.progress.best[G.region], allDone: r2.allDone }
        : null;
    }
    G.finished = true;
    G.result = result;
  }

  // ---------- API pública ----------

  var E = {};

  /**
   * Define a fonte de tempo (função que retorna ms). null restaura o padrão
   * (Date.now()). O motor NUNCA usa setInterval/setTimeout: a interface
   * acompanha remainingMs() e chama answer(-1) quando o tempo esgotar.
   */
  E.setClock = function (fn) {
    if (fn !== null && typeof fn !== 'function') throw new Error('setClock: função ou null');
    _clock = fn;
    return true;
  };

  /** Tempo atual segundo o relógio ativo (ms). */
  E.now = function () { return clock(); };

  /**
   * Inicia uma nova partida. Sempre substitui qualquer partida ativa
   * (partidas não finalizadas não são persistidas — mesmo comportamento do
   * protótipo, onde sair para o menu descarta a sessão).
   *
   * opts: {
   *   mode:  'solo' | 'campaign'            OBRIGATÓRIO
   *   theme: 'all' | tema de config         solo (padrão 'all')
   *   diff:  chave de config.tiers          solo (padrão 'normal');
   *                                        campanha ignora (fixa 'normal',
   *                                        regra do protótipo stageOpen)
   *   count: inteiro >= 1                   solo (padrão config.soloQuestionCount);
   *                                        campanha ignora (fixo por estágio)
   *   region: região de config              campaign OBRIGATÓRIO
   * }
   *
   * Retorna { ok:true, game } ou { ok:false, code, errors } com codes:
   * NO_BANK | INVALID_MODE | BAD_THEME | BAD_DIFF | BAD_REGION | BAD_COUNT
   * | NO_QUESTIONS.
   */
  E.start = function (opts) {
    var o = opts || {};
    if (!bank() || !bank().loaded() || bank().count() === 0) {
      return { ok: false, code: 'NO_BANK', errors: ['banco de questões não carregado — use BQ5.bank.load()/adopt()/fromText() antes'] };
    }

    var mode = o.mode;
    if (mode !== 'solo' && mode !== 'campaign') {
      return { ok: false, code: 'INVALID_MODE', errors: ["mode deve ser 'solo' ou 'campaign'"] };
    }

    var c = cfg();

    var theme = o.theme === undefined ? 'all' : o.theme;
    if (theme !== 'all' && (c.themes || []).indexOf(theme) === -1) {
      return { ok: false, code: 'BAD_THEME', errors: ['tema desconhecido no config: ' + theme] };
    }

    var diff = o.diff === undefined ? 'normal' : o.diff;
    if (mode === 'campaign') diff = 'normal'; // regra fixa do protótipo para campanha
    if (!(c.tiers || {})[diff]) {
      return { ok: false, code: 'BAD_DIFF', errors: ['dificuldade desconhecida no config.tiers: ' + diff] };
    }

    var region = null;
    if (mode === 'campaign') {
      region = o.region || null;
      if (!region || (c.regions || []).indexOf(region) === -1) {
        return { ok: false, code: 'BAD_REGION', errors: ['campanha exige uma região válida de config.regions'] };
      }
    }

    var count;
    if (mode === 'solo') {
      count = o.count !== undefined ? o.count : c.soloQuestionCount;
      if (!isInt(count) || count < 1) {
        return { ok: false, code: 'BAD_COUNT', errors: ['count deve ser inteiro >= 1'] };
      }
    } else {
      count = c.campaignQuestionsPerStage; // fixo por estágio (6 no config)
    }

    var all = bank().list();
    var quiz = buildQuiz(all, theme === 'all' ? null : theme, diff, count, region);
    if (quiz.length === 0) {
      return { ok: false, code: 'NO_QUESTIONS', errors: ['nenhuma questão disponível para esses parâmetros'] };
    }

    G = {
      mode: mode,
      theme: theme,
      diff: diff,
      region: region,
      quiz: quiz,
      i: 0,
      score: 0,
      right: 0,
      review: [],
      locked: false,
      limitMs: timeFor(diff),
      tEnd: clock() + timeFor(diff),
      lastChoice: -1,
      finished: false,
      result: null
    };
    return { ok: true, game: E.state() };
  };

  /**
   * Snapshot do estado da partida ativa (valores primitivos; seguro para a UI).
   * null se não há partida. Campos: mode, theme, diff, region, index (0-based),
   * total, score, right, locked, finished, timeLimitMs (duração por questão).
   */
  E.state = function () {
    if (!G) return null;
    return {
      mode: G.mode,
      theme: G.theme,
      diff: G.diff,
      region: G.region,
      index: G.i,
      total: G.quiz.length,
      score: G.score,
      right: G.right,
      locked: G.locked,
      finished: G.finished,
      timeLimitMs: G.limitMs
    };
  };

  /**
   * Cópia da questão atual (já embaralhada): {id, txt, o[4], a, d, e, t, reg}.
   * null se não há partida ativa. Válida também enquanto locked (a tela de
   * revelação precisa dela).
   */
  E.question = function () {
    if (!G) return null;
    return clone(G.quiz[G.i]);
  };

  /**
   * Milissegundos restantes da questão atual. null se não há partida.
   * A interface usa este valor para a barra de tempo e dispara answer(-1)
   * quando chegar a zero (mesmo papel do tick() do protótipo).
   */
  E.remainingMs = function () {
    if (!G) return null;
    return Math.max(0, G.tEnd - clock());
  };

  /**
   * Registra a resposta da questão atual e trava a questão.
   * choice: inteiro 0..3; -1 = tempo esgotado (regra do protótipo).
   *
   * Pontos (fórmula original): correta => pointsBase[d] + min(segundos
   * restantes, timeBonusMax); errada ou timeout => 0.
   *
   * Retorna { ok:true, correct, points, timedOut, score, right, index, total,
   * last, review } ou erro { ok:false, code: NO_GAME | FINISHED | LOCKED |
   * INVALID_CHOICE }. Erros não alteram o estado.
   */
  E.answer = function (choice) {
    if (!G) return { ok: false, code: 'NO_GAME', errors: ['não há partida ativa'] };
    if (G.finished) return { ok: false, code: 'FINISHED', errors: ['partida já encerrada'] };
    if (G.locked) return { ok: false, code: 'LOCKED', errors: ['questão já respondida'] };

    var timedOut = (choice === -1);
    if (!timedOut && (!isInt(choice) || choice < 0 || choice > 3)) {
      return { ok: false, code: 'INVALID_CHOICE', errors: ['choice deve ser inteiro 0..3 (-1 para timeout)'] };
    }

    G.locked = true;
    G.lastChoice = timedOut ? -1 : choice;
    var qi = G.quiz[G.i];

    // Fórmula original do protótipo (answer()): segundos restantes arredondados,
    // bônus limitado a timeBonusMax.
    var c = cfg();
    var rem = Math.max(0, Math.round((G.tEnd - clock()) / 1000));
    var cap = isInt(c.timeBonusMax) ? c.timeBonusMax : 7;
    var ok = !timedOut && choice === qi.a;
    var pts = ok ? ((c.pointsBase || {})[qi.d] || 0) + Math.min(rem, cap) : 0;

    if (ok) { G.score += pts; G.right++; }
    var entry = { q: clone(qi), choice: G.lastChoice, player: null, ok: ok };
    G.review.push(entry);

    return {
      ok: true,
      correct: ok,
      points: pts,
      timedOut: timedOut,
      score: G.score,
      right: G.right,
      index: G.i,
      total: G.quiz.length,
      last: (G.i + 1 >= G.quiz.length),
      review: entry
    };
  };

  /**
   * Avança para a próxima questão OU finaliza a partida se era a última.
   * A nova questão recebe um prazo integral (tempo da dificuldade, config.questionTimeMs[diff]) — mesmo papel do
   * qView() do protótipo, que redefinía tEnd ao exibir cada pergunta.
   *
   * Retorna { ok:true, finished:false, index, total } ou,
   * na finalização, { ok:true, finished:true, result }. Erros: NO_GAME |
   * FINISHED | NOT_ANSWERED (questão atual ainda não respondida).
   */
  E.next = function () {
    if (!G) return { ok: false, code: 'NO_GAME', errors: ['não há partida ativa'] };
    if (G.finished) return { ok: false, code: 'FINISHED', errors: ['partida já encerrada'] };
    if (!G.locked) {
      return { ok: false, code: 'NOT_ANSWERED', errors: ['responda a questão atual antes de avançar'] };
    }

    var c = cfg();
    if (G.i + 1 >= G.quiz.length) {
      finalize();
      return { ok: true, finished: true, result: clone(G.result) };
    }
    G.i++;
    G.locked = false;
    G.lastChoice = -1;
    G.tEnd = clock() + G.limitMs;
    return { ok: true, finished: false, index: G.i, total: G.quiz.length };
  };

  /**
   * Resultado final da partida atual/última finalizada:
   * solo     => {mode,score,right,total,pct,record:{prev,best},review}
   * campaign => {mode,score,right,total,stage:{region,done,best,allDone},review}
   * null se ainda não há partida finalizada.
   */
  E.result = function () {
    if (!G || !G.finished) return null;
    return clone(G.result);
  };

  /** Cópia do registro de respostas da partida ativa (para a tela de revisão). null se não há partida. */
  E.review = function () {
    if (!G) return null;
    return clone(G.review);
  };

  /**
   * Encerra/descarta a partida ativa SEM persistir nada (mesmo papel do
   * "sair da partida" do protótipo). { ok:true, hadGame }.
   */
  E.abort = function () {
    var had = !!G;
    G = null;
    return { ok: true, hadGame: had };
  };

  /**
   * Progresso da campanha — delegação fina à interface pública do storage
   * (BQ5.storage.getProgress()); não duplica lógica de persistência.
   */
  E.progress = function () {
    return storage() ? storage().getProgress() : { done: {}, best: {} };
  };

  BQ5.engine = E;
})();
