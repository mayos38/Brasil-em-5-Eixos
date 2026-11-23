/* ============================================================
 * Brasil em 5 Eixos — js/multiplayer/alt.js
 * MODO ALTERNATIVO do Multiplayer 1x1 (variante registrada em local.js).
 * Depende de: hp.js (Módulo 18), multiplayer/local.js (conexão, nomes, saída).
 *
 * REGRAS
 *  - cada jogador tem 1000 de HP; acertar causa dano ao oponente conforme a
 *    DIFICULDADE da carta (nunca a velocidade); errar ou não responder = nada;
 *  - cada jogador tem 3 cartas (tema + dificuldade visíveis; a pergunta só
 *    aparece ao escolher a carta). Uma carta por rodada, 45 s, mesmo tempo
 *    para os dois; a resposta confirmada fica travada;
 *  - fim da rodada, nesta ORDEM: resultado do jogador 1 (anfitrião) -> dano
 *    no jogador 2; resultado do jogador 2 -> dano no jogador 1; ambos errando,
 *    nada acontece. 4 s de transição;
 *  - início: cada um recebe 2 cartas e escolhe 1 entre 3 para dar ao oponente
 *    (15 s; sem escolha, o sistema sorteia). Entre as rodadas, cada um escolhe
 *    1 carta do oponente para descartar (15 s; sem escolha, ninguém descarta);
 *    o sistema repõe com outra carta sorteada (nunca a mesma pergunta);
 *    carta usada em uma rodada também é reposta;
 *  - vitória: HP do oponente chega a 0 ou, após 12 rodadas, maior HP.
 *    Os dois eventos da rodada sempre acontecem; se ambos zerarem, empate.
 *  - fim: resumo (acertos, temas que mais acertou/errou) sem revisão das
 *    perguntas; Revanche (amarelo), Jogar novamente, Menu principal (vermelho).
 *
 * O anfitrião é a autoridade. O gabarito de uma carta só sai do anfitrião
 * depois das duas respostas. NÃO existe pausa.
 * ============================================================ */
