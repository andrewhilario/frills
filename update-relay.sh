#!/usr/bin/env bash
# Updates the Frills relay on your phone in one step. Run it in Termux:
#
#     bash ~/frills/update-relay.sh
#
# It stops the relay, gets the new code from GitHub, installs what the relay needs, starts it again, and shows the health check.
# The Cloudflare tunnel is not touched: leave its tmux session ("tunnel") running.
# The number of spots is 50 unless you say otherwise:   RELAY_SLOTS=30 bash ~/frills/update-relay.sh
# The warning comes at 10 spots left unless you say otherwise:   RELAY_ALERT_SPOTS=15 bash ~/frills/update-relay.sh

set -e
cd "$(dirname "$0")"
SLOTS="${RELAY_SLOTS:-50}"

echo "1/4  Stopping the relay..."
tmux kill-session -t relay 2>/dev/null || true

echo "2/4  Getting the new code..."
git pull

echo "3/4  Installing what the relay needs..."
(cd helper && npm install --no-audit --no-fund)

echo "4/4  Starting the relay with $SLOTS spots..."
tmux new-session -d -s relay "cd '$PWD/helper' && RELAY_SLOTS=$SLOTS RELAY_ALERT_SPOTS=${RELAY_ALERT_SPOTS:-10} npm run relay"

sleep 6
echo
echo "Health check:"
if curl -fsS http://127.0.0.1:8765/health; then
  echo
  echo "Done. (To watch it: tmux attach -t relay, then Ctrl+B and D to leave it running.)"
else
  echo
  echo "The relay is not answering yet. Wait a few seconds and run:  curl http://127.0.0.1:8765/health"
  echo "If it still does not answer, look at it with:  tmux attach -t relay"
fi
