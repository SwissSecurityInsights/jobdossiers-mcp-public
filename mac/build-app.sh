#!/bin/sh
# Costruisce dist/Jobdossiers.app per l'architettura di questo Mac, con firma ad-hoc,
# e ci mette dentro il server MCP compilato con bun (node scripts/build.mjs).
set -eu
cd "$(dirname "$0")"

case "$(uname -m)" in x86_64) T=darwin-x64 ;; *) T=darwin-arm64 ;; esac
(cd .. && node scripts/build.mjs "$T")

swift build -c release
BIN="$(swift build -c release --show-bin-path)/Jobdossiers"
APP=../dist/Jobdossiers.app
VERSION=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' ../package.json | head -1)

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/Jobdossiers"
sed "s/__VERSION__/${VERSION:-0.0.0}/g" Info.plist > "$APP/Contents/Info.plist"

cp "../dist/jobdossiers-mcp-$T" "$APP/Contents/Resources/jobdossiers-mcp"
# Estensione per Chrome ed Edge (prototipo: si carica come estensione non pacchettizzata da qui)
cp -R ../extension "$APP/Contents/Resources/estensione"
codesign --force --sign - "$APP/Contents/Resources/jobdossiers-mcp"

codesign --force --sign - "$APP"
echo "Pronta: $(cd ../dist && pwd)/Jobdossiers.app"
