#!/bin/zsh
# APEX: serves the game on http://localhost:8642 and opens it in the browser. Close this window to stop the server.
cd "$(dirname "$0")"
PORT=8642
if ! lsof -i :$PORT >/dev/null 2>&1; then
  python3 -m http.server $PORT --bind 127.0.0.1 >/dev/null 2>&1 &
  SERVER=$!
  trap "kill $SERVER 2>/dev/null" EXIT
  sleep 1
fi
open "http://localhost:$PORT/index.html"
echo "APEX läuft auf http://localhost:$PORT  (Fenster offen lassen, schließen beendet den Server)"
wait
