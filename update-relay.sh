#!/usr/bin/env bash
# Updates the Frills relay on your phone in one step. Run it in Termux:
#
#     bash ~/frills/update-relay.sh
#
# It stops the relay, gets the new code from GitHub, installs what the relay needs, starts it again, and shows the health check.
# The Cloudflare tunnel is not touched: leave its tmux session ("tunnel") running.
# Put persistent settings (EULER_API_KEY, RELAY_OWNER_KEY, RELAY_SLOTS=auto, EULER_DAILY_RESERVE=100, RELAY_PRIORITY_USERS=yourhandle)
# inside ~/.frills-relay.env (plain KEY=VALUE lines, no `export` needed). Command-line overrides also work:
#     RELAY_SLOTS=60 bash ~/frills/update-relay.sh
#     RELAY_ALERT_SPOTS=15 bash ~/frills/update-relay.sh
#     RELAY_PER_IP=100 RELAY_ACCOUNTS_PER_IP=20 bash ~/frills/update-relay.sh

set -e
cd "$(dirname "$0")"
CLI_SLOTS="${RELAY_SLOTS:-}"
CLI_ALERT="${RELAY_ALERT_SPOTS:-}"

echo "1/4  Stopping the relay..."
tmux kill-session -t relay 2>/dev/null || true

echo "2/4  Getting the new code..."
git pull

echo "3/4  Installing what the relay needs..."
(cd helper && npm install --no-audit --no-fund)

# The settings file, if there is one (the owner password, Euler key, priority users, and slot config live there), is read before the relay starts.
LOAD=""
if [ -f "$HOME/.frills-relay.env" ]; then
  LOAD="set -a && . '$HOME/.frills-relay.env' && set +a && "
  echo "     (using the settings in ~/.frills-relay.env)"
fi

echo "4/4  Starting the relay..."
tmux new-session -d -s relay "cd '$PWD' && ${LOAD}${CLI_SLOTS:+export RELAY_SLOTS='$CLI_SLOTS' && }${CLI_ALERT:+export RELAY_ALERT_SPOTS='$CLI_ALERT' && }${RELAY_PER_IP:+export RELAY_PER_IP='$RELAY_PER_IP' && }${RELAY_ACCOUNTS_PER_IP:+export RELAY_ACCOUNTS_PER_IP='$RELAY_ACCOUNTS_PER_IP' && }export RELAY_SLOTS=\"\${RELAY_SLOTS:-auto}\" RELAY_ALERT_SPOTS=\"\${RELAY_ALERT_SPOTS:-10}\" && npm run relay"

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
