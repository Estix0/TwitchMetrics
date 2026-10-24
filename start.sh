#!/bin/bash
set -e

echo "🚀 Uruchamianie TwitchMetrics..."

# Uruchomienie bota czatu Twitch w tle
python chat_bot.py &
BOT_PID=$!

# Uruchomienie zunifikowanego serwera API + Webpanel z pollingiem dla Docker bind-mount
PORT=${PORT:-8000}
echo "🌐 Webpanel i API startują na porcie $PORT..."
export WATCHFILES_FORCE_POLLING=true
uvicorn api:app --host 0.0.0.0 --port "$PORT" --reload &
API_PID=$!

# Obsługa sygnałów wyłączenia (SIGTERM / SIGINT)
trap "kill -TERM $BOT_PID $API_PID 2>/dev/null; exit 0" SIGINT SIGTERM

wait