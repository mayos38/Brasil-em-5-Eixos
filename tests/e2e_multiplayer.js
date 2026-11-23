'use strict';
/*
 * Teste ponta a ponta do Módulo 13 (Multiplayer 1x1 — modo clássico).
 * Abre DOIS contextos de navegador independentes (Chromium via Playwright) e liga
 * os dois por WebRTC real, trocando os códigos exatamente como os jogadores fariam.
 *
 * Uso (na raiz do projeto):
 *   python -m http.server 8765        # em outro terminal
 *   NODE_PATH=<pasta dos node_modules com playwright> node tests/e2e_multiplayer.js
 *
 * Variáveis: BQ5_URL (padrão http://localhost:8765/dev/integrated-preview.html)
 * O teste encurta o tempo de pergunta/revelação só para não demorar.
 */
const { chromium } = require('playwright');

const URL = process.env.BQ5_URL || 'http://localhost:8765/dev/integrated-preview.html';
let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('PASS ' + name); }
  else { failed++; console.log('FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}

const FAST = { limitMs: 4000, revealMs: 700, graceMs: 1000 };

async function newPlayer(browser, name) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { failed++; console.log('FAIL pageerror[' + name + '] ' + e.message); });
  await page.goto(URL);
  await page.waitForFunction(() => window.BQ5 && BQ5.ui && BQ5.ui.currentScreen() === 'menu', null, { timeout: 20000 });
  await page.evaluate((fast) => { BQ5.config.multiplayer = { classic: fast }; }, FAST);
  return page;
}

const screen = (page) => page.evaluate(() => BQ5.ui.currentScreen());
const waitScreen = (page, name, timeout) => page.waitForFunction((n) => BQ5.ui.currentScreen() === n, name, { timeout: timeout || 15000 });
const mp = (page) => page.evaluate(() => BQ5.screens.multiplayer.state());

async function connect(host, guest, theme) {
  await host.click('[data-action="go-multiplayer"]');
  await waitScreen(host, 'mp-mode');
  await guest.click('[data-action="go-multiplayer"]');
  await waitScreen(guest, 'mp-mode');
  await host.click('[data-action="mp-pick-mode"][data-value="classic"]');
  await guest.click('[data-action="mp-pick-mode"][data-value="classic"]');
  await waitScreen(host, 'mp-setup'); await waitScreen(guest, 'mp-setup');
  await host.fill('#mp-nick', 'Ana');
  await guest.fill('#mp-nick', 'Bruno');
  await host.click('#mp-role [data-value="host"]');
  await host.waitForFunction(() => document.querySelector('#mp-host-code').value.startsWith('BQ5-'), null, { timeout: 15000 });
  const offer = await host.inputValue('#mp-host-code');
  await guest.click('#mp-role [data-value="join"]');
  await guest.fill('#mp-join-offer', offer);
  await guest.click('#mp-join-go');
  await guest.waitForFunction(() => document.querySelector('#mp-join-code').value.startsWith('BQ5-'), null, { timeout: 15000 });
  const answer = await guest.inputValue('#mp-join-code');
  await host.fill('#mp-host-answer', answer);
  await host.click('#mp-host-connect');
  await waitScreen(host, 'mp-theme', 20000);
  await waitScreen(guest, 'mp-wait', 20000);
  return { offer, answer };
}

// política: 'right' | 'wrong' | 'none' (deixa o tempo esgotar)
async function runPlayer(page, policy) {
  let last = '';
  for (let guard = 0; guard < 4000; guard++) {
    const s = await screen(page);
    if (s === 'results') return;
    if (s === 'mp-play') {
      const st = await page.evaluate(() => ({
        q: document.querySelector('#mp-question').textContent,
        enabled: !document.querySelector('#mp-options .bq5-option').disabled
      }));
      if (st.q !== last && st.enabled) {
        last = st.q;
        if (policy !== 'none') {
          const idx = await page.evaluate((pol) => {
            const q = BQ5.bank.list().find((x) => x.question === document.querySelector('#mp-question').textContent);
            const texts = Array.from(document.querySelectorAll('#mp-options .bq5-option__text')).map((n) => n.textContent);
            const right = texts.indexOf(q.options[q.answer]);
            return pol === 'right' ? right : (right + 1) % 4;
          }, policy);
          await page.click('#mp-options .bq5-option[data-index="' + idx + '"]');
          await page.click('#mp-confirm');
        }
      }
    }
    await page.waitForTimeout(40);
  }
  throw new Error('runPlayer: laço não terminou');
}

