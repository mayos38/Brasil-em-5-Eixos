'use strict';
/*
 * Teste ponta a ponta do MODO ALTERNATIVO (HP + cartas) do Multiplayer 1x1.
 * Dois contextos de navegador independentes ligados por WebRTC real.
 * Uso: python -m http.server 8765  (na raiz do projeto) e
 *      NODE_PATH=<node_modules com playwright> node tests/e2e_alt.js
 */
const { chromium } = require('playwright');
const URL = process.env.BQ5_URL || 'http://localhost:8765/dev/integrated-preview.html';
let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('PASS ' + name); }
  else { failed++; console.log('FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}
const FAST = { rounds: 12, limitMs: 4000, pickMs: 2500, transitionMs: 700, eventGapMs: 250, graceMs: 1000, rematchMs: 5200 };

async function newPlayer(browser, weights) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { failed++; console.log('FAIL pageerror ' + e.message); });
  await page.goto(URL);
  await page.waitForFunction(() => window.BQ5 && BQ5.ui && BQ5.ui.currentScreen() === 'menu', null, { timeout: 20000 });
  await page.evaluate(([fast, w]) => { BQ5.config.multiplayer = { alternative: Object.assign({}, fast, w ? { difficultyWeights: w } : {}) }; }, [FAST, weights || null]);
  return page;
}
const screen = (p) => p.evaluate(() => BQ5.ui.currentScreen());
const waitScreen = (p, n, t) => p.waitForFunction((x) => BQ5.ui.currentScreen() === x, n, { timeout: t || 15000 });
const alt = (p) => p.evaluate(() => BQ5.screens.multiplayerAlt.state());
const closeAll = async (...ps) => { for (const p of ps) { try { await p.context().close(); } catch (e) {} } };

async function connect(host, guest, theme) {
  for (const p of [host, guest]) { await p.click('[data-action="go-multiplayer"]'); await waitScreen(p, 'mp-mode'); }
  await host.click('[data-action="mp-pick-mode"][data-value="alternative"]');
  await guest.click('[data-action="mp-pick-mode"][data-value="alternative"]');
  await waitScreen(host, 'mp-setup'); await waitScreen(guest, 'mp-setup');
  await host.fill('#mp-nick', 'Ana'); await guest.fill('#mp-nick', 'Bruno');
  await host.click('#mp-role [data-value="host"]');
  await host.waitForFunction(() => document.querySelector('#mp-host-code').value.startsWith('BQ5-'), null, { timeout: 15000 });
  await guest.click('#mp-role [data-value="join"]');
  await guest.fill('#mp-join-offer', await host.inputValue('#mp-host-code'));
  await guest.click('#mp-join-go');
  await guest.waitForFunction(() => document.querySelector('#mp-join-code').value.startsWith('BQ5-'), null, { timeout: 15000 });
  await host.fill('#mp-host-answer', await guest.inputValue('#mp-join-code'));
  await host.click('#mp-host-connect');
  await waitScreen(host, 'mp-theme', 20000); await waitScreen(guest, 'mp-wait', 20000);
  if (theme) await host.click('#mp-themes [data-value="' + theme + '"]');
}

