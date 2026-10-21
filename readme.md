# TwitchMetrics 🚀

TwitchMetrics is an optimized, real-time chat and broadcast analytics platform designed for streaming purposes. It combines an automated IRC chat ingestion bot with the official Twitch Helix API, delivering comprehensive audience engagement insights, stream metrics, and interactive community tools through a modern web dashboard.

---

## 🌟 Key Features

- 💬 **Real-Time Chat Ingestion**: Records incoming chat messages, user identifiers, badges (Broadcaster, Moderator, VIP, Subscriber), and millisecond-accurate timestamps.
- 🔴 **Broadcast Lifecycle Tracking**: Automated detection of stream start and end events, with periodic Helix API sampling for viewer counts, game categories, and stream titles.
- 📊 **Modern Web Dashboard**:
  - **Channel Overview**: Message volume trends, unique chatters count, hourly and daily activity heatmaps, and chatter leaderboards.
  - **Viewer Loyalty & Profiling**: Retention and loyalty scoring (% of broadcast sessions attended since discovery), average activity frequency, search with autocomplete, and message history with CSV export.
  - **Stream Deep-Dive**: Live viewer curves, chatter-to-lurker ratio breakdown, hype peak detection (highest chat velocity minute), and top keyword/emote clouds.
- 🎮 **Interactive StreamTools**: Integrated live broadcast engagement tools (Live Quiz, Giveaways, chat-driven games, and session rankings).
- 🔒 **Performance & Reliability**: Lightweight single-port architecture, optional webpanel password protection, and SQLite configured with WAL mode (Write-Ahead Logging) for seamless concurrent read/write operations.

---

## 🛠️ Tech Stack

- **Backend**: Python 3.11+, FastAPI, Uvicorn, SQLite3 (WAL mode).
- **Twitch APIs**: Twitch IRC (SSL/WebSocket) + Twitch Helix REST API.
- **Frontend**: Vanilla HTML5, CSS3, modern JavaScript (ES6+), Chart.js.
- **Deployment**: Docker & Docker Compose containerization.
