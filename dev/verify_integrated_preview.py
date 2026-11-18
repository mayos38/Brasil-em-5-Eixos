# -*- coding: utf-8 -*-
"""Validação do preview integrado (M15 intermediário) — dev/integrated-preview.*

A) Checagens estáticas (arquivos, ordem de scripts em index.html, resolução dos
   caminhos relativos a partir de /dev/, banco real com 508 questões).
B) Fluxo completo em V8 real (py-mini-racer): módulos reais M1–M11 + bootstrap do
   preview: menu -> setup (eixo+dificuldade) -> partida solo completa (pontuação
   real base+bônus, timeout via engine) -> resultados (histórico persistido) -> menu.
C) Servidor HTTP local: todos os caminhos usados pelo preview respondem 200.

Uso (na raiz do projeto):  python dev/verify_integrated_preview.py
"""
import sys, os, json, re, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "tools", "deps"))
try:
    from py_mini_racer import MiniRacer  # noqa: F401
except Exception as e:
    print("ERRO: não foi possível importar py_mini_racer de tools/deps:", e)
    sys.exit(2)

RESULTS = []
def check(name, ok, detail=""):
    RESULTS.append((name, bool(ok), detail))
    print(("  PASS " if ok else "  FAIL ") + name + ("" if ok else ("   -> " + str(detail))))

def section(title):
    print("\n== " + title + " ==")

# ---------------------------------------------------------------- A) estáticos
def static_checks():
    section("A) Checagens estáticas")
    p_html = os.path.join(ROOT, "dev", "integrated-preview.html")
    p_js = os.path.join(ROOT, "dev", "integrated-preview.js")
    check("dev/integrated-preview.html existe", os.path.isfile(p_html))
    check("dev/integrated-preview.js existe", os.path.isfile(p_js))
    html = open(p_html, encoding="utf-8").read() if os.path.isfile(p_html) else ""
    js = open(p_js, encoding="utf-8").read() if os.path.isfile(p_js) else ""
    check("HTML carrega integrated-preview.js", "integrated-preview.js" in html)
    check("HTML liga o CSS real (../brasil-quiz/css/style.css)", "../brasil-quiz/css/style.css" in html)

    idx_path = os.path.join(ROOT, "brasil-quiz", "index.html")
    idx = open(idx_path, encoding="utf-8").read() if os.path.isfile(idx_path) else ""
    order = re.findall(r'<script[^>]+src=["\']([^"\']+)["\']', idx)
    check("index.html declara scripts <script src>", len(order) >= 6, str(order))

    expected = ["js/config.js", "js/util.js", "js/storage.js", "js/bank.js", "js/engine.js", "js/ui.js"]
    positions = {}
    for i, s in enumerate(order):
        if s not in positions:
            positions[s] = i
    ok_order = all(s in positions for s in expected) and \
        [positions.get(s, -1) for s in expected] == sorted(positions.get(s, -1) for s in expected)
    check("ordem de dependência config→util→storage→bank→engine→ui em index.html", ok_order, str(order))

    base = "http://localhost:8000/dev/integrated-preview.html"  # URL exata do preview
    def disk_ok(src):
        resolved = urllib.parse.urljoin(base, ("../brasil-quiz/" + src) if src.startswith("js/") else src)
        rel = urllib.parse.urlparse(resolved).path.lstrip("/")
        return os.path.isfile(os.path.join(ROOT, rel.replace("/", os.sep)))
    bad = [s for s in order if not disk_ok(s)]
    check("todos os scripts do index.html resolvem para arquivos reais a partir de /dev/", not bad, str(bad))

    bank_path = os.path.join(ROOT, "brasil-quiz", "data", "questions.json")
    try:
        data = json.load(open(bank_path, encoding="utf-8"))
        count = len(data["questions"])
    except Exception as e:
        check("banco real questions.json é JSON válido", False, str(e))
        return
    check("banco real questions.json carrega com 508 questões", count == 508, "count=%d" % count)

# ---------------------------------------------------------------- B) V8
STUB_JS = r"""
(function () {
  'use strict';
  globalThis.fetch = function (url) {
    var u = String(url);
    if (u.indexOf('questions.json') !== -1) {
      return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve(globalThis.__BANK_TEXT); } });
    }
    return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve('<html><head></head><body></body></html>'); } });
  };
  globalThis.DOMParser = function DOMParser() {};
  DOMParser.prototype.parseFromString = function (html, type) {
    return { body: { childNodes: [] }, title: 'stub' }; // injeção no-op no V8; módulos já carregados manualmente
  };
})();
"""

