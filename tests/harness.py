# -*- coding: utf-8 -*-
"""Harness de teste: roda módulos JS do projeto em V8 real (py-mini-racer),
com stubs mínimos de DOM/localStorage. Uso: importe make_ctx, load_js, run_tests."""
import sys, os, json

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "tools", "deps"))
from py_mini_racer import MiniRacer  # noqa: E402

BOOT_JS = r"""
(function(){
  function makeEl(id){
    const el = { id:id, _html:'', value:'', textContent:'', style:{}, dataset:{}, disabled:false, parentNode:null };
    el.classList = { _s:new Set(), add(c){this._s.add(c);}, remove(c){this._s.delete(c);}, contains(c){return this._s.has(c);} };
    Object.defineProperty(el,'innerHTML',{ set(v){ el._html=String(v); }, get(){ return el._html; } });
    el.addEventListener=function(){}; el.focus=function(){}; el.select=function(){}; el.click=function(){};
    el.querySelector=function(sel){ const k=String(sel).replace(/^#/,''); if(!el.__kids)el.__kids={}; if(!el.__kids[k])el.__kids[k]=makeEl(id+'/'+k); return el.__kids[k]; };
    el.querySelectorAll=function(){ return []; };
    el.appendChild=function(ch){ ch.parentNode=globalThis.document.body; }; el.removeChild=function(){};
    return el;
  }
  const els={};
  globalThis.document = {
    querySelector(sel){ const k=String(sel).replace(/^#/,''); if(!els[k]) els[k]=makeEl(k); return els[k]; },
    getElementById(id){ return document.querySelector('#'+id); },
    querySelectorAll(){ return []; },
    createElement(tag){ return makeEl('created-'+tag+'-'+((document.__n=(document.__n||0)+1))); },
    body: { appendChild(ch){ ch.parentNode=globalThis.document.body; }, removeChild(){} },
    addEventListener(){}, execCommand(){ return true; },
  };
  globalThis.window = globalThis;
  globalThis.__tests=[];
  globalThis.test=function(name,fn){ try{ fn(); __tests.push([name,true,null]); }catch(e){ __tests.push([name,false,String((e&&e.message)||e)]); } };
  globalThis.assert=function(cond,msg){ if(!cond) throw new Error(msg||'assert falhou'); };
  // Teste assíncrono: fn deve retornar uma Promise; a asserção roda no .then.
  // Os resultados só ficam completos após o checkpoint de microtarefas (ver run_tests_async).
  globalThis.testAsync=function(name,fn){
    var p;
    try { p = fn(); } catch(e) { var msg=String((e&&e.message)||e); __tests.push([name,false,msg]); return; }
    if (p && typeof p.then === 'function') {
      p.then(
        function(){ __tests.push([name,true,null]); },
        function(e){ var msg=String((e&&e.message)||e); __tests.push([name,false,msg]); }
      );
    } else { __tests.push([name,false,'testAsync: fn não retornou uma Promise']); }
  };
})();
"""

def _eval_script(ctx, code):
    """Avalia código JS. execute() do mini_racer envolve o código como expressão
    e falha em parses válidos; usamos eval direto. Código que não é uma
    expressão (blocos de testes) é envolvido num IIFE aqui."""
    stripped = code.strip()
    if not (stripped.startswith("(") or stripped.startswith("function") or stripped.startswith("var ")):
        # sequência de declarações/expressões => envolver em função para virar expressão
        code = "(function(){\n" + code + "\nreturn true;})()"
    ctx.eval(code)

def make_ctx():
    ctx = MiniRacer()
    _eval_script(ctx, BOOT_JS)
    return ctx

def load_js(ctx, relpath):
    path = os.path.join(ROOT, relpath.replace("/", os.sep))
    code = open(path, encoding="utf-8").read()
    _eval_script(ctx, code)  # SyntaxError aqui => arquivo com erro de sintaxe (falha o teste)

def run_tests(ctx, test_code, label=""):
    _eval_script(ctx, test_code)
    results = json.loads(ctx.eval("JSON.stringify(__tests)"))
    failed = [r for r in results if not r[1]]
    print(f"--- {label or 'testes'}: {len(results)-len(failed)}/{len(results)} passaram ---")
    for name, ok, err in results:
        print(("  PASS " if ok else "  FAIL ") + name + ("" if ok else f"   -> {err}"))
    return len(results), len(failed)

def run_tests_async(ctx, test_code, label=""):
    """Como run_tests, mas suporta testAsync(): após avaliar o código, força um
    checkpoint de microtarefas (eval vazio) para que os .then pendentes rodem
    antes da leitura dos resultados."""
    _eval_script(ctx, test_code)
    ctx.eval("void 0")  # checkpoint: permite que callbacks de Promise pendentes executem
    results = json.loads(ctx.eval("JSON.stringify(__tests)"))
    failed = [r for r in results if not r[1]]
    print(f"--- {label or 'testes'}: {len(results)-len(failed)}/{len(results)} passaram ---")
    for name, ok, err in results:
        print(("  PASS " if ok else "  FAIL ") + name + ("" if ok else f"   -> {err}"))
    return len(results), len(failed)

def check(total, failed):
    status = "FAIL" if failed else "OK"
    print(f"RESULT: {status}")
    return failed == 0