const title = (page) => page.textContent('#results-title');
const closeAll = async (...pages) => { for (const p of pages) { try { await p.context().close(); } catch (e) {} } };

(async () => {
  const browser = await chromium.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
  try {
    // ---------- 1. interface do menu e escolha de modo ----------
    {
      const p = await newPlayer(browser, 'solo');
      const menuText = await p.textContent('#screen-menu .bq5-menu');
      check('menu: "Sala com amigos" foi substituída por "Multiplayer 1x1"', /Multiplayer 1x1/.test(menuText) && !/Sala com amigos/.test(menuText));
      await p.click('[data-action="go-multiplayer"]');
      await waitScreen(p, 'mp-mode');
      const choices = await p.$$eval('#screen-mp-mode .bq5-mpmode', (els) => els.map((e) => ({ t: e.querySelector('.bq5-mpmode__title').textContent.trim(), d: e.disabled, text: e.querySelector('.bq5-mpmode__text').textContent })));
      check('modo: apenas duas opções (clássico e alternativo)', choices.length === 2, choices);
      check('modo: clássico habilitado e com descrição', !choices[0].d && /\d+ s cada/.test(choices[0].text) && /10 acertos/.test(choices[0].text) && /15 rodadas/.test(choices[0].text), choices[0]);
      check('modo: alternativo habilitado (implementado; coberto por e2e_alt.js)', choices[1].d === false && /HP/.test(choices[1].text), choices[1]);
      await p.click('[data-action="mp-pick-mode"][data-value="classic"]');
      await waitScreen(p, 'mp-setup');
      const lead = await p.textContent('#mp-setup-lead');
      check('criação: há descrição do que fazer na tela', /Wi-Fi/.test(lead) && /código/.test(lead), lead);
      await p.click('#mp-role [data-value="join"]');
      await p.fill('#mp-join-offer', 'lixo');
      await p.click('#mp-join-go');
      await p.waitForFunction(() => /inválido/i.test(document.querySelector('#mp-status').textContent));
      check('criação: código inválido mostra erro claro', true);
      await p.click('#mp-role [data-value="host"]');
      await p.waitForFunction(() => document.querySelector('#mp-host-code').value.startsWith('BQ5-'), null, { timeout: 15000 });
      await p.fill('#mp-host-answer', await p.inputValue('#mp-host-code'));
      await p.click('#mp-host-connect');
      await p.waitForFunction(() => /código da sala/i.test(document.querySelector('#mp-status').textContent) && document.querySelector('#mp-status').getAttribute('data-kind') === 'error', null, { timeout: 5000 });
      check('criação: colar o código da sala no lugar da resposta é rejeitado', true);
      await p.goBack().catch(() => {});
      await closeAll(p);
    }

    // ---------- 2. partida: anfitrião vence com 10 acertos primeiro ----------
    {
      const host = await newPlayer(browser, 'host');
      const guest = await newPlayer(browser, 'guest');
      const { offer, answer } = await connect(host, guest);
      check('códigos: formato BQ5-O/BQ5-A e curtos', /^BQ5-O-/.test(offer) && /^BQ5-A-/.test(answer) && offer.length < 2500 && answer.length < 2500, [offer.length, answer.length]);
      const themeTitle = await host.textContent('#mp-theme-title');
      check('anfitrião vê a tela de escolha de tema', /tema/i.test(themeTitle));
      const waitTitle = await guest.textContent('#mp-wait-title');
      check('convidado vê "Aguardando criação de partida"', /Aguardando criação de partida/.test(waitTitle), waitTitle);
      const themes = await host.$$eval('#mp-themes .bq5-choice', (els) => els.map((e) => e.getAttribute('data-value')));
      check('tema: aleatório + cinco eixos', themes.length === 6 && themes[0] === 'all', themes);
      await host.click('#mp-themes [data-value="animais"]');
      await host.click('#mp-start');
      await waitScreen(host, 'mp-play'); await waitScreen(guest, 'mp-play');
      const hud = await host.evaluate(() => ({ total: document.querySelector('#mp-total').textContent, target: document.querySelector('#mp-target').textContent, me: document.querySelector('#mp-name-me').textContent, opp: document.querySelector('#mp-name-opp').textContent }));
      check('HUD: 15 rodadas, meta 10 e nomes', hud.total === '15' && hud.target === '10' && hud.opp === 'Bruno', hud);
      const themeTags = new Set();
      // observa o tema das perguntas durante a partida
      const watch = async (page) => { for (let k = 0; k < 600; k++) { const s = await screen(page); if (s !== 'mp-play') return; const t = await page.evaluate(() => document.querySelector('#mp-tag-theme').getAttribute('data-theme')); if (t) themeTags.add(t); await page.waitForTimeout(100); } };
      const w = watch(guest);
      // verifica que o placar só muda quando as duas respostas chegam
      const firstQuestion = await host.textContent('#mp-question');
      await host.evaluate(() => { const q = BQ5.bank.list().find((x) => x.question === document.querySelector('#mp-question').textContent); const t = Array.from(document.querySelectorAll('#mp-options .bq5-option__text')).map((n) => n.textContent); document.querySelector('#mp-options .bq5-option[data-index="' + t.indexOf(q.options[q.answer]) + '"]').click(); document.querySelector('#mp-confirm').click(); });
      await host.waitForFunction(() => document.querySelector('#mp-confirm').textContent.includes('Aguardando'));
      const optsLocked = await host.$$eval('#mp-options .bq5-option', (els) => els.every((e) => e.disabled));
      const scoreBefore = await host.textContent('#mp-score');
      check('respondeu: alternativas travadas e aguarda o oponente', optsLocked);
      check('placar não muda antes de receber as duas respostas', scoreBefore.replace(/\s/g, '') === '0×0', scoreBefore);
      await guest.waitForFunction(() => /já respondeu/.test(document.querySelector('#mp-opp-status').textContent));
      check('convidado é avisado de que o oponente já respondeu', true);
      const t0 = Date.now();
      await guest.evaluate(() => { const q = BQ5.bank.list().find((x) => x.question === document.querySelector('#mp-question').textContent); const t = Array.from(document.querySelectorAll('#mp-options .bq5-option__text')).map((n) => n.textContent); document.querySelector('#mp-options .bq5-option[data-index="' + ((t.indexOf(q.options[q.answer]) + 1) % 4) + '"]').click(); document.querySelector('#mp-confirm').click(); });
      await host.waitForFunction(() => document.querySelector('#mp-score').textContent.replace(/\s/g, '') === '1×0', null, { timeout: 3000 });
      check('rodada encerra assim que os dois respondem (sem esperar o tempo)', Date.now() - t0 < 2500, Date.now() - t0);
      await guest.waitForFunction(() => document.querySelector('#mp-score').textContent.replace(/\s/g, '') === '0×1', null, { timeout: 3000 });
      check('placar de acertos aparece para ambos (cada um do seu ponto de vista)', true);
      const fb = await guest.textContent('#mp-feedback-text');
      check('feedback mostra a explicação e o resultado do oponente', /Ana (acertou|errou)/.test(fb) && /Resposta correta:/.test(fb), fb);
      // próximas rodadas: anfitrião sempre certo; convidado sempre errado
      await Promise.all([runPlayer(host, 'right'), runPlayer(guest, 'wrong'), w]);
      await waitScreen(host, 'results'); await waitScreen(guest, 'results');
      check('resultado anfitrião: Vitória', (await title(host)) === 'Vitória', await title(host));
      check('resultado convidado: Você perdeu', (await title(guest)) === 'Você perdeu', await title(guest));
      const hs = await mp(host);
      check('vitória ao atingir 10 acertos (rodada 10, não 15)', hs.right.me === 10 && hs.right.opp === 0 && hs.rounds === 10, hs);
      check('tema escolhido (Animais) respeitado em todas as perguntas', themeTags.size >= 1 && [...themeTags].every((t) => t === 'animais'), [...themeTags]);
      const rr = await host.evaluate(() => ({ right: document.querySelector('#results-right').textContent, total: document.querySelector('#results-total').textContent, ctx: document.querySelector('#results-context').textContent, rank: document.querySelector('#results-ranking').textContent, review: document.querySelectorAll('#results-review .bq5-review').length }));
      check('resultados: acertos/total, contexto 1x1 e classificação', rr.right === '10' && rr.total === '10' && /Confronto 1x1/.test(rr.ctx) && /Modo clássico/.test(rr.ctx) && /Bruno/.test(rr.rank) && rr.review === 10, rr);
      const hist = await host.evaluate(() => BQ5.screens.results.getHistory(5));
      const histG = await guest.evaluate(() => BQ5.screens.results.getHistory(5));
      check('perfil/histórico: partida registrada com desfecho (host=win)', hist.length === 1 && hist[0].mode === '1x1' && hist[0].outcome === 'win' && hist[0].variant === 'classic', hist);
      check('perfil/histórico: convidado registra derrota', histG.length === 1 && histG[0].outcome === 'loss', histG);
      // ---------- revanche ----------
      await guest.click('#results-replay');
      await host.waitForFunction(() => document.querySelector('#bq5-toast-root').textContent.includes('quer jogar de novo'), null, { timeout: 3000 });
      check('convidado pede revanche e o anfitrião é avisado', true);
      await host.click('#results-replay');
      await waitScreen(host, 'mp-theme'); await waitScreen(guest, 'mp-wait');
      check('revanche: anfitrião escolhe tema de novo, convidado aguarda', true);
      await host.click('#mp-themes [data-value="all"]');
      await host.click('#mp-start');
      await waitScreen(host, 'mp-play'); await waitScreen(guest, 'mp-play');
      const themes2 = new Set();
      const w2 = (async () => { for (let k = 0; k < 800; k++) { if ((await screen(host)) !== 'mp-play') return; const t = await host.evaluate(() => document.querySelector('#mp-tag-theme').getAttribute('data-theme')); if (t) themes2.add(t); await host.waitForTimeout(60); } })();
      // ---------- empate: os dois sempre acertam => 10 na mesma rodada ----------
      await Promise.all([runPlayer(host, 'right'), runPlayer(guest, 'right'), w2]);
      await waitScreen(host, 'results'); await waitScreen(guest, 'results');
      check('empate: 10 acertos na mesma rodada => "Empate" nos dois', (await title(host)) === 'Empate' && (await title(guest)) === 'Empate', [await title(host), await title(guest)]);
      check('tema aleatório sorteou temas variados', themes2.size >= 2, [...themes2]);
      const histD = await host.evaluate(() => BQ5.screens.results.getHistory(5));
      check('histórico registra empate (2 partidas no total)', histD.length === 2 && histD[0].outcome === 'draw', histD.map((h) => h.outcome));
      await host.click('#results-menu');
      await waitScreen(host, 'menu');
      await guest.waitForFunction(() => BQ5.screens.multiplayer.state().connected === false || true);
      const gs = await mp(guest);
      await guest.click('#results-replay');
      await guest.waitForFunction(() => BQ5.ui.currentScreen() === 'mp-setup', null, { timeout: 8000 });
      check('conexão encerrada: "Jogar de novo" leva à criação de nova sala', true, gs);
      await closeAll(host, guest);
    }

    // ---------- 3. tempo esgotado + 15 rodadas decididas por mais acertos ----------
    {
      const host = await newPlayer(browser, 'host');
      const guest = await newPlayer(browser, 'guest');
      await connect(host, guest);
      await host.click('#mp-themes [data-value="cidades"]');
      await host.click('#mp-start');
      await waitScreen(host, 'mp-play'); await waitScreen(guest, 'mp-play');
      // rodada 1: convidado deixa o tempo esgotar, anfitrião acerta
      await host.evaluate(() => { const q = BQ5.bank.list().find((x) => x.question === document.querySelector('#mp-question').textContent); const t = Array.from(document.querySelectorAll('#mp-options .bq5-option__text')).map((n) => n.textContent); document.querySelector('#mp-options .bq5-option[data-index="' + t.indexOf(q.options[q.answer]) + '"]').click(); document.querySelector('#mp-confirm').click(); });
      const t0 = Date.now();
      await host.waitForFunction(() => document.querySelector('#mp-feedback-title').textContent !== '', null, { timeout: 9000 });
      const waited = Date.now() - t0;
      check('tempo esgotado do oponente fecha a rodada (~4 s configurados)', waited >= 2500 && waited < 8000, waited);
      const fbG = await guest.textContent('#mp-feedback-title');
      check('convidado vê "Tempo esgotado!"', fbG === 'Tempo esgotado!', fbG);
      const sc = await host.textContent('#mp-score');
      check('placar após timeout: 1 x 0', sc.replace(/\s/g, '') === '1×0', sc);
      // restante: ninguém acerta mais => nenhum chega a 10 => 15 rodadas, anfitrião vence por 1 x 0
      // (política "wrong" em ambos para ser rápido)
      await Promise.all([runPlayer(host, 'wrong'), runPlayer(guest, 'wrong')]);
      await waitScreen(host, 'results'); await waitScreen(guest, 'results');
      const hs = await mp(host);
      check('após 15 rodadas vence quem tem mais acertos (1 x 0)', hs.rounds === 15 && hs.right.me === 1 && hs.right.opp === 0, hs);
      check('resultado 15 rodadas: Vitória / Você perdeu', (await title(host)) === 'Vitória' && (await title(guest)) === 'Você perdeu', [await title(host), await title(guest)]);
      const total = await host.textContent('#results-total');
      check('resultado mostra 15 perguntas', total === '15', total);
      await closeAll(host, guest);
    }

    // ---------- 4. abandono ----------
    {
      const host = await newPlayer(browser, 'host');
      const guest = await newPlayer(browser, 'guest');
      await connect(host, guest);
      await host.click('#mp-start');
      await waitScreen(host, 'mp-play'); await waitScreen(guest, 'mp-play');
      // uma rodada completa para haver o que registrar
      await Promise.all([
        host.evaluate(() => { document.querySelector('#mp-options .bq5-option[data-index="0"]').click(); document.querySelector('#mp-confirm').click(); }),
        guest.evaluate(() => { document.querySelector('#mp-options .bq5-option[data-index="1"]').click(); document.querySelector('#mp-confirm').click(); })
      ]);
      await host.waitForFunction(() => document.querySelector('#mp-feedback-title').textContent !== '');
      await host.waitForFunction(() => document.querySelector('#mp-feedback').hidden === true, null, { timeout: 8000 });
      await guest.click('#mp-quit');
      await guest.click('[data-action="modal-confirm"]');
      await waitScreen(guest, 'results'); await waitScreen(host, 'results');
      check('abandono: quem saiu vê "Você perdeu"; oponente vê "Vitória"', (await title(guest)) === 'Você perdeu' && (await title(host)) === 'Vitória', [await title(guest), await title(host)]);
      await closeAll(host, guest);
    }

    // ---------- 5. queda de conexão no meio da partida ----------
    {
      const host = await newPlayer(browser, 'host');
      const guest = await newPlayer(browser, 'guest');
      await connect(host, guest);
      await host.click('#mp-start');
      await waitScreen(host, 'mp-play'); await waitScreen(guest, 'mp-play');
      await guest.context().close();
      await host.waitForFunction(() => document.querySelector('#bq5-modal-root').textContent.includes('Conexão encerrada'), null, { timeout: 20000 });
      check('queda de conexão: anfitrião é avisado e a partida não é registrada', (await host.evaluate(() => BQ5.screens.results.getHistory().length)) === 0);
      await closeAll(host);
    }

    // ---------- 6. solo continua funcionando (regressão) ----------
    {
      const p = await newPlayer(browser, 'solo');
      await p.click('[data-action="go-solo"]');
      await waitScreen(p, 'setup');
      await p.click('#setup-start');
      await waitScreen(p, 'play');
      check('regressão: modo solo ainda inicia a partida', true);
      await closeAll(p);
    }
  } catch (error) {
    failed++;
    console.log('FAIL exceção: ' + (error && error.stack || error));
  } finally {
    await browser.close();
  }
  console.log('\n' + passed + ' verificações OK; ' + failed + ' falhas');
  process.exit(failed ? 1 : 0);
})();