SCENARIO_JS = r"""
(function () {
  'use strict';
  var cfg = BQ5.config;
  var tierKeys = Object.keys(cfg.tiers);
  function historyKey() { var k = (cfg.storageKeys || {}); return k.matchHistory || k.history || 'bq5_match_history_v1'; }

  test('B1a banco real carregado via fetch stub (508 questões)', function () {
    assert(BQ5.bank.loaded() === true, 'loaded=false');
    assert(BQ5.bank.count() === 508, 'count=' + BQ5.bank.count());
  });
  test('B1b menu exibido automaticamente após o boot', function () {
    assert(BQ5.ui.currentScreen() === 'menu', 'screen=' + BQ5.ui.currentScreen());
  });
  test('B1c ação retry-boot registrada (listener único do preview)', function () {
    assert(BQ5.ui.hasListeners('action:retry-boot') === true, 'sem listener');
  });

  test('T1 engine: tempo esgotado vale 0 pontos (regra real do motor)', function () {
    var started = BQ5.engine.start({ mode: 'solo', theme: 'all', diff: tierKeys[0], count: 3 });
    assert(started && started.ok === true, 'start falhou: ' + JSON.stringify(started));
    var nowMs = Date.now();
    BQ5.engine.setClock(function () { return nowMs + 60000; }); // congela além do prazo (clock injetável oficial)
    var r = BQ5.engine.answer(-1);
    assert(r && r.ok === true, 'answer(-1) falhou');
    assert(r.timedOut === true, 'timedOut esperado');
    assert(r.points === 0, 'points=' + r.points);
    BQ5.engine.setClock(null); // restaura Date.now
    var ab = BQ5.engine.abort();
    assert(ab.ok === true && ab.hadGame === true, 'abort: ' + JSON.stringify(ab));
  });

  test('F1 menu -> configuração (intent:solo)', function () {
    var handled = BQ5.ui.emit('intent:solo', { source: 'verify' });
    assert(handled > 0, 'nenhum handler para intent:solo');
    assert(BQ5.ui.currentScreen() === 'setup', 'screen=' + BQ5.ui.currentScreen());
  });
  test('F2 seleção de eixo (cultura) e dificuldade (primeira do config)', function () {
    var s = BQ5.screens.setup;
    assert(s.select('theme', 'cultura') === true, 'select theme cultura');
    assert(s.select('diff', tierKeys[0]) === true, 'select diff ' + tierKeys[0]);
    var st = s.state();
    assert(st.theme === 'cultura' && st.diff === tierKeys[0], JSON.stringify(st));
  });
  test('F3 início da partida solo via setup.start()', function () {
    var r = BQ5.screens.setup.start();
    assert(r && r.ok === true, 'start: ' + JSON.stringify(r));
    var snap = BQ5.engine.state();
    assert(snap && !snap.finished && snap.total >= 1, 'state ausente');
    assert(BQ5.ui.currentScreen() === 'play', 'screen=' + BQ5.ui.currentScreen());
  });

  var plan = null;
  test('F4 responde todas as questões com pontuação real (base + bônus de tempo)', function () {
    var snap0 = BQ5.engine.state();
    var count = snap0.total;
    var secsLimit = Math.round(snap0.timeLimitMs / 1000);
    var cap = (typeof cfg.timeBonusMax === 'number' && isFinite(cfg.timeBonusMax)) ? cfg.timeBonusMax : 7;
    var expectedTotal = 0;
    for (var i = 0; i < count; i++) {
      var q = BQ5.engine.question();
      assert(q && typeof q.a === 'number', 'questão ausente em i=' + i);
      assert(BQ5.screens.play.select(q.a) === true, 'select falhou em i=' + i);
      var res = BQ5.screens.play.confirm();
      assert(res && res.ok === true, 'confirm: ' + JSON.stringify(res));
      assert(res.correct === true, 'esperava acerto');
      var expectPts = (cfg.pointsBase[q.d] || 0) + Math.min(secsLimit, cap);
      assert(res.points === expectPts, 'i=' + i + ' points=' + res.points + ' esperado=' + expectPts);
      expectedTotal += expectPts;
      var adv = BQ5.screens.play.next();
      assert(adv && adv.ok === true, 'next: ' + JSON.stringify(adv));
      if (i < count - 1) { assert(adv.finished === false, 'finalizou cedo'); }
      else {
        assert(adv.finished === true, 'não finalizou na última');
        assert(adv.result && adv.result.score === expectedTotal, 'score=' + (adv.result && adv.result.score) + ' esperado=' + expectedTotal);
        plan = adv.result;
      }
    }
  });
  test('F5 resultados exibidos e estatísticas consistentes', function () {
    assert(BQ5.ui.currentScreen() === 'results', 'screen=' + BQ5.ui.currentScreen());
    var r = BQ5.engine.result();
    assert(r && r.mode === 'solo' && plan && r.total === plan.total, 'result ausente');
    assert(r.right === plan.total && r.pct === 100, JSON.stringify({ right: r.right, total: r.total, pct: r.pct }));
    assert(r.record && r.record.best >= r.score, 'record: ' + JSON.stringify(r.record));
  });
  test('F6 histórico persistido via storage (chave real do results.js)', function () {
    var h = BQ5.storage.getJSON(historyKey(), []);
    assert(Array.isArray(h) && h.length === 1, 'len=' + (Array.isArray(h) ? h.length : '?'));
    if (h.length) assert(h[0].score === plan.score, JSON.stringify(h[0]));
  });
  test('F7 retorno ao menu a partir dos resultados', function () {
    var r = BQ5.screens.results.toMenu();
    assert(r && r.ok === true, 'toMenu: ' + JSON.stringify(r));
    assert(BQ5.ui.currentScreen() === 'menu', 'screen=' + BQ5.ui.currentScreen());
  });
  test('F8 recorde solo persistido (bq5_best_solo)', function () {
    var key = (cfg.storageKeys && cfg.storageKeys.bestSolo) || 'bq5_best_solo';
    var best = BQ5.storage.getJSON(key, 0);
    assert(best >= plan.score, 'best=' + best + ' score=' + plan.score);
  });
})();
"""