// policy: 'right' | 'wrong' | 'none' (não escolhe carta nem responde) | 'nopick' (não escolhe cartas de entrega/descarte)
async function runAlt(page, policy, opts) {
  const done = {};
  const stopAt = (opts && opts.stopScreen) || 'mp-alt-end';
  for (let g = 0; g < 6000; g++) {
    const s = await screen(page);
    if (s === stopAt || s === 'mp-alt-end' || s === 'menu') return;
    if (s === 'mp-alt-pick') {
      const st = await alt(page);
      const key = 'p' + st.stage + st.round;
      if (!done[key] && policy !== 'nopick' && policy !== 'none') {
        const n = await page.$$('#alt-pick-cards .bq5-altcard:not([disabled])');
        if (n.length) { done[key] = 1; await n[0].click(); }
      }
    } else if (s === 'mp-alt-play') {
      const st = await alt(page);
      const key = 'r' + st.round;
      if (st.stage === 'round' && !done[key] && policy !== 'none') {
        const cards = await page.$$('#alt-hand .bq5-altcard:not([disabled])');
        if (cards.length) {
          done[key] = 1;
          await cards[0].click();
          const idx = await page.evaluate((pol) => {
            const q = BQ5.bank.list().find((x) => x.question === document.querySelector('#alt-question').textContent);
            const t = Array.from(document.querySelectorAll('#alt-options .bq5-option__text')).map((n) => n.textContent);
            const r = t.indexOf(q.options[q.answer]);
            return pol === 'right' ? r : (r + 1) % 4;
          }, policy);
          await page.click('#alt-options .bq5-option[data-index="' + idx + '"]');
          await page.click('#alt-confirm');
        }
      }
    }
    await page.waitForTimeout(40);
  }
  throw new Error('runAlt não terminou');
}
const title = (p) => p.textContent('#alt-end-title');

