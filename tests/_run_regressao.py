"""Rodador compacto da regressão (usa o próprio subprocess do Python)."""
import os, subprocess, sys

SCRIPTS = [
    "run_campaign.py", "run_ui_menu.py", "run_ui_structure.py", "run_bank.py",
    "run_engine.py", "run_setup_play.py", "run_results_v8.py", "run_storage.py",
]
root = os.path.dirname(os.path.abspath(__file__))
bad = 0
for s in SCRIPTS:
    p = os.path.join(root, s)
    if not os.path.isfile(p):
        print(s.ljust(22), "-> MISSING"); bad += 1; continue
    r = subprocess.run([sys.executable, p], capture_output=True, text=True)
    out = (r.stdout + r.stderr).strip().splitlines()
    tail = out[-1] if out else ""
    nfail = sum(1 for l in out if "FAIL" in l.upper())
    if r.returncode != 0 or nfail:
        bad += 1
    print(s.ljust(22), "rc=%d fails=%d | %s" % (r.returncode, nfail, tail[:70]))
print("RESULTADO:", "TUDO VERDE" if bad == 0 else "%d SUITE(S) COM PROBLEMA" % bad)
sys.exit(1 if bad else 0)