(function (global) {
  'use strict';

  var BQ5 = global.BQ5 = global.BQ5 || {};
  var DEFAULTS = {
    rounds: 12,
    limitMs: 45000,
    pickMs: 15000,
    transitionMs: 4000,
    eventGapMs: 1800,
    graceMs: 2000,
    rematchMs: 5200,
    startCards: 2,
    candidates: 3,
    difficultyWeights: { 1: 1, 2: 1, 3: 1, 4: 1 }
  };
  var OPTION_LABELS = ['A', 'B', 'C', 'D'];
  var A = null;

  function ui() { return BQ5.ui || null; }
  function config() { return BQ5.config || {}; }
  function K() { return BQ5.screens.multiplayer.kit; }
  function now() { return Date.now(); }
  function isInt(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }
  function label(map, key, fallback) { return map && map[key] != null ? String(map[key]) : (fallback == null ? String(key) : String(fallback)); }
  function themeName(t) { return t ? label(config().themeLabels, t, t) : '—'; }

  function params() {
    var custom = (config().multiplayer && config().multiplayer.alternative) || {};
    var out = {};
    Object.keys(DEFAULTS).forEach(function (key) { out[key] = custom[key] != null ? custom[key] : DEFAULTS[key]; });
    return out;
  }

  function describe() {
    var p = params();
    var max = BQ5.hp ? BQ5.hp.settings().max : 1000;
    return 'Cada jogador tem ' + max + ' de HP e três cartas. Quem acerta causa dano ao oponente conforme a dificuldade da carta, sem importar a velocidade. ' +
      'Entre as rodadas, você descarta uma carta do oponente. Vence quem zerar o HP do outro ou tiver mais HP após ' + p.rounds + ' rodadas.';
  }

  function difficultyLabel(d) {
    var tiers = config().tiers || {};
    var best = null;
    Object.keys(tiers).forEach(function (key) {
      var list = tiers[key];
      if (Array.isArray(list) && list.indexOf(d) !== -1 && (!best || list.length < tiers[best].length)) best = key;
    });
    return best ? label(config().tierLabels, best, best) : 'Nível ' + d;
  }

  // ---------- estado ----------

  function fresh() {
    return {
      cfg: params(),
      theme: 'all',
      hp: null,
      pool: [],
      hands: { host: [], guest: [] },
      cands: { host: [], guest: [] },
      picks: {},
      answers: {},
      used: {},
      nextCid: 1,
      round: -1,
      stage: 'idle',        // idle | give | discard | round | reveal | end | msg
      myHand: [],
      oppHand: [],
      pickKind: null,
      pickChosen: undefined,
      pickEnd: 0,
      selCid: null,
      selChoice: null,
      myAnswered: false,
      oppAnswered: false,
      qEnd: 0,
      revealEnd: 0,
      roundsDone: 0,
      logs: { host: [], guest: [] },
      summary: null,
      rematch: { asked: false, closed: false, incoming: false },
      T: {}
    };
  }
  A = fresh();

  function setT(name, fn, ms) { clearT(name); A.T[name] = global.setTimeout(function () { A.T[name] = null; fn(); }, ms); }
  function clearT(name) {
    if (A.T[name] != null) {
      if (name === 'tick') global.clearInterval(A.T[name]); else global.clearTimeout(A.T[name]);
    }
    A.T[name] = null;
  }
  function clearAllT() { Object.keys(A.T).forEach(clearT); }

  function me() { return K().meKey(); }
  function opp() { return K().oppKey(); }
  function other(who) { return who === 'host' ? 'guest' : 'host'; }
  function isHost() { return K().isHost(); }

  // ---------- DOM ----------

  function clearNode(node) { if (node) while (node.firstChild) node.removeChild(node.firstChild); }
  function mk(tag, cls, text) {
    var node = global.document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function renderHp(prefix) {
    var api = ui();
    if (!A.hp) return;
    var max = A.hp.max;
    [['me', me()], ['opp', opp()]].forEach(function (pair) {
      var value = A.hp.get(pair[1]);
      var ratio = A.hp.ratio(pair[1]);
      api.text('#' + prefix + '-hp-' + pair[0], value);
      var bar = api.el('#' + prefix + '-bar-' + pair[0]);
      if (bar) {
        bar.setAttribute('data-level', A.hp.level(pair[1]));
        bar.setAttribute('aria-valuemax', String(max));
        bar.setAttribute('aria-valuenow', String(value));
        bar.setAttribute('aria-valuetext', value + ' de ' + max + ' de HP');
        if (bar.style && typeof bar.style.setProperty === 'function') bar.style.setProperty('--p', String(ratio));
      }
    });
    api.text('#' + prefix + '-name-me', 'Você');
    api.text('#' + prefix + '-name-opp', K().oppName());
  }

  function renderAllHp() { renderHp('alt-pick'); renderHp('alt-play'); }

  function setTimerBar(barSel, textSel, remaining, total) {
    var api = ui();
    var ratio = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;
    var bar = api.el(barSel);
    if (bar) {
      bar.setAttribute('data-level', ratio < 0.2 ? 'danger' : (ratio < 0.5 ? 'warn' : 'ok'));
      if (bar.style && typeof bar.style.setProperty === 'function') bar.style.setProperty('--p', String(ratio));
    }
    api.text(textSel, Math.max(0, Math.ceil(remaining / 1000)) + ' s');
  }

  function cardButton(card, extraClass) {
    var button = mk('button', 'bq5-altcard' + (extraClass ? ' ' + extraClass : ''));
    button.type = 'button';
    button.setAttribute('data-cid', String(card.cid));
    button.setAttribute('data-theme', card.t || '');
    button.setAttribute('aria-label', themeName(card.t) + ', ' + difficultyLabel(card.d) + ', dano ' + card.dmg);
    button.appendChild(mk('span', 'bq5-altcard__theme', themeName(card.t)));
    button.appendChild(mk('span', 'bq5-altcard__diff', difficultyLabel(card.d)));
    button.appendChild(mk('span', 'bq5-altcard__dmg bq5-num', 'Dano ' + card.dmg));
    return button;
  }

  // ---------- anfitrião: sorteio de cartas ----------

  function inUse(qid) {
    var found = false;
    ['host', 'guest'].forEach(function (who) {
      A.hands[who].concat(A.cands[who]).forEach(function (card) { if (card.q.id === qid) found = true; });
    });
    return found;
  }

  function drawCard() {
    var d = K().draw;
    var pool = A.pool.filter(function (q) { return !A.used[q.id] && !inUse(q.id); });
    if (!pool.length) pool = A.pool.filter(function (q) { return !inUse(q.id); });   // reaproveita se acabou
    if (!pool.length) return null;
    var diff = d.weightedPick(d.unique(pool.map(function (q) { return q.difficulty; })), A.cfg.difficultyWeights);
    var candidates = pool.filter(function (q) { return q.difficulty === diff; });
    if (A.theme === 'all') {
      var t = d.pickRandom(d.unique(candidates.map(function (q) { return q.theme; })));
      candidates = candidates.filter(function (q) { return q.theme === t; });
    }
    var pick = d.pickRandom(candidates);
    A.used[pick.id] = true;
    return { cid: A.nextCid++, q: d.instantiate(pick) };
  }

  function summary(card) { return { cid: card.cid, t: card.q.t, d: card.q.d, dmg: BQ5.hp.damageFor(card.q.d) }; }
  function full(card) {
    var s = summary(card);
    s.txt = card.q.txt;
    s.o = card.q.o.slice();
    s.reg = card.q.reg;
    return s;
  }
  function find(list, cid) {
    for (var i = 0; i < list.length; i++) if (list[i].cid === cid) return list[i];
    return null;
  }

  // ---------- início (anfitrião) ----------

  function hostStart(kit) {
    if (!kit.isHost()) return { ok: false };
    var bank = BQ5.bank;
    if (!BQ5.hp) return { ok: false, message: 'O módulo de HP (hp.js) não foi carregado.' };
    if (!bank || !bank.loaded()) return { ok: false, message: 'O banco de perguntas ainda não foi carregado.' };
    return beginHost(kit.theme());
  }

  function beginHost(theme) {
    var keepRematch = A.rematch;
    A = fresh();
    A.rematch = { asked: false, closed: false, incoming: false };
    void keepRematch;
    A.theme = theme || 'all';
    A.pool = BQ5.bank.list().filter(function (q) { return A.theme === 'all' || q.theme === A.theme; });
    if (A.pool.length < 12) return { ok: false, message: 'Não há perguntas suficientes para este tema.' };
    A.hp = BQ5.hp.create({ ids: ['host', 'guest'] });
    K().setPhase('playing');
    if (BQ5.engine && typeof BQ5.engine.abort === 'function') BQ5.engine.abort();
    var cfg = { rounds: A.cfg.rounds, limitMs: A.cfg.limitMs, pickMs: A.cfg.pickMs, transitionMs: A.cfg.transitionMs, eventGapMs: A.cfg.eventGapMs, hpMax: A.hp.max };
    K().send({ t: 'a:init', cfg: cfg, theme: A.theme });
    for (var i = 0; i < A.cfg.startCards; i++) {
      A.hands.host.push(drawCard());
      A.hands.guest.push(drawCard());
    }
    startGive();
    return { ok: true };
  }

  function startGive() {
    A.stage = 'give';
    A.picks = {};
    A.cands = { host: [], guest: [] };
    for (var i = 0; i < A.cfg.candidates; i++) {
      A.cands.host.push(drawCard());
      A.cands.guest.push(drawCard());
    }
    K().send({ t: 'a:give', cands: A.cands.guest.map(summary), ms: A.cfg.pickMs });
    uiPick('give', A.cands.host.map(summary), A.cfg.pickMs);
    setT('hostPick', resolveGive, A.cfg.pickMs + A.cfg.graceMs);
  }

  function onPick(who, kind, cid) {
    if (A.stage !== kind || A.picks[who] !== undefined) return;
    if (kind === 'give') {
      A.picks[who] = find(A.cands[who], cid) ? cid : null;
    } else {
      A.picks[who] = find(A.hands[other(who)], cid) ? cid : null;
    }
    if (A.picks.host !== undefined && A.picks.guest !== undefined) {
      if (kind === 'give') resolveGive(); else resolveDiscard();
    }
  }

  function resolveGive() {
    if (A.stage !== 'give') return;
    clearT('hostPick');
    ['host', 'guest'].forEach(function (who) {
      var list = A.cands[who];
      var card = (A.picks[who] != null ? find(list, A.picks[who]) : null) || list[Math.floor(Math.random() * list.length)];
      if (card) A.hands[other(who)].push(card);
    });
    A.cands = { host: [], guest: [] };
    startRound(0);
  }

  function startDiscard() {
    A.stage = 'discard';
    A.picks = {};
    K().send({ t: 'a:discard', oppHand: A.hands.host.map(summary), ms: A.cfg.pickMs });
    uiPick('discard', A.hands.guest.map(summary), A.cfg.pickMs);
    setT('hostPick', resolveDiscard, A.cfg.pickMs + A.cfg.graceMs);
  }

  function resolveDiscard() {
    if (A.stage !== 'discard') return;
    clearT('hostPick');
    ['host', 'guest'].forEach(function (who) {
      var cid = A.picks[who];
      if (cid == null) return;
      var target = other(who);
      var card = find(A.hands[target], cid);
      if (!card) return;
      A.hands[target] = A.hands[target].filter(function (c) { return c !== card; });
      var replacement = drawCard();
      if (replacement) A.hands[target].push(replacement);
    });
    startRound(A.round + 1);
  }

  function startRound(i) {
    A.round = i;
    A.stage = 'round';
    A.answers = {};
    var base = { t: 'a:round', i: i, limitMs: A.cfg.limitMs, hp: A.hp.snapshot() };
    var forGuest = { t: base.t, i: i, limitMs: base.limitMs, hp: base.hp, hand: A.hands.guest.map(full), oppHand: A.hands.host.map(summary) };
    K().send(forGuest);
    uiRound({ i: i, limitMs: A.cfg.limitMs, hp: base.hp, hand: A.hands.host.map(full), oppHand: A.hands.guest.map(summary) });
    setT('hostDeadline', hostDeadline, A.cfg.limitMs + A.cfg.graceMs);
  }

  // ---------- anfitrião: respostas e resolução ----------

  function hostRecord(who, cid, choice, rem) {
    if (A.stage !== 'round' || A.answers[who]) return;
    var card = cid != null ? find(A.hands[who], cid) : null;
    A.answers[who] = { cid: card ? card.cid : null, choice: card ? choice : -1, rem: rem };
    if (who === 'host') K().send({ t: 'a:opp', i: A.round });
    else { A.oppAnswered = true; renderOppStatus(); }
    if (A.answers.host && A.answers.guest) resolveRound();
  }

  function hostDeadline() {
    if (A.stage !== 'round') return;
    ['host', 'guest'].forEach(function (who) { if (!A.answers[who]) A.answers[who] = { cid: null, choice: -1, rem: 0 }; });
    resolveRound();
  }

  function resolveRound() {
    if (A.stage !== 'round') return;
    clearT('hostDeadline');
    var events = [];
    var consumed = [];
    // ORDEM FIXA: primeiro o jogador 1 (anfitrião), depois o jogador 2 (convidado).
    ['host', 'guest'].forEach(function (who) {
      var ans = A.answers[who];
      var card = ans.cid != null ? find(A.hands[who], ans.cid) : null;
      var ok = !!card && ans.choice === card.q.a;
      var dealt = 0;
      if (ok) dealt = A.hp.damage(other(who), BQ5.hp.damageFor(card.q.d)).dealt;
      if (card) consumed.push({ who: who, card: card });
      events.push({
        who: who, t: card ? card.q.t : null, d: card ? card.q.d : null, ok: ok,
        timedOut: ans.choice === -1, used: !!card, dmg: dealt,
        a: card ? card.q.a : null, choice: ans.choice, hp: A.hp.snapshot()
      });
    });
    consumed.forEach(function (item) {
      A.hands[item.who] = A.hands[item.who].filter(function (c) { return c !== item.card; });
    });
    consumed.forEach(function (item) {
      var replacement = drawCard();
      if (replacement) A.hands[item.who].push(replacement);
    });
    var winner = A.hp.resolve(A.round + 1 >= A.cfg.rounds);
    var over = winner ? { outcome: winner, reason: (A.hp.isDead('host') || A.hp.isDead('guest')) ? 'hp' : 'rounds' } : null;
    A.finalHp = A.hp.snapshot();
    var msg = { t: 'a:reveal', i: A.round, events: events, hp: A.hp.snapshot(), over: over, transitionMs: A.cfg.transitionMs, gapMs: A.cfg.eventGapMs };
    K().send(msg);
    applyReveal(msg);
    setT('hostNext', function () {
      if (over) hostFinish(over); else startDiscard();
    }, A.cfg.transitionMs);
  }

  function hostFinish(over) {
    if (A.finalHp) A.hp.restore(A.finalHp);
    var msg = { t: 'a:end', outcome: over.outcome, reason: over.reason, hp: A.hp.snapshot() };
    K().send(msg);
    applyEnd(msg);
  }

  // ---------- cliente (ambos): iniciar ----------

  function applyInit(msg) {
    var keep = A.rematch;
    var wasHost = isHost();
    if (!wasHost) {
      A = fresh();
      A.rematch = { asked: false, closed: false, incoming: false };
    }
    void keep;
    var c = msg.cfg || {};
    A.cfg.rounds = isInt(c.rounds) ? c.rounds : A.cfg.rounds;
    A.cfg.limitMs = isInt(c.limitMs) ? c.limitMs : A.cfg.limitMs;
    A.cfg.pickMs = isInt(c.pickMs) ? c.pickMs : A.cfg.pickMs;
    A.cfg.transitionMs = isInt(c.transitionMs) ? c.transitionMs : A.cfg.transitionMs;
    A.cfg.eventGapMs = isInt(c.eventGapMs) ? c.eventGapMs : A.cfg.eventGapMs;
    A.theme = typeof msg.theme === 'string' ? msg.theme : 'all';
    A.hp = BQ5.hp.create({ ids: ['host', 'guest'], max: isInt(c.hpMax) ? c.hpMax : undefined });
    K().setPhase('playing');
    if (BQ5.engine && typeof BQ5.engine.abort === 'function') BQ5.engine.abort();
  }

  // ---------- telas: escolher carta (início) / descartar (entre rodadas) ----------

  function uiPick(kind, cards, ms) {
    var api = ui();
    A.stage = kind;
    A.pickKind = kind;
    A.pickChosen = undefined;
    A.pickEnd = now() + ms;
    A.pickMs = ms;
    var give = kind === 'give';
    api.text('#alt-pick-title', give ? 'Escolha uma carta para o oponente' : 'Escolha uma carta do oponente para descartar');
    api.text('#alt-pick-lead', give
      ? 'Você vê só o tema e a dificuldade. A carta escolhida vai para a mão do oponente.'
      : 'Você vê só o tema e a dificuldade. A carta descartada é trocada por outra sorteada.');
    api.text('#alt-pick-status', 'Toque em uma carta. Sem escolha, ' + (give ? 'o sistema sorteia.' : 'nenhuma carta é descartada.'));
    api.text('#alt-pick-round', give ? 'Início' : (A.round + 2) + '/' + A.cfg.rounds);
    var box = api.el('#alt-pick-cards');
    clearNode(box);
    cards.forEach(function (card) { box.appendChild(cardButton(card)); });
    renderAllHp();
    setTimerBar('#alt-pick-timer', '#alt-pick-time', ms, ms);
    if (api.currentScreen() !== 'mp-alt-pick') api.showScreen('mp-alt-pick', { history: false, clearHistory: true });
    startTick();
    api.text('#alt-live', give ? 'Escolha uma carta para o oponente.' : 'Escolha uma carta do oponente para descartar.');
  }

  function choosePick(cid) {
    if ((A.stage !== 'give' && A.stage !== 'discard') || A.pickChosen !== undefined) return false;
    A.pickChosen = cid;
    var api = ui();
    api.all('.bq5-altcard', api.el('#alt-pick-cards')).forEach(function (button) {
      var mine = cid != null && Number(button.getAttribute('data-cid')) === cid;
      button.disabled = true;
      button.setAttribute('data-state', mine ? 'chosen' : (cid == null ? 'idle' : 'dimmed'));
    });
    api.text('#alt-pick-status', cid == null ? 'Tempo esgotado. Aguardando o oponente…' : 'Carta escolhida. Aguardando o oponente…');
    if (isHost()) onPick('host', A.stage, cid);
    else K().send({ t: 'a:pick', kind: A.stage, cid: cid });
    return true;
  }

  // ---------- tela de jogatina ----------

  function uiRound(msg) {
    var api = ui();
    clearT('seq');
    A.stage = 'round';
    A.round = msg.i;
    A.hp.restore(msg.hp);
    A.myHand = msg.hand || [];
    A.oppHand = msg.oppHand || [];
    A.selCid = null;
    A.selChoice = null;
    A.myAnswered = false;
    A.oppAnswered = false;
    A.qEnd = now() + msg.limitMs;
    A.limitMs = msg.limitMs;
    api.text('#alt-round', msg.i + 1);
    api.text('#alt-rounds', A.cfg.rounds);
    renderAllHp();
    var hand = api.el('#alt-hand');
    clearNode(hand);
    A.myHand.forEach(function (card) { hand.appendChild(cardButton(card)); });
    api.hidden('#alt-hand-wrap', false);
    api.hidden('#alt-qwrap', true);
    api.hidden('#alt-events-wrap', true);
    clearNode(api.el('#alt-events'));
    api.text('#alt-hand-title', 'Escolha uma carta para responder');
    var opts = api.all('.bq5-option', api.el('#alt-options'));
    opts.forEach(function (button) { button.disabled = false; button.removeAttribute('data-state'); button.setAttribute('aria-pressed', 'false'); });
    renderOppStatus();
    updateConfirm();
    if (api.currentScreen() !== 'mp-alt-play') api.showScreen('mp-alt-play', { history: false, clearHistory: true });
    var screen = api.el('#screen-mp-alt-play');
    if (screen && screen.classList && !api.isReducedMotion()) { screen.classList.remove('bq5-is-entering'); screen.classList.add('bq5-is-entering'); }
    setTimerBar('#alt-timer', '#alt-time', msg.limitMs, msg.limitMs);
    startTick();
    api.text('#alt-live', 'Rodada ' + (msg.i + 1) + ' de ' + A.cfg.rounds + '. Escolha uma carta.');
  }

  function renderOppStatus() {
    var text = '';
    if (A.stage === 'round') text = A.oppAnswered ? K().oppName() + ' já respondeu.' : K().oppName() + ' ainda está pensando…';
    ui().text('#alt-opp-status', text);
  }

  function updateConfirm() {
    var button = ui().el('#alt-confirm');
    if (!button) return;
    if (A.stage === 'round') {
      if (A.myAnswered) { button.disabled = true; button.textContent = 'Aguardando o oponente…'; }
      else if (A.selCid == null) { button.disabled = true; button.textContent = 'Escolha uma carta'; }
      else { button.disabled = A.selChoice == null; button.textContent = 'Confirmar'; }
    } else if (A.stage === 'reveal') {
      var s = Math.max(0, Math.ceil((A.revealEnd - now()) / 1000));
      button.disabled = true;
      button.textContent = (A.over ? 'Resultado em ' : 'Próxima fase em ') + s + ' s';
    } else button.disabled = true;
  }

  function selectCard(cid) {
    if (A.stage !== 'round' || A.selCid != null || A.myAnswered) return false;
    var card = find(A.myHand, cid);
    if (!card) return false;
    var api = ui();
    A.selCid = cid;
    // as outras cartas somem para liberar espaço às alternativas
    api.hidden('#alt-hand-wrap', true);
    api.hidden('#alt-qwrap', false);
    api.text('#alt-card-theme', themeName(card.t));
    var themeNode = api.el('#alt-card-theme');
    if (themeNode) themeNode.setAttribute('data-theme', card.t || '');
    api.text('#alt-card-diff', difficultyLabel(card.d) + ' · dano ' + card.dmg);
    api.text('#alt-question', card.txt || '');
    api.all('.bq5-option', api.el('#alt-options')).forEach(function (button, index) {
      var text = button.querySelector('.bq5-option__text');
      var value = card.o[index] != null ? String(card.o[index]) : '';
      if (text) text.textContent = value;
      button.disabled = false;
      button.removeAttribute('data-state');
      button.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-label', OPTION_LABELS[index] + ': ' + value);
    });
    updateConfirm();
    api.text('#alt-live', 'Carta escolhida. Selecione uma alternativa e confirme.');
    return true;
  }

  function selectOption(index) {
    if (A.stage !== 'round' || A.selCid == null || A.myAnswered || !isInt(index) || index < 0 || index > 3) return false;
    A.selChoice = index;
    ui().all('.bq5-option', ui().el('#alt-options')).forEach(function (button, i) {
      if (i === index) { button.setAttribute('data-state', 'selected'); button.setAttribute('aria-pressed', 'true'); }
      else { button.removeAttribute('data-state'); button.setAttribute('aria-pressed', 'false'); }
    });
    updateConfirm();
    return true;
  }

  function submitMine(choice) {
    if (A.stage !== 'round' || A.myAnswered) return { ok: false };
    var cid = A.selCid;
    if (cid == null) choice = -1;
    var rem = Math.max(0, A.qEnd - now());
    A.myAnswered = true;
    ui().all('.bq5-option', ui().el('#alt-options')).forEach(function (button) { button.disabled = true; });
    ui().all('.bq5-altcard', ui().el('#alt-hand')).forEach(function (button) { button.disabled = true; });
    updateConfirm();
    ui().text('#alt-live', choice === -1 ? 'Tempo esgotado. Aguardando o oponente.' : 'Resposta enviada. Aguardando o oponente.');
    if (isHost()) hostRecord('host', cid, choice, rem);
    else K().send({ t: 'a:ans', i: A.round, cid: cid, choice: choice, rem: rem });
    return { ok: true };
  }

  function confirmAnswer() {
    if (A.stage !== 'round' || A.myAnswered || A.selCid == null || A.selChoice == null) return { ok: false };
    return submitMine(A.selChoice);
  }

  // ---------- cronômetro (sem pausa) ----------

  function startTick() {
    clearT('tick');
    var tick = function () {
      var t = now();
      if (A.stage === 'give' || A.stage === 'discard') {
        var left = Math.max(0, A.pickEnd - t);
        setTimerBar('#alt-pick-timer', '#alt-pick-time', left, A.pickMs);
        if (left <= 0 && A.pickChosen === undefined) choosePick(null);
      } else if (A.stage === 'round') {
        var rest = Math.max(0, A.qEnd - t);
        setTimerBar('#alt-timer', '#alt-time', rest, A.limitMs);
        if (rest <= 0 && !A.myAnswered) submitMine(-1);
      } else if (A.stage === 'reveal') {
        updateConfirm();
      } else {
        clearT('tick');
      }
    };
    tick();
    A.T.tick = global.setInterval(tick, 100);
  }

  // ---------- revelação, na ordem dos eventos ----------

  function eventText(ev) {
    var mine = ev.who === me();
    var who = mine ? 'Você' : K().oppName();
    var victim = mine ? K().oppName() : 'você';
    var card = ev.used ? ' (' + themeName(ev.t) + ' · ' + difficultyLabel(ev.d) + ')' : '';
    if (ev.ok) return who + ' acertou' + card + '! ' + (mine ? victim + ' perde ' : 'Você perde ') + ev.dmg + ' de HP.';
    if (!ev.used || ev.timedOut) return who + ' não respondeu a tempo. Nada acontece.';
    return who + ' errou' + card + '. Nada acontece.';
  }

  function showEvent(ev, hpTotals) {
    var api = ui();
    var list = api.el('#alt-events');
    var item = mk('li', 'bq5-altevent', eventText(ev));
    item.setAttribute('data-kind', ev.ok ? 'hit' : 'none');
    item.setAttribute('data-who', ev.who === me() ? 'me' : 'opp');
    list.appendChild(item);
    A.hp.restore(hpTotals);
    renderAllHp();
    api.emit('sfx:play', { cue: ev.who === me() ? (ev.ok ? 'correct' : 'wrong') : (ev.ok ? 'wrong' : 'correct') });
    api.text('#alt-live', item.textContent);
  }

  function applyReveal(msg) {
    if (A.stage !== 'round' || msg.i !== A.round || !Array.isArray(msg.events) || msg.events.length !== 2) return;
    var api = ui();
    clearT('tick');
    A.stage = 'reveal';
    A.myAnswered = true;
    A.over = msg.over || null;
    A.roundsDone = msg.i + 1;
    msg.events.forEach(function (ev) {
      A.logs[ev.who].push({ t: ev.t, d: ev.d, ok: ev.ok, timedOut: ev.timedOut, used: ev.used, dmg: ev.dmg });
    });
    // minha carta: mostra certo/errado nas alternativas
    var mineEv = msg.events.filter(function (ev) { return ev.who === me(); })[0];
    if (mineEv && mineEv.used) {
      api.all('.bq5-option', api.el('#alt-options')).forEach(function (button, index) {
        button.disabled = true;
        if (index === mineEv.a) button.setAttribute('data-state', 'correct');
        else if (index === mineEv.choice) button.setAttribute('data-state', 'wrong');
        else button.setAttribute('data-state', 'dimmed');
      });
    }
    api.hidden('#alt-events-wrap', false);
    clearNode(api.el('#alt-events'));
    A.revealEnd = now() + (isInt(msg.transitionMs) ? msg.transitionMs : A.cfg.transitionMs);
    renderOppStatus();
    updateConfirm();
    startTick();
    showEvent(msg.events[0], msg.events[0].hp);
    setT('seq', function () { showEvent(msg.events[1], msg.events[1].hp); }, isInt(msg.gapMs) ? msg.gapMs : A.cfg.eventGapMs);
  }

  // ---------- fim da partida ----------

  function tally(who) {
    var log = A.logs[who];
    var right = 0, wrong = 0, idle = 0, dmg = 0;
    var byTheme = {};
    log.forEach(function (e) {
      dmg += e.dmg || 0;
      if (!e.used) { idle++; return; }
      var t = e.t || '?';
      byTheme[t] = byTheme[t] || { right: 0, wrong: 0 };
      if (e.ok) { right++; byTheme[t].right++; }
      else { wrong++; byTheme[t].wrong++; }
    });
    function top(field) {
      var best = 0, names = [];
      Object.keys(byTheme).forEach(function (t) {
        var v = byTheme[t][field];
        if (v > best) { best = v; names = [t]; } else if (v === best && v > 0) names.push(t);
      });
      return best > 0 ? names.map(themeName).join(', ') + ' (' + best + ')' : '—';
    }
    return { right: right, wrong: wrong, idle: idle, dmg: dmg, mostRight: top('right'), mostWrong: top('wrong') };
  }

  function applyEnd(msg) {
    if (A.stage === 'end') return;
    clearAllT();
    var api = ui();
    if (msg.hp) A.hp.restore(msg.hp);
    A.stage = 'end';
    K().setPhase('ended');
    var outcome = msg.outcome === 'draw' ? 'draw' : (msg.outcome === me() ? 'win' : 'loss');
    A.outcome = outcome;
    var mine = tally(me()), theirs = tally(opp());
    A.summary = { mine: mine, theirs: theirs };

    var title = api.el('#alt-end-title');
    var text = outcome === 'win' ? 'Vitória' : (outcome === 'loss' ? 'Você perdeu' : 'Empate');
    if (title) { title.textContent = text; title.setAttribute('data-outcome', outcome); }
    var reason = msg.reason === 'quit' ? 'O duelo terminou por abandono.'
      : (msg.reason === 'hp' ? (outcome === 'draw' ? 'Os dois chegaram a zero de HP.' : (outcome === 'win' ? 'O HP do oponente chegou a zero.' : 'Seu HP chegou a zero.'))
        : (outcome === 'draw' ? 'HP igual após ' + A.cfg.rounds + ' rodadas.' : 'Maior HP após ' + A.cfg.rounds + ' rodadas.'));
    api.text('#alt-end-sub', reason);
    var hpLine = 'HP final: você ' + A.hp.get(me()) + ' × ' + A.hp.get(opp()) + ' ' + K().oppName();
    api.text('#alt-end-hp', hpLine);

    var box = api.el('#alt-end-summary');
    clearNode(box);
    [['Você', mine], [K().oppName(), theirs]].forEach(function (pair, idx) {
      var col = mk('section', 'bq5-altsum');
      col.setAttribute('data-who', idx === 0 ? 'me' : 'opp');
      col.appendChild(mk('h3', 'bq5-altsum__name', pair[0]));
      var dl = mk('dl', 'bq5-altsum__list');
      [['Acertos', pair[1].right], ['Erros', pair[1].wrong], ['Sem resposta', pair[1].idle], ['Dano causado', pair[1].dmg],
        ['Tema que mais acertou', pair[1].mostRight], ['Tema que mais errou', pair[1].mostWrong]].forEach(function (row) {
        var wrap = mk('div', 'bq5-altsum__row');
        wrap.appendChild(mk('dt', 'bq5-altsum__label', row[0]));
        wrap.appendChild(mk('dd', 'bq5-altsum__value bq5-num', row[1]));
        dl.appendChild(wrap);
      });
      col.appendChild(dl);
      box.appendChild(col);
    });

    A.rematch = { asked: false, closed: false, incoming: false };
    renderRematch('');
    api.hidden('#alt-end-ask', true);

    var total = A.logs.host.length;
    var result = {
      mode: '1x1', variant: 'alternative', variantLabel: 'Modo alternativo', theme: A.theme, diff: null,
      score: mine.dmg, right: mine.right, wrong: mine.wrong, total: total, review: [],
      outcome: outcome, playerId: 'me', winnerId: outcome === 'win' ? 'me' : (outcome === 'loss' ? 'opp' : null),
      players: [
        { id: 'me', name: K().meName() + ' (você)', score: A.hp.get(me()), right: mine.right, rank: outcome === 'loss' ? 2 : 1 },
        { id: 'opp', name: K().oppName(), score: A.hp.get(opp()), right: theirs.right, rank: outcome === 'win' ? 2 : 1 }
      ]
    };
    K().recordResult(result);
    api.emit('game:finished', result);
    api.showScreen('mp-alt-end', { history: false, clearHistory: true });
    api.text('#alt-live', text + '. ' + reason);
  }

  function renderRematch(note) {
    var api = ui();
    api.text('#alt-end-note', note || '');
    var button = api.el('#alt-end-rematch');
    if (button) button.disabled = !!(A.rematch.asked || A.rematch.closed);
  }

  // ---------- revanche ----------

  function showMsg(kind) {
    var api = ui();
    clearAllT();
    A.stage = 'msg';
    var go = kind === 'go';
    api.text('#alt-msg-title', go ? 'Simbora de novo!' : 'Ihhh, ele(a) fugiu!');
    api.text('#alt-msg-sub', go ? 'Preparando a nova partida…' : 'O oponente saiu da sala ou recusou a revanche.');
    api.hidden('#alt-msg-spinner', !go);
    api.hidden('#alt-msg-actions', go);
    var screen = api.el('#screen-mp-alt-msg');
    if (screen) screen.setAttribute('data-kind', go ? 'go' : 'fled');
    api.showScreen('mp-alt-msg', { history: false, clearHistory: true });
    if (go && isHost()) {
      setT('go', function () {
        var started = beginHost(A.theme);
        if (!started.ok) { ui().toast(started.message || 'Não foi possível reiniciar a partida.', 'error'); K().leaveToMenu(); }
      }, A.cfg.rematchMs);
    }
  }

  function askRematch() {
    if (A.stage !== 'end') return false;
    if (A.rematch.closed || !K().connected()) { ui().toast('O oponente saiu da sala.', 'info'); return false; }
    if (A.rematch.incoming) return acceptRematch();
    if (A.rematch.asked) return false;
    A.rematch.asked = true;
    K().send({ t: 'a:rematch-ask' });
    renderRematch('Revanche pedida. Aguardando o oponente…');
    return true;
  }

  function acceptRematch() {
    if (A.stage !== 'end' || !K().connected()) return false;
    K().send({ t: 'a:rematch-yes' });
    showMsg('go');
    return true;
  }

  function declineRematch() {
    if (A.stage !== 'end') return false;
    A.rematch.incoming = false;
    ui().hidden('#alt-end-ask', true);
    K().send({ t: 'a:rematch-no' });
    renderRematch('Você recusou a revanche.');
    return true;
  }

  function onRematchAsk() {
    if (A.stage !== 'end') return;
    if (A.rematch.asked) { K().send({ t: 'a:rematch-yes' }); showMsg('go'); return; }   // os dois pediram
    A.rematch.incoming = true;
    ui().text('#alt-end-ask-text', K().oppName() + ' quer a revanche!');
    ui().hidden('#alt-end-ask', false);
  }

  // ---------- ganchos chamados por local.js ----------

  function onMessage(msg) {
    var host = isHost();
    switch (msg.t) {
      case 'a:init': if (!host) applyInit(msg); break;
      case 'a:give':
        if (!host && Array.isArray(msg.cands)) uiPick('give', msg.cands, isInt(msg.ms) ? msg.ms : A.cfg.pickMs);
        break;
      case 'a:discard':
        if (!host && Array.isArray(msg.oppHand)) uiPick('discard', msg.oppHand, isInt(msg.ms) ? msg.ms : A.cfg.pickMs);
        break;
      case 'a:pick': if (host) onPick('guest', msg.kind, msg.cid); break;
      case 'a:round':
        if (!host && isInt(msg.i) && Array.isArray(msg.hand) && msg.hp) uiRound(msg);
        break;
      case 'a:ans':
        if (host && msg.i === A.round) {
          var choice = Number(msg.choice);
          if (choice === -1 || (isInt(choice) && choice >= 0 && choice <= 3)) {
            var rem = Number(msg.rem);
            hostRecord('guest', isInt(msg.cid) ? msg.cid : null, choice, isFinite(rem) ? Math.max(0, Math.min(A.cfg.limitMs, rem)) : 0);
          }
        }
        break;
      case 'a:opp': if (A.stage === 'round' && msg.i === A.round) { A.oppAnswered = true; renderOppStatus(); } break;
      case 'a:reveal': if (!host) applyReveal(msg); break;
      case 'a:end': if (!host) applyEnd(msg); break;
      case 'a:rematch-ask': onRematchAsk(); break;
      case 'a:rematch-yes': if (A.rematch.asked && A.stage === 'end') showMsg('go'); break;
      case 'a:rematch-no': if (A.rematch.asked) showMsg('fled'); break;
      default: break;
    }
  }

  // true = tratado aqui; false = local.js mostra o aviso padrão de conexão perdida
  function onClose(phase) {
    if (phase === 'playing') return false;
    if (A.stage === 'msg') { showMsg('fled'); return true; }
    if (A.stage === 'end') {
      A.rematch.closed = true;
      ui().hidden('#alt-end-ask', true);
      if (A.rematch.asked) showMsg('fled');
      else renderRematch('O oponente saiu da sala.');
      return true;
    }
    return false;
  }

  function finishLocal(outcome, reason) {
    clearAllT();
    var me0 = me();
    applyEnd({ outcome: outcome === 'draw' ? 'draw' : (outcome === 'win' ? me0 : other(me0)), reason: reason, hp: A.hp ? A.hp.snapshot() : null });
  }

  function onQuit() {
    if (A.roundsDone >= 1) {
      ui().toast(K().oppName() + ' saiu do duelo. Vitória por abandono.', 'info');
      finishLocal('win', 'quit');
    } else {
      ui().toast(K().oppName() + ' saiu do duelo antes da primeira rodada.', 'info');
      K().leaveToMenu();
    }
  }

  function quitMatch() {
    ui().openModal({
      title: 'Sair do duelo?',
      message: 'Sair conta como abandono: o oponente vence. Não existe pausa e o cronômetro continua correndo enquanto esta confirmação estiver aberta.',
      cancelLabel: 'Continuar jogando',
      confirmLabel: 'Sair do duelo',
      onConfirm: function () {
        if (A.stage !== 'round' && A.stage !== 'reveal' && A.stage !== 'give' && A.stage !== 'discard') return;
        K().send({ t: 'quit' });
        if (A.roundsDone >= 1) finishLocal('loss', 'quit'); else K().leaveToMenu();
      }
    });
  }

  function reset() {
    clearAllT();
    A = fresh();
  }

  // ---------- eventos de interface ----------

  function onCardClick(event, container, handler) {
    var target = event.target && event.target.nodeType === 3 ? event.target.parentElement : event.target;
    var button = target && target.closest ? target.closest('.bq5-altcard') : null;
    if (!button || button.disabled || !container.contains(button)) return;
    handler(Number(button.getAttribute('data-cid')));
  }

  function init() {
    var api = ui();
    if (!api || typeof api.onAction !== 'function') return;
    var pick = api.el('#alt-pick-cards');
    if (pick) pick.addEventListener('click', function (e) { onCardClick(e, pick, choosePick); });
    var hand = api.el('#alt-hand');
    if (hand) hand.addEventListener('click', function (e) { onCardClick(e, hand, selectCard); });
    var options = api.el('#alt-options');
    if (options) options.addEventListener('click', function (event) {
      var target = event.target && event.target.nodeType === 3 ? event.target.parentElement : event.target;
      var button = target && target.closest ? target.closest('.bq5-option[data-index]') : null;
      if (button && !button.disabled) selectOption(Number(button.getAttribute('data-index')));
    });
    api.onAction('mp-alt-confirm', confirmAnswer);
    api.onAction('mp-alt-quit', quitMatch);
    api.onAction('mp-alt-rematch', askRematch);
    api.onAction('mp-alt-accept', acceptRematch);
    api.onAction('mp-alt-decline', declineRematch);
    api.onAction('mp-alt-again', function () { K().newRoom(); });
    api.onAction('mp-alt-menu', function () { K().leaveToMenu(); });
  }

  var Alt = {
    id: 'alternative',
    describe: describe,
    params: params,
    hostStart: hostStart,
    onMessage: onMessage,
    onClose: onClose,
    onQuit: onQuit,
    reset: reset,
    state: function () {
      return {
        stage: A.stage, round: A.round, rounds: A.cfg.rounds,
        hp: A.hp ? A.hp.snapshot() : null,
        myHand: A.myHand.map(function (c) { return { cid: c.cid, t: c.t, d: c.d }; }),
        oppHand: A.oppHand.map(function (c) { return { cid: c.cid, t: c.t, d: c.d }; }),
        roundsDone: A.roundsDone, outcome: A.outcome || null, summary: A.summary, logs: A.logs
      };
    },
    // testes: atalhos que não existem para o jogador
    _selectCard: selectCard, _selectOption: selectOption, _confirm: confirmAnswer, _choosePick: choosePick
  };

  if (BQ5.screens && BQ5.screens.multiplayer && typeof BQ5.screens.multiplayer.registerVariant === 'function') {
    BQ5.screens.multiplayer.registerVariant('alternative', Alt);
    if (global.document) init();
  }
  BQ5.screens = BQ5.screens || {};
  BQ5.screens.multiplayerAlt = Alt;
})(globalThis);
