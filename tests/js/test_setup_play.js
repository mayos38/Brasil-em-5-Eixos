test('a intenção Solo abre o módulo 9', function () {
  __m9UI.emit('intent:solo', { source: 'menu' });
  assert(__m9CurrentScreen() === 'setup', 'tela setup não abriu');
  assert(BQ5.screens.setup.state().mode === 'solo', 'modalidade inicial não é solo');
});

test('eixos, dificuldade Geógrafo e modalidade futura são tratados dinamicamente', function () {
  assert(BQ5.screens.setup.state().maxCount > 0, 'não calculou disponibilidade inicial');
  assert(BQ5.screens.setup.select('diff', 'geografo') === true, 'não selecionou chave de dificuldade nova');
  assert(BQ5.screens.setup.select('theme', 'cultura') === true, 'não selecionou eixo Cultura');
  assert(BQ5.screens.setup.select('mode', 'campaign') === false, 'modalidade futura foi habilitada indevidamente');
  var state = BQ5.screens.setup.state();
  assert(state.diff === 'geografo' && state.theme === 'cultura', 'configuração não foi preservada');
  assert(state.maxCount === 5, 'limite não acompanhou o pool do eixo');
  assert(state.count <= state.maxCount, 'quantidade excede disponibilidade');
  assert(__m9UI.el('#setup-rules').textContent.indexOf('Não existe pausa') >= 0, 'regra de ausência de pausa não está clara');
});

test('bloqueia início quando config M5.6 exige timer por dificuldade mas engine antigo não expõe timeLimitMs', function () {
  var previous = BQ5.config.questionTimeMs;
  BQ5.config.questionTimeMs = { edu: 30000, normal: 20000, medio: 18000, dificil: 17000, geografo: 20000 };
  // Simula um "engine antigo": o guard do setup lê state().timeLimitMs; ocultamos
  // a propriedade no snapshot (o engine real M5.6 sempre a expõe).
  var prevState = BQ5.engine.state;
  BQ5.engine.state = function () { var s = prevState(); if (s) delete s.timeLimitMs; return s; };
  var result = BQ5.screens.setup.start();
  BQ5.engine.state = prevState;
  assert(result && result.code === 'ENGINE_TIMER_VERSION_MISMATCH', 'deveria sinalizar incompatibilidade de versão');
  assert(BQ5.engine.state() === null, 'partida incompatível não foi descartada');
  BQ5.config.questionTimeMs = previous;
});

test('início de partida usa o engine real e abre a tela de jogo', function () {
  BQ5.screens.setup.changeCount(-1);
  var started = BQ5.screens.setup.start();
  assert(started.ok, 'engine.start falhou');
  assert(__m9CurrentScreen() === 'play', 'tela play não abriu');
  assert(BQ5.engine.state() && BQ5.engine.state().mode === 'solo', 'engine não iniciou solo');
  assert(__m9UI.el('#play-question').textContent.indexOf('Questão') === 0, 'enunciado não foi apresentado');
  assert(__m9UI.el('#play-index').textContent === '1', 'indicador da primeira questão incorreto');
  assert(__m9UI.el('#play-total').textContent === '4', 'quantidade inicial não refletiu setup');
  assert(BQ5.screens.play.state().stage === 'choosing', 'estado inicial não é choosing');
});

test('seleção e confirmação travam respostas e exibem pontos/feedback', function () {
  var sounds = 0;
  var offSound = __m9UI.on('sfx:play', function (detail) { if (detail.cue === 'correct') sounds++; });
  var q = BQ5.engine.question();
  var option = __m9OptionsRoot.children[q.a];
  __m9OptionsRoot.fire('click', { target: option });
  assert(BQ5.screens.play.state().selectedChoice === q.a, 'opção não foi selecionada');
  assert(__m9UI.el('#play-next').disabled === false, 'confirmar não habilitou');
  __m9UI.emitAction('next', {});
  assert(BQ5.engine.state().locked === true, 'engine não travou a questão');
  assert(BQ5.screens.play.state().stage === 'revealed', 'estado não passou para revealed');
  assert(__m9UI.el('#play-feedback').hidden === false, 'feedback não apareceu');
  assert(__m9UI.el('#play-feedback').getAttribute('data-kind') === 'correct', 'feedback de acerto incorreto');
  assert(Number(BQ5.engine.state().score) > 0, 'pontuação não foi atualizada');
  assert(__m9OptionsRoot.children.every(function (node) { return node.disabled; }), 'alternativas não foram bloqueadas');
});

test('próxima pergunta renova apresentação e timeout é registrado uma única vez', function () {
  __m9UI.emitAction('next', {});
  assert(BQ5.engine.state().index === 1, 'não avançou para a segunda pergunta');
  assert(BQ5.screens.play.state().stage === 'choosing', 'nova pergunta não liberou seleção');
  // Esgota o prazo REAL da dificuldade em vigor (autoridade: engine M5.6);
  // +100ms para garantir remaining <= 0 independentemente do tier escolhido.
  globalThis.__m9Now += BQ5.engine.state().timeLimitMs + 100;
  var timerId = Number(Object.keys(__m9Timers)[0]);
  var callback = __m9Timers[timerId];
  assert(typeof callback === 'function', 'timer visual não está ativo');
  callback();
  assert(BQ5.engine.state().locked === true, 'timeout não bloqueou questão');
  assert(__m9UI.el('#play-feedback').getAttribute('data-kind') === 'timeout', 'feedback de timeout não apareceu');
  assert(__m9UI.el('#play-feedback-title').textContent === 'Tempo esgotado!', 'título de timeout incorreto');
  assert(BQ5.engine.review().length === 2, 'timeout não foi registrado exatamente uma vez');
  callback();
  assert(BQ5.engine.review().length === 2, 'timeout duplicou a resposta');
});

test('resposta errada tem feedback visual e personagem muda de humor', function () {
  __m9UI.emitAction('next', {});
  var q = BQ5.engine.question();
  var wrong = (q.a + 1) % 4;
  __m9OptionsRoot.fire('click', { target: __m9OptionsRoot.children[wrong] });
  __m9UI.emitAction('next', {});
  assert(__m9UI.el('#play-feedback').getAttribute('data-kind') === 'wrong', 'feedback de erro não apareceu');
  assert(__m9UI.el('#play-cast').getAttribute('data-mood') === 'sad', 'personagem não reagiu ao erro');
  assert(__m9UI.el('#play-feedback-points').textContent === '0 pontos', 'erro concedeu pontos');
});

test('sair abandona partida e não existe API/ação de pausa', function () {
  assert(typeof BQ5.screens.play.pause === 'undefined', 'API pause não deve existir');
  assert(typeof BQ5.screens.play.resume === 'undefined', 'API resume não deve existir');
  __m9UI.emitAction('next', {});
  assert(BQ5.screens.play.state().stage === 'choosing', 'precisava estar em questão ativa');
  __m9UI.emitAction('quit-game', {});
  var modal = __m9LastModal();
  assert(modal && typeof modal.onConfirm === 'function', 'confirmação de saída não abriu');
  assert(BQ5.screens.play.state().timerActive === true, 'modal interrompeu o timer');
  modal.onConfirm();
  assert(BQ5.engine.state() === null, 'engine não descartou a partida ao sair');
  assert(__m9CurrentScreen() === 'menu', 'não retornou ao menu');
  assert(BQ5.screens.play.state().timerActive === false, 'timer ficou ativo após abandono');
});
