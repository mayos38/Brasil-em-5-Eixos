test('BQ5.ui publica as funções centrais esperadas', function () {
  assert(BQ5.ui && typeof BQ5.ui.init === 'function', 'ui.init ausente');
  assert(typeof BQ5.ui.onAction === 'function', 'onAction ausente');
  assert(typeof BQ5.ui.showScreen === 'function', 'showScreen ausente');
  assert(typeof BQ5.ui.openModal === 'function', 'openModal ausente');
  assert(typeof BQ5.ui.toast === 'function', 'toast ausente');
});

test('barramento de eventos retorna quantidade de ouvintes e permite remover', function () {
  var hits = 0;
  var off = BQ5.ui.on('test:ui-event', function (detail) {
    if (detail.value === 7) hits++;
  });
  assert(BQ5.ui.emit('test:ui-event', { value: 7 }) === 1, 'evento não foi entregue');
  assert(hits === 1, 'handler não executado');
  off();
  assert(BQ5.ui.emit('test:ui-event', { value: 7 }) === 0, 'unsubscribe não removeu handler');
});

test('menu registra a intenção de iniciar modo solo sem assumir o módulo 9', function () {
  var hits = 0;
  BQ5.ui.on('intent:solo', function (detail) {
    if (detail.source === 'menu') hits++;
  });
  BQ5.ui.emit('action:go-solo', {});
  assert(hits === 1, 'intenção solo não chegou ao barramento');
});

test('menu registra a intenção de abrir campanha sem assumir o módulo 12', function () {
  var hits = 0;
  BQ5.ui.on('intent:campaign', function (detail) {
    if (detail.source === 'menu') hits++;
  });
  BQ5.ui.emit('action:go-campaign', {});
  assert(hits === 1, 'intenção de campanha não chegou ao barramento');
});

test('menu lê recorde, progresso e quantidade do banco pelas APIs existentes', function () {
  BQ5.storage.recordSoloScore(135);
  BQ5.storage.completeStage('norte', 80);
  BQ5.storage.completeStage('sul', 60);
  BQ5.bank.count = function () { return 508; };
  BQ5.bank.loaded = function () { return true; };

  var result = BQ5.screens.menu.render();
  assert(result.ok === true, 'render falhou');
  assert(result.profile.playerName === 'Explorador', 'identidade inicial inesperada');
  assert(result.profile.bestSolo === 135, 'recorde solo não foi lido');
  assert(result.profile.stagesDone === 2, 'progresso não foi lido');
  assert(result.profile.stagesTotal === 5, 'total de etapas não veio de config');
  assert(result.profile.bankCount === 508 && result.profile.bankLoaded, 'contagem do banco não foi lida dinamicamente');
});

test('preferência de movimento reduzido é limitada ao estado da sessão', function () {
  assert(BQ5.ui.setReducedMotion(true) === true, 'não foi possível ativar');
  assert(BQ5.ui.isReducedMotion() === true, 'estado ativo não foi lido');
  assert(BQ5.ui.setReducedMotion(false) === true, 'não foi possível desativar');
  assert(BQ5.ui.isReducedMotion() === false, 'estado não foi removido');
});

test('showScreen controla tela única, atributo global e evento de mudança', function () {
  var changes = 0;
  BQ5.ui.on('screen:change', function (detail) {
    if (detail.to === 'menu') changes++;
  });
  var result = BQ5.ui.showScreen('menu', { history: false });
  assert(result.ok === true, 'não abriu menu');
  assert(document.querySelector('#bq5-app').getAttribute('data-screen') === 'menu', 'data-screen não atualizou');
  assert(document.querySelector('#screen-menu').hidden === false, 'menu permanece oculto');
  assert(document.querySelector('#screen-boot').hidden === true, 'boot não foi ocultado');
  assert(changes === 1, 'evento screen:change não foi disparado');
});
