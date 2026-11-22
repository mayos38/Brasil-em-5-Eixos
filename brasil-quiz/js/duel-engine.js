/* ============================================================
 * Brasil em 5 Eixos — Núcleo de regras do M13 (1x1 LAN)
 *
 * Responsabilidade: regras puras da partida. Não conhece DOM, UI,
 * WebRTC, storage ou transporte. O M13 LAN coordena os dois aparelhos
 * e chama esta API somente no anfitrião, que é a autoridade da partida.
 * O estado e as operações de HP pertencem ao M18 (BQ5.hp); o M13 apenas
 * fornece seus parâmetros de duelo e consome os resultados do serviço.
 *
 * Regras documentadas no Relatorio_M13_Multiplayer_1x1_Brasil_em_5_Eixos.docx:
 * - 2 jogadores em aparelhos distintos; máximo/inicial de 1000 HP por jogador
 *   (valor do M13, administrado pelo serviço compartilhado do M18); até 15 rodadas.
 * - 3 cartas por jogador; descarte na mão adversária; pergunta própria.
 * - janela comum de 30 s; resolução simultânea; transição de 4 s.
 * - 100–175 de dano conforme dificuldade; sem bônus por velocidade.
 * - acerto causa dano; erro/timeout não causa dano.
 * - vitória/derrota/empate; dupla redução a zero na mesma resolução = empate.
 *
 * Parametrizações escolhidas para viabilizar a primeira implementação:
 * - dano linear: dificuldades 1..4 => 100/125/150/175.
 * - timeout: carta escolhida, mas não respondida, permanece na mão.
 *   Isso aplica literalmente “perguntas efetivamente respondidas” são
 *   consumidas; a política fica centralizada em CONFIG para revisão futura.
 * - preparação inicial: os dois começam com 2 cartas; cada um oferece
 *   uma cópia de uma carta ao adversário. A original não é removida;
 *   assim cada mão chega a 3 sem converter a preparação em descarte.
 * - uma carta descartada sai da mão e pode voltar a ser sorteada, pois
 *   os sorteios consultam o banco integral filtrado pelo tema.
 * ============================================================ */
