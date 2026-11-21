'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const context = { console, Math, Date, JSON, Number, String, Array, Object, isFinite };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/systems/hp.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/multiplayer/duel-engine.js'), 'utf8'), context);
const duel = context.BQ5.multiplayer.duel;
{
  const withoutHp = { ...context, BQ5: { bank: {} } };
  withoutHp.globalThis = withoutHp;
  vm.createContext(withoutHp);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/multiplayer/duel-engine.js'), 'utf8'), withoutHp);
  const unavailable = withoutHp.BQ5.multiplayer.duel.create({ questions: [{ id: 1, theme: 'cultura', difficulty: 1, options: ['A','B','C','D'], answer: 0 }, { id: 2, theme: 'cultura', difficulty: 1, options: ['A','B','C','D'], answer: 0 }] });
  assert.equal(unavailable.code, 'HP_MODULE_UNAVAILABLE');
}

const questions = Array.from({ length: 36 }, (_, id) => ({
  id,
  theme: ['cultura', 'economia', 'animais', 'vegetacao', 'cidades'][id % 5],
  difficulty: (id % 4) + 1,
  region: 'sudeste',
  question: `Pergunta ${id}`,
  options: ['A', 'B', 'C', 'D'],
  answer: id % 4,
  explanation: `Explicação ${id}`
}));
let seed = 0x12345678;
function random() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0x100000000;
}
function makeGame(options = {}) {
  const created = duel.create({
    questions,
    random,
    player1Name: 'Ana',
    player2Name: 'Beto',
    ...options
  });
  assert.equal(created.ok, true, created.message);
  return created.game;
}
function prepare(g) {
  let p1 = g.viewFor('p1');
  let p2 = g.viewFor('p2');
  assert.equal(p1.self.hand.length, 2);
  assert.equal(p2.self.hand.length, 2);
  assert.equal(p1.self.hp, 1000);
  assert.equal(p1.self.hpRatio, 1);
  assert.equal(p2.opponent.hpMax, 1000);
  const gift1 = p1.self.hand[0].cardId;
  const gift2 = p2.self.hand[0].cardId;
  assert.equal(g.submitGift('p1', gift1).ok, true);
  assert.equal(g.submitGift('p2', gift2).ok, true);
  assert.equal(g.phase(), 'discard');
  assert.equal(g.viewFor('p1').self.hand.length, 3);
  assert.equal(g.viewFor('p2').self.hand.length, 3);
}
function playOneRound(g, answerMode) {
  let p1 = g.viewFor('p1');
  let p2 = g.viewFor('p2');
  assert.equal(p1.phase, 'discard');
  assert.equal(g.submitDiscard('p1', p1.opponent.hand[0].cardId).ok, true);
  assert.equal(g.submitDiscard('p2', p2.opponent.hand[0].cardId).ok, true);
  p1 = g.viewFor('p1'); p2 = g.viewFor('p2');
  assert.equal(p1.self.hand.length, 3);
  assert.equal(p2.self.hand.length, 3);
  assert.equal(g.phase(), 'choose-question');
  const c1 = p1.self.hand[0].cardId;
  const c2 = p2.self.hand[0].cardId;
  g.submitQuestion('p1', c1);
  g.submitQuestion('p2', c2);
  assert.equal(g.phase(), 'answer');
  const q1 = g.questionFor('p1');
  const q2 = g.questionFor('p2');
  const a1 = (answerMode === 'correct' || answerMode === 'both-correct') ? questions.find(q => q.id === q1.questionId).answer : (questions.find(q => q.id === q1.questionId).answer + 1) % 4;
  const a2 = answerMode === 'both-correct' ? questions.find(q => q.id === q2.questionId).answer : (questions.find(q => q.id === q2.questionId).answer + 1) % 4;
  g.submitAnswer('p1', a1);
  g.submitAnswer('p2', a2);
  const resolution = g.resolveRound();
  resolution.testQuestionIds = [q1.questionId, q2.questionId];
  return resolution;
}

// Initial preparation: 2 cards + one copied gift = 3 per player; no initial discard.
{
  const g = makeGame();
  const before1 = g.viewFor('p1').self.hand.map(c => c.cardId);
  const before2 = g.viewFor('p2').self.hand.map(c => c.cardId);
  assert.equal(g.viewFor('p1').opponent.hand[0].question, undefined, 'opponent view must not expose question text');
  assert.equal(g.viewFor('p1').opponent.hand[0].answer, undefined, 'opponent view must not expose answer');
  prepare(g);
  const after1 = g.viewFor('p1').self.hand.map(c => c.cardId);
  const after2 = g.viewFor('p2').self.hand.map(c => c.cardId);
  assert.equal(after1.length, 3);
  assert.equal(after2.length, 3);
  assert.ok(before1.every(id => after1.includes(id)), 'gifted card remains with original owner');
  assert.ok(before2.every(id => after2.includes(id)), 'gifted card remains with original owner');
}

// Theme filtering applies to initial draws, gifts, discards and replacements.
{
  const g = makeGame({ theme: 'animais' });
  prepare(g);
  playOneRound(g, 'wrong');
  for (const id of ['p1', 'p2']) {
    const v = g.viewFor(id);
    assert.equal(v.self.hand.length, 3);
    assert.ok(v.self.hand.every(c => c.theme === 'animais'));
  }
}

