#!/bin/sh
set -eu
# Das Volume auch nach einer Änderung der Abhängigkeiten aktualisieren.
npm install
exec node scripts/dev.mjs
