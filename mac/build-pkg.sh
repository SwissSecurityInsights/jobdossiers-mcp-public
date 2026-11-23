#!/bin/sh
# Costruisce dist/Jobdossiers-<versione>-mac-arm64.pkg da dist/Jobdossiers.app (prima mac/build-app.sh): installer di macOS che copia l'app in /Applicazioni.
# Senza firma Apple: al primo avvio del pacchetto macOS chiede conferma (Impostazioni di Sistema → Privacy e sicurezza → Apri comunque);
# l'app installata dal pacchetto poi si apre senza altri avvisi.
set -eu
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./package.json').version")
APP=dist/Jobdossiers.app
OUT="dist/Jobdossiers-$VERSION-mac-arm64.pkg"
[ -d "$APP" ] || { echo "Manca $APP: esegui prima mac/build-app.sh"; exit 1; }

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/root"
ditto "$APP" "$WORK/root/Jobdossiers.app"
# Non rilocabile: l'installer scrive sempre in /Applications, non in una copia dell'app trovata altrove (es. dist/).
pkgbuild --analyze --root "$WORK/root" "$WORK/component.plist" >/dev/null
plutil -replace 0.BundleIsRelocatable -bool NO "$WORK/component.plist"
# postinstall: riapre l'app a fine installazione (aggiornamento automatico)
pkgbuild --quiet --root "$WORK/root" --component-plist "$WORK/component.plist" --scripts mac/pkg-scripts --install-location /Applications \
  --identifier ch.jobdossiers.app --version "$VERSION" "$WORK/Jobdossiers.pkg"
productbuild --synthesize --package "$WORK/Jobdossiers.pkg" "$WORK/distribution.xml" >/dev/null
# Titolo e macOS minimo (come LSMinimumSystemVersion in mac/Info.plist)
sed -i '' "s#<installer-gui-script minSpecVersion=\"[0-9]*\">#&<title>Jobdossiers $VERSION</title><allowed-os-versions><os-version min=\"14.0\"/></allowed-os-versions>#" "$WORK/distribution.xml"
productbuild --quiet --distribution "$WORK/distribution.xml" --package-path "$WORK" "$OUT"
echo "Pronto: $OUT"