(function (global) {
  'use strict';

  var CONFIG = {
    version: 1,
    players: 2,
    startingHp: 1000,
    handSize: 3,
    initialDeal: 2,
    maxRounds: 15,
    answerWindowMs: 30000,
    interRoundMs: 4000,
    damageByDifficulty: { 1: 100, 2: 125, 3: 150, 4: 175 },
    timeoutCardPolicy: 'retain'
  };
  var THEMES = ['all', 'cultura', 'economia', 'animais', 'vegetacao', 'cidades'];
  var THEME_LABELS = {
    all: 'Tema livre', cultura: 'Cultura', economia: 'Economia',
    animais: 'Animais', vegetacao: 'Vegetação', cidades: 'Cidades'
  };
  var DIFFICULTY_LABELS = { 1: 'Fácil', 2: 'Padrão', 3: 'Difícil', 4: 'Geógrafo' };

  function fail(code, message) { return { ok: false, code: code, message: message }; }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function isInt(n) { return typeof n === 'number' && isFinite(n) && Math.floor(n) === n; }
  function opposite(id) { return id === 'p1' ? 'p2' : 'p1'; }
  function defaultRandom() { return Math.random(); }
  function shuffled(list, random) {
    var copy = list.slice();
    for (var i = copy.length - 1; i > 0; i--) {
      var j = Math.floor(random() * (i + 1));
      var temp = copy[i]; copy[i] = copy[j]; copy[j] = temp;
    }
    return copy;
  }
  function normalizeQuestion(q) {
    return {
      id: q.id,
      theme: q.theme,
      difficulty: q.difficulty,
      question: q.question,
      options: q.options.slice(),
      answer: q.answer,
      explanation: q.explanation || ''
    };
  }

  function create(options) {
    options = options || {};
    var random = typeof options.random === 'function' ? options.random : defaultRandom;
    var source = Array.isArray(options.questions) ? options.questions : [];
    var theme = options.theme || 'all';
    var damage = options.damageByDifficulty || CONFIG.damageByDifficulty;
    var timeoutPolicy = options.timeoutCardPolicy || CONFIG.timeoutCardPolicy;
    var questions = source.filter(function (q) {
      return q && isInt(q.id) && (theme === 'all' || q.theme === theme) &&
        isInt(q.difficulty) && Array.isArray(q.options) && q.options.length === 4 &&
        isInt(q.answer) && q.answer >= 0 && q.answer <= 3;
    }).map(normalizeQuestion);

    if (THEMES.indexOf(theme) === -1) return fail('BAD_THEME', 'Tema de partida inválido.');
    if (questions.length < 2) return fail('NOT_ENOUGH_QUESTIONS', 'O banco não possui perguntas suficientes para este tema.');

    var hpApi = global.BQ5 && global.BQ5.hp;
    if (!hpApi || typeof hpApi.create !== 'function') {
      return fail('HP_MODULE_UNAVAILABLE', 'O M18 (Sistema de HP) precisa ser carregado antes do motor M13.');
    }
    var hpCreated = hpApi.create({ pools: [
      { id: 'p1', max: CONFIG.startingHp },
      { id: 'p2', max: CONFIG.startingHp }
    ] });
    if (!hpCreated.ok) return fail('HP_INITIALIZATION_FAILED', hpCreated.message || 'Não foi possível inicializar o HP da partida.');
    var hpManager = hpCreated.manager;

    var state = {
      matchId: options.matchId || ('m13-' + Date.now().toString(36) + '-' + Math.floor(random() * 0xFFFFFF).toString(36)),
      theme: theme,
      themeLabel: THEME_LABELS[theme],
      phase: 'initial-gift',
      round: 1,
      players: {
        p1: { id: 'p1', name: String(options.player1Name || 'Jogador 1').slice(0, 24), hand: [], gifts: {}, answers: 0, right: 0, damage: 0 },
        p2: { id: 'p2', name: String(options.player2Name || 'Jogador 2').slice(0, 24), hand: [], gifts: {}, answers: 0, right: 0, damage: 0 }
      },
      giftChoices: {}, discardChoices: {}, questionChoices: {}, answerChoices: {},
      roundRecords: [], lastRound: null, winnerId: null, outcome: null,
      createdAt: Date.now(), endedAt: null,
      _questions: questions,
      _damage: clone(damage),
      _timeoutPolicy: timeoutPolicy,
      _cardSequence: 0,
      _roundStartedAt: null
    };

    state.players.p1.hand = deal(CONFIG.initialDeal);
    state.players.p2.hand = deal(CONFIG.initialDeal);

    function newCard(question) {
      state._cardSequence++;
      return { cardId: 'c' + state._cardSequence.toString(36), question: clone(question) };
    }
    function deal(count) {
      var pool = shuffled(questions, random);
      var out = [];
      for (var i = 0; i < count; i++) out.push(newCard(pool[i % pool.length]));
      return out;
    }
    function draw() {
      var q = questions[Math.floor(random() * questions.length)];
      return newCard(q);
    }
    function player(id) { return state.players[id] || null; }
    function hpView(id) { return hpManager.read(id); }
    function findCard(id, cardId) {
      var p = player(id);
      if (!p) return null;
      for (var i = 0; i < p.hand.length; i++) if (p.hand[i].cardId === cardId) return p.hand[i];
      return null;
    }
    function publicCard(card) {
      return {
        cardId: card.cardId,
        theme: card.question.theme,
        difficulty: card.question.difficulty,
        themeLabel: THEME_LABELS[card.question.theme] || card.question.theme,
        difficultyLabel: DIFFICULTY_LABELS[card.question.difficulty] || ('Nível ' + card.question.difficulty)
      };
    }
    function clearRoundChoices() {
      state.discardChoices = {};
      state.questionChoices = {};
      state.answerChoices = {};
      state.players.p1.gifts = {};
      state.players.p2.gifts = {};
      state._roundStartedAt = null;
    }
    function resultFor(id) {
      var p = player(id), o = player(opposite(id));
      var records = state.roundRecords.map(function (r) { return clone(r.players[id]); });
      var right = p.right;
      var total = state.roundRecords.length;
      var pHp = hpView(id).current, oHp = hpView(opposite(id)).current;
      var ranking = [
        { id: p.id, name: p.name, hp: pHp },
        { id: o.id, name: o.name, hp: oHp }
      ].sort(function (a, b) { return b.hp - a.hp; }).map(function (entry) {
        return { id: entry.id, name: entry.name, score: entry.hp, rank: state.outcome === 'draw' ? 1 : (entry.id === state.winnerId ? 1 : 2) };
      });
      return {
        mode: '1v1', outcome: state.outcome,
        playerId: id, winnerId: state.winnerId,
        score: pHp, right: right, wrong: Math.max(0, total - right), total: total,
        pct: total ? Math.round((right / total) * 100) : 0,
        theme: state.theme, durationMs: (state.endedAt || Date.now()) - state.createdAt,
        players: ranking, review: records,
        duel: { rounds: state.roundRecords.length, hp: pHp, opponentHp: oHp, damageDealt: p.damage }
      };
    }

    var api = {
      config: function () { return clone(CONFIG); },
      theme: function () { return state.theme; },
      phase: function () { return state.phase; },
      round: function () { return state.round; },
      players: function () {
        return ['p1', 'p2'].map(function (id) {
          var p = player(id);
          var hp = hpView(id);
          return { id: p.id, name: p.name, hp: hp.current, hpMax: hp.max, hpRatio: hp.ratio, hpDepleted: hp.depleted, handSize: p.hand.length, right: p.right, answers: p.answers, damage: p.damage };
        });
      },
      viewFor: function (viewerId) {
        if (!player(viewerId)) return null;
        var own = player(viewerId), other = player(opposite(viewerId));
        return {
          matchId: state.matchId, theme: state.theme, themeLabel: state.themeLabel,
          phase: state.phase, round: state.round, maxRounds: CONFIG.maxRounds,
          answerWindowMs: CONFIG.answerWindowMs,
          self: { id: own.id, name: own.name, hp: hpView(own.id).current, hpMax: hpView(own.id).max, hpRatio: hpView(own.id).ratio, hand: own.hand.map(publicCard) },
          opponent: { id: other.id, name: other.name, hp: hpView(other.id).current, hpMax: hpView(other.id).max, hpRatio: hpView(other.id).ratio, hand: other.hand.map(publicCard) },
          giftsSubmitted: !!state.giftChoices[viewerId],
          discardsSubmitted: !!state.discardChoices[viewerId],
          questionSubmitted: !!state.questionChoices[viewerId],
          answersSubmitted: !!state.answerChoices[viewerId],
          answered: { p1: !!state.answerChoices.p1, p2: !!state.answerChoices.p2 },
          lastRound: state.lastRound ? clone(state.lastRound.public) : null,
          outcome: state.outcome
        };
      },
      questionFor: function (playerId) {
        var selected = state.questionChoices[playerId];
        if (!selected) return null;
        var card = findCard(playerId, selected.cardId);
        if (!card) return null;
        return { cardId: card.cardId, questionId: card.question.id,
          question: card.question.question, options: card.question.options.slice(),
          theme: card.question.theme, difficulty: card.question.difficulty };
      },
      startAt: function () { return state._roundStartedAt; },
      submitGift: function (playerId, cardId) {
        if (state.phase !== 'initial-gift') return fail('BAD_PHASE', 'A preparação inicial já terminou.');
        if (!player(playerId)) return fail('BAD_PLAYER', 'Jogador inválido.');
        if (state.giftChoices[playerId]) return fail('ALREADY_SUBMITTED', 'A escolha inicial já foi registrada.');
        var card = findCard(playerId, cardId);
        if (!card) return fail('BAD_CARD', 'A carta escolhida não pertence à sua mão.');
        state.giftChoices[playerId] = cardId;
        if (state.giftChoices.p1 && state.giftChoices.p2) {
          // A carta oferecida é COPIADA: nenhuma carta original sai da mão.
          var giftToP1 = findCard('p2', state.giftChoices.p2);
          var giftToP2 = findCard('p1', state.giftChoices.p1);
          player('p1').hand.push(newCard(giftToP1.question));
          player('p2').hand.push(newCard(giftToP2.question));
          state.phase = 'discard';
        }
        return { ok: true, complete: state.phase !== 'initial-gift', view: api.viewFor(playerId) };
      },
      submitDiscard: function (playerId, opponentCardId) {
        if (state.phase !== 'discard') return fail('BAD_PHASE', 'Não é a fase de descarte.');
        if (!player(playerId)) return fail('BAD_PLAYER', 'Jogador inválido.');
        if (state.discardChoices[playerId]) return fail('ALREADY_SUBMITTED', 'Seu descarte já foi registrado.');
        if (!findCard(opposite(playerId), opponentCardId)) return fail('BAD_CARD', 'Escolha uma carta que esteja na mão do adversário.');
        state.discardChoices[playerId] = opponentCardId;
        if (state.discardChoices.p1 && state.discardChoices.p2) {
          // Os dois descartes são validados antes de qualquer mutação.
          var removedP1 = state.discardChoices.p2;
          var removedP2 = state.discardChoices.p1;
          ['p1', 'p2'].forEach(function (id) {
            var target = player(id);
            var removeId = id === 'p1' ? removedP1 : removedP2;
            var idx = target.hand.findIndex(function (card) { return card.cardId === removeId; });
            if (idx < 0) return;
            target.hand.splice(idx, 1);
            target.hand.push(draw());
          });
          state.phase = 'choose-question';
        }
        return { ok: true, complete: state.phase !== 'discard', view: api.viewFor(playerId) };
      },
      submitQuestion: function (playerId, cardId) {
        if (state.phase !== 'choose-question') return fail('BAD_PHASE', 'Não é a fase de escolha da pergunta.');
        if (!player(playerId)) return fail('BAD_PLAYER', 'Jogador inválido.');
        if (state.questionChoices[playerId]) return fail('ALREADY_SUBMITTED', 'Sua pergunta já foi escolhida.');
        if (!findCard(playerId, cardId)) return fail('BAD_CARD', 'Escolha uma carta da sua própria mão.');
        state.questionChoices[playerId] = { cardId: cardId };
        if (state.questionChoices.p1 && state.questionChoices.p2) {
          state.phase = 'answer';
          state._roundStartedAt = Date.now();
        }
        return { ok: true, complete: state.phase === 'answer', question: api.questionFor(playerId), view: api.viewFor(playerId) };
      },
      submitAnswer: function (playerId, choice) {
        if (state.phase !== 'answer') return fail('BAD_PHASE', 'O período de respostas não está aberto.');
        if (!player(playerId)) return fail('BAD_PLAYER', 'Jogador inválido.');
        if (state.answerChoices[playerId]) return fail('ALREADY_SUBMITTED', 'Sua resposta já está bloqueada.');
        if (!isInt(choice) || choice < 0 || choice > 3) return fail('BAD_CHOICE', 'Alternativa inválida.');
        state.answerChoices[playerId] = { choice: choice, timedOut: false, answeredAt: Date.now() };
        return { ok: true, complete: !!(state.answerChoices.p1 && state.answerChoices.p2) };
      },
      expireAnswers: function () {
        if (state.phase !== 'answer') return fail('BAD_PHASE', 'Não há respostas em andamento.');
        ['p1', 'p2'].forEach(function (id) {
          if (!state.answerChoices[id]) state.answerChoices[id] = { choice: -1, timedOut: true, answeredAt: Date.now() };
        });
        return api.resolveRound();
      },
      resolveRound: function () {
        if (state.phase !== 'answer') return fail('BAD_PHASE', 'A rodada não está pronta para resolução.');
        if (!state.answerChoices.p1 || !state.answerChoices.p2) return fail('WAITING_FOR_PLAYER', 'Aguardando a resposta do outro jogador.');
        var computed = {};
        ['p1', 'p2'].forEach(function (id) {
          var selected = state.questionChoices[id];
          var card = selected ? findCard(id, selected.cardId) : null;
          var answer = state.answerChoices[id];
          var correct = !!(card && answer && !answer.timedOut && answer.choice === card.question.answer);
          var damage = correct ? (Number(state._damage[card.question.difficulty]) || 0) : 0;
          computed[id] = { card: card, answer: answer, correct: correct, damage: damage };
        });
        if (!computed.p1.card || !computed.p2.card) return fail('MISSING_CARD', 'Uma das perguntas selecionadas não está mais na mão.');
        // O M18 aplica os dois danos em um único lote atômico, sem vantagem
        // de ordem. O M13 não armazena nem altera valores de HP diretamente.
        var hpResolution = hpManager.applyBatch([
          { id: 'p1', damage: computed.p2.damage },
          { id: 'p2', damage: computed.p1.damage }
        ]);
        if (!hpResolution.ok) return fail('HP_RESOLUTION_FAILED', hpResolution.message || 'Não foi possível resolver o HP desta rodada.');
        var nextHp = { p1: hpView('p1').current, p2: hpView('p2').current };
        ['p1', 'p2'].forEach(function (id) {
          var item = computed[id];
          player(id).answers++;
          if (item.correct) player(id).right++;
          player(id).damage += item.damage;
        });
        var publicRound = {
          round: state.round,
          players: {
            p1: { correct: computed.p1.correct, timedOut: computed.p1.answer.timedOut, damage: computed.p1.damage, hp: nextHp.p1 },
            p2: { correct: computed.p2.correct, timedOut: computed.p2.answer.timedOut, damage: computed.p2.damage, hp: nextHp.p2 }
          }
        };
        var privateRecords = {};
        ['p1', 'p2'].forEach(function (id) {
          var c = computed[id].card;
          var ans = computed[id].answer;
          privateRecords[id] = {
            q: { txt: c.question.question, o: c.question.options.slice(), a: c.question.answer, e: c.question.explanation, t: c.question.theme, difficulty: c.question.difficulty },
            choice: ans.timedOut ? -1 : ans.choice,
            ok: computed[id].correct,
            timedOut: !!ans.timedOut,
            damage: computed[id].damage,
            round: state.round
          };
        });
        state.roundRecords.push({ players: privateRecords });
        state.lastRound = { public: publicRound, private: privateRecords };

        // Consome apenas pergunta efetivamente respondida. Timeout conserva a carta.
        ['p1', 'p2'].forEach(function (id) {
          var item = computed[id];
          if (item.answer.timedOut && timeoutPolicy === 'retain') return;
          var p = player(id);
          var index = p.hand.findIndex(function (card) { return card.cardId === item.card.cardId; });
          if (index >= 0) {
            p.hand.splice(index, 1);
            p.hand.push(draw());
          }
        });

        var zeroP1 = nextHp.p1 <= 0, zeroP2 = nextHp.p2 <= 0;
        if (zeroP1 && zeroP2) {
          state.outcome = 'draw'; state.winnerId = null;
        } else if (zeroP1) {
          state.outcome = 'loss'; state.winnerId = 'p2';
        } else if (zeroP2) {
          state.outcome = 'win'; state.winnerId = 'p1';
        } else if (state.round >= CONFIG.maxRounds) {
          if (nextHp.p1 === nextHp.p2) { state.outcome = 'draw'; state.winnerId = null; }
          else { state.winnerId = nextHp.p1 > nextHp.p2 ? 'p1' : 'p2'; state.outcome = state.winnerId === 'p1' ? 'win' : 'loss'; }
        }
        state.phase = state.outcome ? 'finished' : 'transition';
        if (state.outcome) state.endedAt = Date.now();
        clearRoundChoices();
        state.lastRound = { public: publicRound, private: privateRecords };
        return { ok: true, round: clone(publicRound), outcome: state.outcome, winnerId: state.winnerId,
          phase: state.phase, players: api.players() };
      },
      nextRound: function () {
        if (state.phase !== 'transition') return fail('BAD_PHASE', 'A transição não está ativa.');
        if (state.round >= CONFIG.maxRounds) return fail('MATCH_COMPLETE', 'A partida já atingiu o limite de rodadas.');
        state.round++;
        state.phase = 'discard';
        return { ok: true, view: api.viewFor('p1') };
      },
      resultFor: function (playerId) {
        if (!state.outcome) return null;
        var outcome = state.outcome === 'draw' ? 'draw' : (state.winnerId === playerId ? 'win' : 'loss');
        var result = resultFor(playerId);
        result.outcome = outcome;
        return result;
      },
      state: function () {
        return {
          matchId: state.matchId, theme: state.theme, phase: state.phase, round: state.round,
          outcome: state.outcome, winnerId: state.winnerId, players: api.players(),
          lastRound: state.lastRound ? clone(state.lastRound.public) : null
        };
      }
    };
    return { ok: true, game: api };
  }

  global.BQ5 = global.BQ5 || {};
  BQ5.multiplayer = BQ5.multiplayer || {};
  BQ5.multiplayer.duel = {
    create: create,
    themes: function () { return THEMES.slice(); },
    themeLabels: function () { return clone(THEME_LABELS); },
    difficultyLabels: function () { return clone(DIFFICULTY_LABELS); },
    config: function () { return clone(CONFIG); }
  };
})(globalThis);
