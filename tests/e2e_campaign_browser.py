"""Teste de navegador (Playwright/Chromium) — M12 campanha + Update alpha 4.
Sobe um servidor HTTP local na raiz do projeto, abre dev/integrated-preview.html e percorre:
fontes locais, menu em coluna única, ausência do info do banco, parada temática, resultados,
mapa, chefe (timeout, derrota, retry no checkpoint, vitória), próxima região e reinício.
Requer: pip install playwright && playwright install chromium.  Uso: python tests/e2e_campaign_browser.py
"""
import atexit, os, subprocess, sys, time
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8765'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
atexit.register(_srv.terminate)
time.sleep(1.5)
from playwright.sync_api import sync_playwright
import json
fails=[]
def check(c,msg):
    print(('PASS ' if c else 'FAIL ')+msg)
    if not c: fails.append(msg)
with sync_playwright() as p:
    b=p.chromium.launch()
    pg=b.new_page(viewport={'width':390,'height':800})
    errs=[]
    pg.on('console',lambda m: errs.append(m.type+': '+m.text) if m.type=='error' else None)
    pg.on('pageerror',lambda e: errs.append('PAGEERR '+str(e)))
    pg.clock.install()
    pg.goto('http://localhost:8765/dev/integrated-preview.html')
    pg.clock.run_for(500)
    pg.wait_for_selector('#screen-menu:not([hidden])',timeout=15000)
    check(pg.locator('#menu-bank-info').count()==0,'menu sem info do banco')
    check(pg.evaluate("[...document.fonts].filter(f=>f.status==='loaded').map(f=>f.family).sort().join()")=='Pixelify Sans,Silkscreen','fontes locais carregadas')
    check(len(pg.evaluate("getComputedStyle(document.querySelector('.bq5-menu')).gridTemplateColumns").split())==1,'menu em coluna única')
    pg.click('[data-action=go-campaign]')
    pg.wait_for_selector('#screen-campaign:not([hidden])')
    # --- parada temática: Norte/Cultura
    pg.click('.bq5-point__btn[data-value="norte:cultura"]')
    pg.wait_for_selector('#screen-play:not([hidden])')
    check(pg.evaluate("BQ5.engine.state().mode")=='stage','engine em modo stage')
    for i in range(10):
        pg.click('#play-options .bq5-option[data-index="0"]')
        pg.click('#play-next'); pg.click('#play-next')
    pg.wait_for_selector('#screen-results:not([hidden])')
    check(pg.is_visible('#results-stage'),'bloco stage visível nos resultados')
    print('  stage text:',pg.inner_text('#results-stage-text'))
    check(pg.is_visible('#results-campaign'),'botão Mapa visível')
    hist=pg.evaluate("JSON.stringify(BQ5.screens.results.getHistory())")
    check(hist=='[]','parada da campanha não entra no histórico: '+hist)
    rec=pg.evaluate("JSON.stringify(BQ5.storage.getCampaignV2())")
    print('  v2:',rec)
    pg.click('#results-replay')
    pg.wait_for_selector('#screen-play:not([hidden])')
    check(pg.evaluate("BQ5.engine.state().mode")=='stage' and pg.evaluate("BQ5.engine.state().region")=='norte','replay recomeça a mesma parada')
    pg.click('[data-action=quit-game]'); pg.click('[data-action=modal-confirm]')
    pg.wait_for_selector('#screen-menu:not([hidden])')
    prog=pg.inner_text('#menu-progress-count'); print('  menu prog',prog)
    # --- libera chefe: 10/10 nos 5 pontos
    pg.evaluate("""()=>{const v=BQ5.storage.getCampaignV2();v.tiers.edu={points:{},bosses:{}};
      ['cultura','economia','animais','vegetacao','cidades'].forEach(t=>v.tiers.edu.points['norte:'+t]={best:10});BQ5.storage.saveCampaignV2(v);}""")
    pg.click('[data-action=go-campaign]'); pg.wait_for_selector('#screen-campaign:not([hidden])')
    check(not pg.locator('.bq5-route__boss').first.is_disabled(),'chefe liberado com 50/50')
    # regiões seguintes bloqueadas
    check(pg.locator('.bq5-route__node[data-state=locked]').count()==4,'4 regiões bloqueadas')
    pg.click('.bq5-route__boss')
    pg.wait_for_selector('#screen-boss:not([hidden])')
    check(pg.locator('#boss-hand .bq5-boss__card:visible').count()==3,'3 cartas')
    def snap(): return pg.evaluate("BQ5.campaign.fightSnapshot()")
    def round_(correct=True):
        pg.click('#boss-hand .bq5-boss__card[data-value="0"]')
        pg.clock.run_for(3200)
        f=snap(); q=[c for c in f['hand'] if c['revealed']][0]['question']
        idx=q['a'] if correct else (q['a']+1)%4
        pg.click('#boss-options .bq5-option[data-index="%d"]'%idx)
        pg.click('#boss-confirm')
        return pg.evaluate("BQ5.campaign.fightSnapshot()")
    # 1ª rodada: espera revelação desabilitada
    pg.click('#boss-hand .bq5-boss__card[data-value="1"]')
    check(pg.locator('#boss-options .bq5-option').first.is_disabled(),'alternativas desabilitadas na pausa de revelação')
    pg.clock.run_for(3200)
    check(not pg.locator('#boss-options .bq5-option').first.is_disabled(),'alternativas liberadas após 3s')
    # timeout: deixa o tempo esgotar (30s)
    pg.clock.run_for(31000)
    f=snap(); check(f['playerHp']<1000 and f['phase']=='gap','timeout tira HP e vai ao intervalo: hp=%s phase=%s'%(f['playerHp'],f['phase']))
    pg.clock.run_for(2200)
    check(snap()['phase']=='choosing','próxima mão após ~2s')
    # acertos até chefe cair a checkpoint (<=75%) e depois perder de propósito
    for i in range(4):
        f=round_(True); pg.clock.run_for(2200)
    f=snap(); print('  boss hp',f['bossHp'],'checkpoint',f['checkpointHit'])
    guard=0
    while not f['over'] and guard<40:
        f=round_(False); guard+=1
        if not f['over']: pg.clock.run_for(2200); f=snap()
    check(f['over']=='loss','derrota alcançada')
    check(pg.is_visible('#boss-retry') and pg.is_visible('#boss-end'),'painel de derrota + botão retry')
    pg.click('#boss-retry')
    f=snap(); check(f['playerHp']==1000 and f['bossHp']==750,'retry: jogador 1000, chefe no checkpoint 750 (obtido %s/%s)'%(f['playerHp'],f['bossHp']))
    guard=0
    while not f['over'] and guard<40:
        f=round_(True); guard+=1
        if not f['over']: pg.clock.run_for(2200); f=snap()
    check(f['over']=='win','vitória alcançada')
    check(pg.is_visible('#boss-finish'),'botão concluir')
    pg.click('#boss-finish')
    pg.wait_for_selector('#screen-campaign:not([hidden])')
    check(pg.locator('.bq5-route__node[data-state=done]').count()==1,'Norte concluída')
    check(pg.locator('.bq5-route__node[data-state=locked]').count()==3,'Nordeste liberada (3 bloqueadas)')
    check(pg.inner_text('#campaign-done').strip()=='1','progresso 1 região')
    # sair do desafio
    pg.click('.bq5-route__node[data-region=nordeste] .bq5-route__card')
    print('  nordeste points', pg.locator('.bq5-route__node[data-region=nordeste] .bq5-point').count())
    # reset
    pg.click('#campaign-reset'); pg.click('[data-action=modal-confirm]')
    check(pg.inner_text('#campaign-done').strip()=='0','reset zera o tier')
    pg.click('[data-action=back]'); pg.wait_for_selector('#screen-menu:not([hidden])')
    print('errors:',errs)
    check(not errs,'sem erros de console')
    b.close()
print('FALHAS:',fails)
sys.exit(1 if fails else 0)
