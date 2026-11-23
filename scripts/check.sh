#!/bin/sh
# Controlli in locale prima di ogni commit e PR: gli stessi della CI (ci.yml), che nel repo privato parte solo a mano.
#   sh scripts/check.sh          Node, Swift (se c'è swift), .NET (se c'è dotnet), gitleaks (se c'è)
#   sh scripts/check.sh --build  in più costruisce l'app per Mac e l'installer per Windows (serve bun, e makensis per l'installer)
# La prova dell'installer su Windows (win/tests/smoke.ps1) richiede Windows: macchina virtuale o «Prova Windows» lanciata a mano su GitHub.
set -u
cd "$(dirname "$0")/.."
export PATH="$HOME/.dotnet:$PATH" DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
fail=0
step() { printf '\n== %s\n' "$1"; }
ok() { printf 'OK   %s\n' "$1"; }
ko() { printf 'KO   %s\n' "$1"; fail=$((fail + 1)); }
skip() { printf 'SALTO %s\n' "$1"; }

step "Node (npm test)"
if npm test >/tmp/jd-check-node.log 2>&1; then ok "$(grep -E '^ℹ pass' /tmp/jd-check-node.log | sed 's/ℹ //') test Node"; else ko "test Node: vedi /tmp/jd-check-node.log"; grep -E '^✖' /tmp/jd-check-node.log | head -10; fi

step "Swift (app per Mac)"
if command -v swift >/dev/null 2>&1; then
  if (cd mac && swift test) >/tmp/jd-check-swift.log 2>&1; then ok "$(grep -E 'Executed [0-9]+ tests' /tmp/jd-check-swift.log | tail -1 | sed 's/^[[:space:]]*//')"; else ko "test Swift: vedi /tmp/jd-check-swift.log"; fi
else skip "swift non installato"; fi

step ".NET (app per Windows)"
if command -v dotnet >/dev/null 2>&1; then
  if dotnet test win/tests/Jobdossiers.Tests >/tmp/jd-check-dotnet.log 2>&1 && dotnet build win/src/Jobdossiers.Win -c Release -v q >>/tmp/jd-check-dotnet.log 2>&1; then
    ok "test .NET e compilazione dell'app Windows"
  else ko ".NET: vedi /tmp/jd-check-dotnet.log"; fi
else skip "dotnet non installato"; fi

step "Segreti (gitleaks)"
if command -v gitleaks >/dev/null 2>&1; then
  if gitleaks detect --no-banner --redact --source . >/tmp/jd-check-gitleaks.log 2>&1; then ok "nessun segreto nella storia"; else ko "gitleaks: vedi /tmp/jd-check-gitleaks.log"; fi
else skip "gitleaks non installato"; fi

if [ "${1:-}" = "--build" ]; then
  step "Costruzione"
  if sh mac/build-app.sh >/tmp/jd-check-build.log 2>&1 && sh mac/build-pkg.sh >>/tmp/jd-check-build.log 2>&1; then ok "app e installer per Mac in dist/"; else ko "costruzione Mac: vedi /tmp/jd-check-build.log"; fi
  if command -v makensis >/dev/null 2>&1 && command -v dotnet >/dev/null 2>&1; then
    if sh win/build.sh >>/tmp/jd-check-build.log 2>&1; then ok "installer per Windows in dist/"; else ko "costruzione Windows: vedi /tmp/jd-check-build.log"; fi
  else skip "makensis o dotnet mancanti: niente installer Windows"; fi
fi

echo
if [ "$fail" -eq 0 ]; then echo "Tutto a posto."; else echo "$fail controlli falliti."; fi
exit "$fail"
