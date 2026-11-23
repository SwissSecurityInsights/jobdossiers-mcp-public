#!/bin/sh
# Costruisce dist/Jobdossiers-Setup-<versione>-x64.exe (installer) e dist/Jobdossiers-win-x64.zip (portatile) da macOS o Linux: app per l'area di notifica (.NET, file unico autonomo) e server MCP per Windows (bun).
# Richiede l'SDK di .NET 10 (anche in ~/.dotnet), bun e makensis. Senza firma: al primo avvio Windows mostra l'avviso di SmartScreen.
set -eu
cd "$(dirname "$0")"
export PATH="$HOME/.dotnet:$PATH" DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1

(cd .. && node scripts/build.mjs windows-x64)
dotnet test tests/Jobdossiers.Tests
OUT=../dist/Jobdossiers-win-x64
rm -rf "$OUT" "$OUT.zip"
dotnet publish src/Jobdossiers.Win -c Release -r win-x64 --self-contained \
  -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true -p:DebugType=none -o "$OUT"
cp ../dist/jobdossiers-mcp-windows-x64.exe "$OUT/jobdossiers-mcp.exe"
cp -R ../extension "$OUT/estensione"
printf '{"built_at":"%s","commit":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(git -C .. rev-parse --short HEAD 2>/dev/null || echo sviluppo)" > "$OUT/estensione/build.json"
cat > "$OUT/LEGGIMI.txt" <<'EOF'
Jobdossiers per Windows (prototipo)

1. Tieni Jobdossiers.exe e jobdossiers-mcp.exe nella stessa cartella e avvia Jobdossiers.exe.
   Al primo avvio Windows può mostrare "Windows ha protetto il PC": Ulteriori informazioni, poi Esegui comunque (l'app non è firmata).
2. L'icona compare nell'area di notifica (in basso a destra, freccia ^ se nascosta). Clic destro: Impostazioni.
3. Salva la chiave jda1.… (cifrata con DPAPI per il tuo utente) e premi Configura accanto a Claude Desktop, poi riavvia Claude.

Il server viene copiato in %LOCALAPPDATA%\Jobdossiers\jobdossiers-mcp.exe: i client MCP puntano lì.

Estensione per Chrome ed Edge (prototipo): in edge://extensions o chrome://extensions attiva la modalità sviluppatore,
"Carica decompressa" e scegli %LOCALAPPDATA%\Jobdossiers\estensione (l'installer la copia lì).
EOF
(cd ../dist && rm -f Jobdossiers-win-x64.zip && zip -qr Jobdossiers-win-x64.zip Jobdossiers-win-x64)
# Installer (NSIS, si compila anche da macOS: brew install makensis; senza un locale impostato makensis va in crash)
VERSION=$(sed -n 's/.*<Version>\(.*\)<\/Version>.*/\1/p' src/Jobdossiers.Win/Jobdossiers.Win.csproj)
LC_ALL=en_US.UTF-8 makensis -V2 -DVERSION="$VERSION" -DSRC="$(cd "$OUT" && pwd)" -DOUT="$(cd ../dist && pwd)/Jobdossiers-Setup-$VERSION-x64.exe" installer/jobdossiers.nsi
ls -la "$OUT" ../dist/Jobdossiers-win-x64.zip ../dist/Jobdossiers-Setup-*-x64.exe