// A selected question stays private to its owner, and the first answer is immutable.
{
  const g = makeGame();
  prepare(g);
  let p1 = g.viewFor('p1'), p2 = g.viewFor('p2');
  g.submitDiscard('p1', p1.opponent.hand[0].cardId);
  g.submitDiscard('p2', p2.opponent.hand[0].cardId);
  p1 = g.viewFor('p1'); p2 = g.viewFor('p2');
  const selected1 = p1.self.hand[0].cardId;
  const selected2 = p2.self.hand[0].cardId;
  g.submitQuestion('p1', selected1);
  assert.ok(g.questionFor('p1'), 'the selecting player receives their prompt');
  assert.equal(g.questionFor('p2'), null, 'the other player does not receive the prompt');
  assert.equal(g.viewFor('p2').opponent.hand[0].question, undefined, 'opponent cards expose metadata only');
  g.submitQuestion('p2', selected2);
  const q1 = g.questionFor('p1');
  const correct = questions.find(q => q.id === q1.questionId).answer;
  assert.equal(g.submitAnswer('p1', correct).ok, true);
  const locked = g.submitAnswer('p1', (correct + 1) % 4);
  assert.equal(locked.ok, false);
  assert.equal(locked.code, 'ALREADY_SUBMITTED', 'a submitted answer cannot be changed');
  assert.equal(g.resolveRound().code, 'WAITING_FOR_PLAYER', 'one answer cannot resolve the round alone');
  const q2 = g.questionFor('p2');
  const wrong = (questions.find(q => q.id === q2.questionId).answer + 1) % 4;
  assert.equal(g.submitAnswer('p2', wrong).ok, true);
  assert.equal(g.resolveRound().ok, true);
}

// Both answers are resolved together; correct answer deals difficulty-based damage independent of speed.
{
  const g = makeGame();
  prepare(g);
  const result = playOneRound(g, 'correct');
  assert.equal(result.ok, true);
  assert.equal(g.phase(), 'transition');
  const players = Object.fromEntries(g.players().map(p => [p.id, p]));
  assert.equal(players.p1.hp, 1000, 'p2 errou, então p1 não recebe dano');
  assert.equal(players.p1.hpMax, 1000);
  assert.equal(players.p1.hpRatio, 1);
  assert.equal(players.p2.hp, 1000 - duel.config().damageByDifficulty[questions.find(q => q.id === result.testQuestionIds[0]).difficulty], 'p1 acertou e causa dano a p2');
  assert.equal(players.p2.hpRatio, players.p2.hp / players.p2.hpMax);
  assert.equal(g.viewFor('p1').self.hand.length, 3, 'answered card replaced');
  assert.equal(g.viewFor('p2').self.hand.length, 3, 'answered card replaced');
}

// Timeout causes no damage and retains the unanswered card; the answered card is consumed.
{
  const g = makeGame();
  prepare(g);
  let p1 = g.viewFor('p1'), p2 = g.viewFor('p2');
  g.submitDiscard('p1', p1.opponent.hand[0].cardId);
  g.submitDiscard('p2', p2.opponent.hand[0].cardId);
  p1 = g.viewFor('p1'); p2 = g.viewFor('p2');
  const selected1 = p1.self.hand[0].cardId;
  const selected2 = p2.self.hand[0].cardId;
  g.submitQuestion('p1', selected1);
  g.submitQuestion('p2', selected2);
  const q1 = g.questionFor('p1');
  g.submitAnswer('p1', questions.find(q => q.id === q1.questionId).answer);
  const result = g.expireAnswers();
  assert.equal(result.ok, true);
  assert.ok(g.players().find(p => p.id === 'p1').damage > 0, 'a resposta correta de p1 ainda causa dano');
  assert.equal(g.players().find(p => p.id === 'p2').damage, 0, 'o timeout de p2 não causa dano');
  const p1After = g.viewFor('p1').self.hand.map(c => c.cardId);
  const p2After = g.viewFor('p2').self.hand.map(c => c.cardId);
  assert.ok(!p1After.includes(selected1), 'answered card should be consumed');
  assert.ok(p2After.includes(selected2), 'timed-out card should remain');
}

// Fifteen rounds with zero-damage test configuration end in a tie at equal HP.
{
  const g = makeGame({ damageByDifficulty: { 1: 0, 2: 0, 3: 0, 4: 0 } });
  prepare(g);
  let last;
  for (let round = 1; round <= 15; round++) {
    last = playOneRound(g, 'wrong');
    if (round < 15) {
      assert.equal(g.phase(), 'transition');
      assert.equal(g.nextRound().ok, true);
    }
  }
  assert.equal(last.phase, 'finished');
  assert.equal(last.outcome, 'draw');
  assert.equal(g.resultFor('p1').outcome, 'draw');
  assert.equal(g.resultFor('p2').outcome, 'draw');
}

// Double knockout is resolved as a draw; both devices receive M11-compatible review data.
{
  const g = makeGame({ damageByDifficulty: { 1: 175, 2: 175, 3: 175, 4: 175 } });
  prepare(g);
  let last;
  for (let round = 1; round <= 6 && g.phase() !== 'finished'; round++) {
    last = playOneRound(g, 'both-correct');
    if (g.phase() === 'transition') g.nextRound();
  }
  assert.equal(g.phase(), 'finished');
  assert.equal(last.outcome, 'draw', 'duplo zero na mesma resolução precisa empatar');
  for (const id of ['p1', 'p2']) {
    const result = g.resultFor(id);
    assert.equal(result.mode, '1v1');
    assert.equal(result.outcome, 'draw');
    assert.equal(result.score, 0);
    assert.equal(result.players.length, 2);
    assert.equal(result.review.length, 6);
    assert.ok(result.review.every(entry => entry.q && Array.isArray(entry.q.o) && Number.isInteger(entry.q.a)));
  }
}

console.log('M13 duel-engine: todos os testes passaram.');
