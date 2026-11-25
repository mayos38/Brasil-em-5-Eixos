# -*- coding: utf-8 -*-
"""Suíte do MÓDULO 12 — js/campaign.js (Campanha v2, GDD "campanha v1.1").
Uso (a partir da raiz do projeto):
    python tests/run_campaign.py
Roda em V8 real via py-mini-racer, com relógio e RNG injetados pelo teste
(setClock/setRng). O banco oficial data/questions.json é injetado como
fixture (window.__BANK_FILE); bancos sintéticos mínimos são adotados dentro
dos testes. Inclui verificação estática de independência de DOM/timers de
navegador no código de campaign.js (comentários removidos antes da análise).
"""
import sys, os, re, json
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from harness import make_ctx, load_js, run_tests, check  # noqa: E402

MODULES = ['brasil-quiz/js/config.js', 'brasil-quiz/js/util.js',
           'brasil-quiz/js/storage.js', 'brasil-quiz/js/bank.js',
           'brasil-quiz/js/engine.js', 'brasil-quiz/js/hp.js',
           'brasil-quiz/js/campaign.js']

def read(p):
    return open(os.path.join(ROOT, p.replace('/', os.sep)), encoding='utf-8').read()

# --- verificação estática: campaign sem DOM/timers de navegador (só código) ---
def strip_comments(code):
    out = []
    i, n, mode = 0, len(code), None
    while i < n:
        c = code[i]
        if mode is None:
            if c == '/' and i + 1 < n and code[i + 1] == '/':
                mode = 'line'; i += 2; continue
            if c == '/' and i + 1 < n and code[i + 1] == '*':
                mode = 'block'; i += 2; continue
            if c in ('"', "'"):
                q, j = c, i + 1
                while j < n and code[j] != q:
                    if code[j] == '\\':
                        j += 1
                    j += 1
                i = j + 1
                continue
            out.append(c); i += 1
        elif mode == 'line':
            if c == '\n':
                mode = None; out.append(c)
            i += 1
        else:  # block
            if c == '*' and i + 1 < n and code[i + 1] == '/':
                mode = None; i += 2
            else:
                i += 1
    return ''.join(out)

src_code = strip_comments(read('brasil-quiz/js/campaign.js'))
dom_refs = [t for t in ('document', 'window', 'localStorage',
                        'setInterval', 'setTimeout')
            if re.search(r'\b' + t + r'\b', src_code)]
print('--- verificação estática campaign.js (código, sem comentários): '
      + ('NENHUMA referência a DOM/timers de navegador' if not dom_refs
         else 'REFERÊNCIAS ENCONTRADAS: ' + ', '.join(dom_refs)) + ' ---')

ctx = make_ctx()
for m in MODULES:
    load_js(ctx, m)

# injeta o banco oficial do projeto como string JSON (fixture de integridade)
bank_file = read('brasil-quiz/data/questions.json')
ctx.eval("window.__BANK_FILE = " + json.dumps(bank_file))

total, failed = run_tests(ctx, read('tests/js/test_campaign.js'),
                          'campanha v2 — Módulo 12 (V8 real)')
ok = check(total, failed) and not dom_refs
sys.exit(0 if ok else 1)