def run_v8():
    section("B) Fluxo completo em V8 real (módulos reais M1–M11 + bootstrap do preview)")
    sys.path.insert(0, os.path.join(ROOT, "tests"))
    from harness import make_ctx, load_js  # noqa: E402

    ctx = make_ctx()
    load_js(ctx, "tests/js/bootstrap_setup_play.js")  # stub de DOM já validado pelas suítes do projeto
    modules = [
        "brasil-quiz/js/config.js", "brasil-quiz/js/util.js", "brasil-quiz/js/storage.js",
        "brasil-quiz/js/bank.js", "brasil-quiz/js/engine.js", "brasil-quiz/js/ui.js",
        "brasil-quiz/js/screens/menu.js", "brasil-quiz/js/screens/setup.js",
        "brasil-quiz/js/screens/play.js", "brasil-quiz/js/screens/results.js",
    ]
    for m in modules:
        load_js(ctx, m)

    bank_text = open(os.path.join(ROOT, "brasil-quiz", "data", "questions.json"), encoding="utf-8").read()
    ctx.eval("globalThis.__BANK_TEXT = " + json.dumps(bank_text) + ";")
    ctx.eval(STUB_JS)  # fetch/DOMParser mínimos (sem rede no V8); módulos já carregados acima

    load_js(ctx, "dev/integrated-preview.js")  # auto-executa: shell stub -> injeção no-op -> boot -> loadBank()
    ctx.eval("void 0")  # checkpoint de microtarefas: conclui o encadeamento até menu.show()

    ctx.eval(SCENARIO_JS)
    results = json.loads(ctx.eval("JSON.stringify(__tests__)"))
    for name, ok, err in results:
        print(("  PASS " if ok else "  FAIL ") + name + ("" if ok else ("   -> " + str(err))))
    return sum(1 for _, ok, _ in results if ok), len(results)

# ---------------------------------------------------------------- C) HTTP local
def http_checks():
    section("C) Servidor HTTP local — caminhos reais respondem 200")
    import threading, urllib.request, http.server, socketserver

    srv = None
    for p in range(8765, 8790):
        try:
            handler = type("H", (http.server.SimpleHTTPRequestHandler,), {"directory": ROOT})
            srv = socketserver.TCPServer(("127.0.0.1", p), handler)
            break
        except OSError:
            continue
    if srv is None:
        check("servidor de teste pôde iniciar (porta 8765–8789)", False, "nenhuma porta livre")
        return
    t = threading.Thread(target=srv.serve_forever)
    t.daemon = True
    t.start()
    try:
        page = "http://127.0.0.1:%d/dev/integrated-preview.html" % srv.server_address[1]
        paths = [page,
                 urllib.parse.urljoin(page, "../brasil-quiz/index.html"),
                 urllib.parse.urljoin(page, "../brasil-quiz/css/style.css"),
                 urllib.parse.urljoin(page, "../brasil-quiz/data/questions.json")]
        idx = open(os.path.join(ROOT, "brasil-quiz", "index.html"), encoding="utf-8").read()
        for src in re.findall(r'<script[^>]+src=["\']([^"\']+)["\']', idx):
            paths.append(urllib.parse.urljoin(page, ("../brasil-quiz/" + src) if src.startswith("js/") else src))
        details = []
        ok_all = True
        for u in list(dict.fromkeys(paths)):
            try:
                with urllib.request.urlopen(u, timeout=5) as r:
                    body = r.read()
                    if r.status != 200 or not body:
                        ok_all = False; details.append("%s status=%d len=0" % (u, r.status))
            except Exception as e:
                ok_all = False; details.append("%s %s" % (u, e))
        check("todos os recursos usados pelo preview respondem 200", ok_all, "; ".join(details[:8]))
    finally:
        srv.shutdown()
        t.join(timeout=2)

def main():
    static_checks()
    run_v8()
    http_checks()
    section("RESUMO")
    failed = [n for n, ok, _ in RESULTS if not ok]
    print("%d/%d verificações passaram" % (len(RESULTS) - len(failed), len(RESULTS)))
    if failed:
        print("Falhas:")
        for f in failed:
            print("  - " + f)
    else:
        print("TODAS AS VERIFICAÇÕES PASSARAM")
    sys.exit(1 if failed else 0)

if __name__ == "__main__":
    main()