(async () => {
  const browser = await chromium.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
  try {
    // ---------- 1. modo + início + primeira rodada passo a passo ----------
    {
      const host = await newPlayer(browser, { 1: 0, 2: 0, 3: 0, 4: 1 });
      const guest = await newPlayer(browser, { 1: 0, 2: 0, 3: 0, 4: 1 });
      await host.click('[data-action="go-multiplayer"]'); await waitScreen(host, 'mp-mode');
      const alt0 = await host.evaluate(() => { const b = document.querySelector('#mp-mode-alt'); return { disabled: b.disabled, text: b.textContent, badgeVisible: b.querySelector('.bq5-mpmode__badge').offsetParent !== null }; });
      check('modo alternativo habilitado, com descrição (1000 HP, 12 rodadas)', !alt0.disabled && /1000 de HP/.test(alt0.text) && /12 rodadas/.test(alt0.text) && alt0.badgeVisible === false, alt0);
      await host.goBack().catch(() => {}); await host.close();
      const host2 = await newPlayer(browser, { 1: 0, 2: 0, 3: 0, 4: 1 });
      await connect(host2, guest, 'animais');
      await host2.click('#mp-start');
      await waitScreen(host2, 'mp-alt-pick'); await waitScreen(guest, 'mp-alt-pick');
      check('início: título "Escolha uma carta para o oponente"', /Escolha uma carta para o oponente/.test(await host2.textContent('#alt-pick-title')));
      const cards = await host2.$$eval('#alt-pick-cards .bq5-altcard', (els) => els.map((e) => e.textContent));
      check('início: 3 cartas mostrando só tema e dificuldade (sem pergunta)', cards.length === 3 && cards.every((t) => /Animais/.test(t) && /Geógrafo/.test(t) && /Dano 200/.test(t)), cards);
      const t0 = await host2.textContent('#alt-pick-time');
      check('início: limite de escolha exibido (2-3 s no teste; 15 s por padrão)', /\d+ s/.test(t0), t0);
      await host2.click('#alt-pick-cards .bq5-altcard');
      const locked = await host2.$$eval('#alt-pick-cards .bq5-altcard', (els) => els.every((e) => e.disabled));
      check('após escolher: opções trancadas aguardando o outro', locked && /Aguardando o oponente/.test(await host2.textContent('#alt-pick-status')));
      await waitScreen(host2, 'mp-alt-play', 10000);
      await waitScreen(guest, 'mp-alt-play', 10000);
      const hand = await host2.$$eval('#alt-hand .bq5-altcard', (els) => els.length);
      const vis = await host2.evaluate(() => ({ q: document.querySelector('#alt-qwrap').hidden, h: document.querySelector('#alt-hand-wrap').hidden }));
      check('jogatina: 3 cartas lado a lado e pergunta oculta', hand === 3 && vis.q === true && vis.h === false, [hand, vis]);
      const st0 = await alt(host2);
      check('HP inicial 1000 x 1000, rodada 1/12', st0.hp.host === 1000 && st0.hp.guest === 1000 && st0.round === 0 && st0.rounds === 12, st0);
      const stg = await alt(guest);
      check('cada jogador tem 3 cartas e vê 3 do oponente (só tema/dificuldade)', stg.myHand.length === 3 && stg.oppHand.length === 3 && st0.oppHand.length === 3);
      await host2.click('#alt-hand .bq5-altcard');
      const after = await host2.evaluate(() => ({ q: document.querySelector('#alt-qwrap').hidden, h: document.querySelector('#alt-hand-wrap').hidden, qt: document.querySelector('#alt-question').textContent }));
      check('ao selecionar carta: as outras somem e a pergunta aparece', after.q === false && after.h === true && after.qt.length > 10, after);
      // host acerta, convidado ERRA => só o convidado perde HP
      await guest.click('#alt-hand .bq5-altcard');
      const answerIdx = (pol) => (p) => p.evaluate((pp) => { const q = BQ5.bank.list().find((x) => x.question === document.querySelector('#alt-question').textContent); const t = Array.from(document.querySelectorAll('#alt-options .bq5-option__text')).map((n) => n.textContent); const r = t.indexOf(q.options[q.answer]); return pp === 'right' ? r : (r + 1) % 4; }, pol);
      await host2.click('#alt-options .bq5-option[data-index="' + (await answerIdx('right')(host2)) + '"]');
      await host2.click('#alt-confirm');
      check('respondeu: alternativas travadas, aguardando', /Aguardando o oponente/.test(await host2.textContent('#alt-confirm')) && (await host2.$$eval('#alt-options .bq5-option', (e) => e.every((x) => x.disabled))));
      const hpMid = await alt(host2);
      check('HP não muda antes de as duas respostas chegarem', hpMid.hp.guest === 1000);
      await guest.waitForFunction(() => /já respondeu/.test(document.querySelector('#alt-opp-status').textContent));
      await guest.click('#alt-options .bq5-option[data-index="' + (await answerIdx('wrong')(guest)) + '"]');
      await guest.click('#alt-confirm');
      await host2.waitForFunction(() => document.querySelectorAll('#alt-events .bq5-altevent').length >= 1, null, { timeout: 4000 });
      const first = await host2.textContent('#alt-events .bq5-altevent');
      check('ordem: 1º evento é o do jogador 1 (anfitrião) — acertou, dano 200', /Você acertou/.test(first) && /perde 200 de HP/.test(first), first);
      await host2.waitForFunction(() => document.querySelectorAll('#alt-events .bq5-altevent').length === 2, null, { timeout: 4000 });
      const second = await host2.textContent('#alt-events .bq5-altevent:nth-child(2)');
      check('ordem: 2º evento é o do jogador 2 — errou, nada acontece', /Bruno errou/.test(second) && /Nada acontece/.test(second), second);
      const hpA = await alt(host2), hpB = await alt(guest);
      check('dano pela dificuldade (Geógrafo = 200); só o oponente perdeu HP', hpA.hp.guest === 800 && hpA.hp.host === 1000 && hpB.hp.guest === 800, [hpA.hp, hpB.hp]);
      const ev1G = await guest.textContent('#alt-events .bq5-altevent');
      check('convidado vê o mesmo 1º evento do ponto de vista dele', /Ana acertou/.test(ev1G) && /Você perde 200 de HP/.test(ev1G), ev1G);
      // descarte
      await waitScreen(host2, 'mp-alt-pick', 6000); await waitScreen(guest, 'mp-alt-pick', 6000);
      const dt = await host2.textContent('#alt-pick-title');
      check('entre rodadas: "Escolha uma carta do oponente para descartar"', /Escolha uma carta do oponente para descartar/.test(dt), dt);
      const before = (await alt(host2));
      const oppBefore = await host2.$$eval('#alt-pick-cards .bq5-altcard', (els) => els.map((e) => e.getAttribute('data-cid')));
      await host2.click('#alt-pick-cards .bq5-altcard');
      await guest.click('#alt-pick-cards .bq5-altcard');
      await waitScreen(host2, 'mp-alt-play', 6000);
      const afterH = await alt(host2);
      const handNow = afterH.oppHand.map((c) => String(c.cid));
      check('descarte: a mão do oponente continua com 3 cartas, com carta nova no lugar', handNow.length === 3 && handNow.some((c) => oppBefore.indexOf(c) === -1) , { oppBefore, handNow });
      check('rodada 2 começou', afterH.round === 1);
      await closeAll(host2, guest);
    }

    // ---------- 2. vitória por HP zerado (anfitrião acerta sempre, convidado erra) ----------
    {
      const w = { 1: 0, 2: 0, 3: 0, 4: 1 };
      const host = await newPlayer(browser, w), guest = await newPlayer(browser, w);
      await connect(host, guest);
      await host.click('#mp-start');
      await Promise.all([runAlt(host, 'right'), runAlt(guest, 'wrong')]);
      await waitScreen(host, 'mp-alt-end'); await waitScreen(guest, 'mp-alt-end');
      check('HP zerado: anfitrião Vitória / convidado Você perdeu', (await title(host)) === 'Vitória' && (await title(guest)) === 'Você perdeu', [await title(host), await title(guest)]);
      const sh = await alt(host);
      check('fim em 5 acertos de 200 (rodada 5, antes de 12)', sh.hp.guest === 0 && sh.hp.host === 1000 && sh.roundsDone === 5, sh);
      const sum = await host.evaluate(() => ({ cols: document.querySelectorAll('#alt-end-summary .bq5-altsum').length, text: document.querySelector('#alt-end-summary').textContent, review: !!document.querySelector('#alt-end-summary .bq5-review') }));
      check('resumo: acertos/erros e tema que mais acertou/errou, sem revisão de perguntas', sum.cols === 2 && /Acertos/.test(sum.text) && /Tema que mais acertou/.test(sum.text) && /Tema que mais errou/.test(sum.text) && !sum.review, sum.text.slice(0, 200));
      check('resumo: contagem do anfitrião = 5 acertos', /Acertos5/.test(sum.text.replace(/\s/g, '')), sum.text);
      const sg = await alt(guest);
      check('convidado tem a mesma contagem (logs sincronizados)', sg.logs.host.filter((e) => e.ok).length === 5 && sg.logs.guest.filter((e) => e.ok).length === 0, sg.logs.host.length);
      const btn = await host.evaluate(() => { const g = (id) => { const b = document.querySelector(id); const cs = getComputedStyle(b); return { t: b.textContent.trim(), bg: cs.backgroundColor }; }; return { r: g('#alt-end-rematch'), a: g('#alt-end-again'), m: g('#alt-end-menu') }; });
      check('botões: Revanche amarelo, Menu principal vermelho, Jogar novamente', btn.r.t === 'Revanche' && /rgb\(24\d, 19\d, 4\d\)|rgb\(242, 194, 48\)/.test(btn.r.bg) && btn.m.t === 'Menu principal' && /rgb\(198, 40, 40\)/.test(btn.m.bg) && btn.a.t === 'Jogar novamente', btn);
      const hist = await host.evaluate(() => BQ5.screens.results.getHistory(3));
      check('perfil/histórico registra a partida do modo alternativo', hist.length === 1 && hist[0].variant === 'alternative' && hist[0].outcome === 'win', hist);
      // ---- revanche aceita ----
      await host.click('#alt-end-rematch');
      await guest.waitForFunction(() => !document.querySelector('#alt-end-ask').hidden, null, { timeout: 4000 });
      check('convidado vê o pedido de revanche', /Ana quer a revanche/.test(await guest.textContent('#alt-end-ask-text')));
      check('anfitrião aguarda (botão desabilitado)', await host.$eval('#alt-end-rematch', (b) => b.disabled));
      const tAcc = Date.now();
      await guest.click('#alt-end-accept');
      await waitScreen(host, 'mp-alt-msg', 3000); await waitScreen(guest, 'mp-alt-msg', 3000);
      check('revanche aceita: "Simbora de novo!"', /Simbora de novo!/.test(await host.textContent('#alt-msg-title')) && /Simbora de novo!/.test(await guest.textContent('#alt-msg-title')));
      await waitScreen(host, 'mp-alt-pick', 15000); await waitScreen(guest, 'mp-alt-pick', 15000);
      const gap = Date.now() - tAcc;
      check('transição de pelo menos 5 s antes de recomeçar', gap >= 5000, gap);
      const sNew = await alt(host);
      check('nova partida com HP cheio', sNew.hp.host === 1000 && sNew.hp.guest === 1000 && sNew.roundsDone === 0, sNew);
      // joga rápido a revanche: convidado vence (ele acerta, anfitrião erra), depois recusa
      await Promise.all([runAlt(host, 'wrong'), runAlt(guest, 'right')]);
      await waitScreen(host, 'mp-alt-end'); await waitScreen(guest, 'mp-alt-end');
      check('revanche: agora o convidado vence', (await title(guest)) === 'Vitória' && (await title(host)) === 'Você perdeu');
      await guest.click('#alt-end-rematch');
      await host.waitForFunction(() => !document.querySelector('#alt-end-ask').hidden);
      await host.click('#alt-end-decline');
      await waitScreen(guest, 'mp-alt-msg', 4000);
      check('revanche recusada: "Ihhh, ele(a) fugiu!"', /Ihhh, ele\(a\) fugiu!/.test(await guest.textContent('#alt-msg-title')));
      check('tela de fuga oferece Jogar novamente e Menu principal', await guest.evaluate(() => !document.querySelector('#alt-msg-actions').hidden));
      await guest.click('#alt-msg-again');
      await waitScreen(guest, 'mp-setup', 4000);
      check('"Jogar novamente" leva à criação de nova partida', true);
      await closeAll(host, guest);
    }

    // ---------- 3. empate (ambos zerados na mesma rodada) ----------
    {
      const w = { 1: 0, 2: 0, 3: 0, 4: 1 };
      const host = await newPlayer(browser, w), guest = await newPlayer(browser, w);
      await connect(host, guest);
      await host.click('#mp-start');
      await Promise.all([runAlt(host, 'right'), runAlt(guest, 'right')]);
      await waitScreen(host, 'mp-alt-end'); await waitScreen(guest, 'mp-alt-end');
      const s = await alt(host);
      check('ambos zerados: Empate para os dois', (await title(host)) === 'Empate' && (await title(guest)) === 'Empate' && s.hp.host === 0 && s.hp.guest === 0, [await title(host), s.hp]);
      // oponente sai pelo menu => pedido de revanche vira "fugiu"
      await host.click('#alt-end-rematch');
      await guest.waitForFunction(() => !document.querySelector('#alt-end-ask').hidden);
      await guest.click('#alt-end-menu');
      await waitScreen(host, 'mp-alt-msg', 8000);
      check('oponente saiu após o pedido: "Ihhh, ele(a) fugiu!"', /fugiu/.test(await host.textContent('#alt-msg-title')));
      await closeAll(host, guest);
    }

    // ---------- 4. fim por rodadas: maior HP vence (12 rodadas) ----------
    {
      const w = { 1: 1, 2: 0, 3: 0, 4: 0 };
      const host = await newPlayer(browser, w), guest = await newPlayer(browser, w);
      await connect(host, guest);
      await host.click('#mp-start');
      await Promise.all([runAlt(host, 'right'), runAlt(guest, 'wrong')]);
      await waitScreen(host, 'mp-alt-end'); await waitScreen(guest, 'mp-alt-end');
      const s = await alt(host);
      check('12 rodadas: vence o de maior HP (fácil = 50 por acerto)', s.roundsDone === 12 && s.hp.host === 1000 && s.hp.guest === 400 && (await title(host)) === 'Vitória' && (await title(guest)) === 'Você perdeu', s);
      await closeAll(host, guest);
    }

    // ---------- 5. tempo esgotado: quem não responde não causa dano e a carta não é gasta ----------
    {
      const w = { 1: 0, 2: 0, 3: 0, 4: 1 };
      const host = await newPlayer(browser, w), guest = await newPlayer(browser, w);
      await connect(host, guest);
      await host.click('#mp-start');
      await waitScreen(host, 'mp-alt-play', 10000); await waitScreen(guest, 'mp-alt-play', 10000);
      const handBefore = (await alt(guest)).myHand.map((c) => c.cid);
      await host.click('#alt-hand .bq5-altcard');
      await host.evaluate(() => { const q = BQ5.bank.list().find((x) => x.question === document.querySelector('#alt-question').textContent); const t = Array.from(document.querySelectorAll('#alt-options .bq5-option__text')).map((n) => n.textContent); document.querySelector('#alt-options .bq5-option[data-index="' + t.indexOf(q.options[q.answer]) + '"]').click(); document.querySelector('#alt-confirm').click(); });
      const t0 = Date.now();
      await guest.waitForFunction(() => document.querySelectorAll('#alt-events .bq5-altevent').length >= 1, null, { timeout: 9000 });
      const waited = Date.now() - t0;
      check('convidado sem resposta: rodada fecha no tempo (~4 s do teste)', waited >= 2000 && waited < 8000, waited);
      const e1 = await guest.textContent('#alt-events .bq5-altevent');
      await guest.waitForFunction(() => document.querySelectorAll('#alt-events .bq5-altevent').length === 2);
      const e2 = await guest.textContent('#alt-events .bq5-altevent:nth-child(2)');
      check('timeout: "não respondeu a tempo" e nada acontece', /Você perde 200 de HP/.test(e1) && /não respondeu a tempo/.test(e2), [e1, e2]);
      const sg = await alt(guest);
      check('só quem não respondeu perdeu HP (800) e o anfitrião manteve 1000', sg.hp.guest === 800 && sg.hp.host === 1000, sg.hp);
      await waitScreen(guest, 'mp-alt-pick', 6000);
      await host.click('#alt-pick-cards .bq5-altcard').catch(() => {});
      await guest.click('#alt-pick-cards .bq5-altcard').catch(() => {});
      await waitScreen(guest, 'mp-alt-play', 6000);
      const handAfter = (await alt(guest)).myHand.map((c) => c.cid);
      check('carta não escolhida pelo convidado continua na mão (3 cartas, mesmas ids exceto descarte)', handAfter.length === 3 && handBefore.filter((c) => handAfter.indexOf(c) !== -1).length >= 2, [handBefore, handAfter]);
      // abandono
      await host.click('#alt-quit');
      await host.click('[data-action="modal-confirm"]');
      await waitScreen(host, 'mp-alt-end', 4000); await waitScreen(guest, 'mp-alt-end', 4000);
      check('abandono: quem sai perde; o oponente vence', (await title(host)) === 'Você perdeu' && (await title(guest)) === 'Vitória', [await title(host), await title(guest)]);
      await closeAll(host, guest);
    }

    // ---------- 6. queda de conexão no meio ----------
    {
      const host = await newPlayer(browser), guest = await newPlayer(browser);
      await connect(host, guest);
      await host.click('#mp-start');
      await waitScreen(host, 'mp-alt-pick');
      await guest.context().close();
      await host.waitForFunction(() => document.querySelector('#bq5-modal-root').textContent.includes('Conexão encerrada'), null, { timeout: 20000 });
      check('queda de conexão: aviso e partida não registrada', (await host.evaluate(() => BQ5.screens.results.getHistory().length)) === 0);
      await closeAll(host);
    }
  } catch (e) {
    failed++; console.log('FAIL exceção: ' + (e && e.stack || e));
  } finally { await browser.close(); }
  console.log('\n' + passed + ' verificações OK; ' + failed + ' falhas');
  process.exit(failed ? 1 : 0);
})();
