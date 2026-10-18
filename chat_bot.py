import os
import json
import aiohttp
import aiosqlite
import asyncio
from datetime import datetime, timedelta
from twitchio.ext import commands, routines

# Automatically load environment variables if dotenv is available
try:
    from dotenv import load_dotenv
    if os.path.exists(".env.channel1"):
        load_dotenv(".env.channel1")
    else:
        load_dotenv()
except ImportError:
    pass

CHANNEL = os.getenv("CHANNEL", "").strip().lstrip('#').lower()
CLIENT_ID = os.getenv("CLIENT_ID", "").strip()
CLIENT_SECRET = os.getenv("CLIENT_SECRET", "").strip()
ENV_CHAT_TOKEN = os.getenv("CHAT_TOKEN") or os.getenv("ACCESS_TOKEN")
ENV_REFRESH_TOKEN = os.getenv("REFRESH_TOKEN")

def resolve_db_file():
    db_env = os.getenv("DB_FILE", "messages.db")
    if os.path.exists(db_env):
        return db_env
    if os.path.exists("messages.db"):
        return "messages.db"
    if os.path.exists("./data/channel1/messages.db"):
        return "./data/channel1/messages.db"
    return db_env

DB_FILE = resolve_db_file()
db_dir = os.path.dirname(DB_FILE)
if db_dir and not os.path.exists(db_dir):
    try:
        os.makedirs(db_dir, exist_ok=True)
    except Exception:
        pass

CONFIG_FILE = os.path.join(db_dir if db_dir else ".", "config.json")

def load_config():
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def save_config(config):
    try:
        cfg_dir = os.path.dirname(CONFIG_FILE)
        if cfg_dir and not os.path.exists(cfg_dir):
            os.makedirs(cfg_dir, exist_ok=True)
        with open(CONFIG_FILE, "w") as f:
            json.dump(config, f, indent=4)
    except Exception as e:
        print(f"[{CHANNEL}] Błąd zapisu pliku config.json: {e}")

async def get_valid_chat_token():
    config = load_config()
    current_token = config.get("chat_token") or ENV_CHAT_TOKEN
    current_refresh = config.get("refresh_token") or ENV_REFRESH_TOKEN

    if not current_token:
        raise ValueError("Brak CHAT_TOKEN lub ACCESS_TOKEN! Dodaj token do pliku .env")

    print(f"[{CHANNEL}] Sprawdzam ważność tokenu czatu (User Access Token)...")
    validate_url = "https://id.twitch.tv/oauth2/validate"
    headers = {"Authorization": f"OAuth {current_token}"}

    async with aiohttp.ClientSession() as session:
        try:
            async with session.get(validate_url, headers=headers, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status == 200:
                    print(f"[{CHANNEL}] Token czatu jest aktualny.")
                    config["chat_token"] = current_token
                    config["refresh_token"] = current_refresh
                    save_config(config)
                    return current_token
                else:
                    print(f"[{CHANNEL}] Token czatu wygasł (lub jest nieważny)! Próbuję odświeżyć...")
        except Exception as e:
            print(f"[{CHANNEL}] Błąd sprawdzania tokenu czatu ({e}), próbuję użyć bieżącego.")
            return current_token

    if not current_refresh:
        raise ValueError("Brak REFRESH_TOKEN do odświeżenia! Wygeneruj nowy token i dodaj go do .env")

    refresh_url = "https://id.twitch.tv/oauth2/token"
    refresh_data = {
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "grant_type": "refresh_token",
        "refresh_token": current_refresh
    }

    async with aiohttp.ClientSession() as session:
        async with session.post(refresh_url, data=refresh_data, timeout=aiohttp.ClientTimeout(total=15)) as resp:
            if resp.status == 200:
                new_tokens = await resp.json()
                new_chat_token = new_tokens["access_token"]
                new_refresh_token = new_tokens.get("refresh_token", current_refresh)

                config["chat_token"] = new_chat_token
                config["refresh_token"] = new_refresh_token
                save_config(config)

                print(f"[{CHANNEL}] Sukces! Pomyślnie odświeżono i zapisano nowy token czatu.")
                return new_chat_token
            else:
                error_text = await resp.text()
                print(f"[{CHANNEL}] KRYTYCZNY BŁĄD ODŚWIEŻANIA TOKENU: {resp.status} - {error_text}")
                raise ValueError("Twój REFRESH_TOKEN również wygasł, został cofnięty lub jest nieprawidłowy. Musisz wygenerować nowe tokeny ręcznie.")

async def get_api_token():
    config = load_config()
    current_time = datetime.utcnow()

    expiry_str = config.get("token_expiry")
    token_valid = False
    if config.get("twitch_token") and expiry_str:
        try:
            if datetime.fromisoformat(expiry_str) > current_time:
                token_valid = True
        except Exception:
            token_valid = False

    if not token_valid:
        url = "https://id.twitch.tv/oauth2/token"
        data = {
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "grant_type": "client_credentials"
        }

        async with aiohttp.ClientSession() as session:
            try:
                async with session.post(url, data=data, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                    if resp.status == 200:
                        token_data = await resp.json()
                        config["twitch_token"] = token_data["access_token"]
                        expires_in = token_data.get("expires_in", 3600)
                        expiry_time = current_time + timedelta(seconds=expires_in - 120)
                        config["token_expiry"] = expiry_time.isoformat()
                        save_config(config)
                        print(f"[{CHANNEL}] Wygenerowano nowy App Token (API).")
                    else:
                        print(f"[{CHANNEL}] Błąd generowania tokenu API: {resp.status}")
                        return None
            except Exception as e:
                print(f"[{CHANNEL}] Wyjątek podczas pobierania tokenu API: {e}")
                return None

    return config.get("twitch_token")

class Bot(commands.Bot):
    def __init__(self, valid_token):
        super().__init__(token=valid_token, prefix="!", initial_channels=[CHANNEL])
        self.stream_id = None
        self._offline_consecutive_checks = 0

    async def event_ready(self):
        print(f"[{CHANNEL}] Pomyślnie połączono z czatem jako {self.nick}!")
        await self.init_db()
        await self.recover_active_stream()
        await self._check_stream_status()

        # Start 2-minute background polling loop
        asyncio.create_task(self.poll_stats_loop())
        print(f"[{CHANNEL}] Uruchomiono pętlę sprawdzania API (co 2 min).")

    async def poll_stats_loop(self):
        while True:
            await asyncio.sleep(120)
            await self._check_stream_status()

    async def init_db(self):
        async with aiosqlite.connect(DB_FILE) as db:
            await db.execute("PRAGMA journal_mode=WAL;")
            await db.execute("PRAGMA busy_timeout=5000;")
            await db.execute("""
                CREATE TABLE IF NOT EXISTS streams (
                    stream_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    channel TEXT NOT NULL,
                    start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    end_time TIMESTAMP
                );
            """)
            await db.execute("""
                CREATE TABLE IF NOT EXISTS messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    stream_id INTEGER,
                    username TEXT NOT NULL,
                    content TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    is_mod BOOLEAN DEFAULT 0,
                    is_vip BOOLEAN DEFAULT 0,
                    is_sub BOOLEAN DEFAULT 0,
                    FOREIGN KEY(stream_id) REFERENCES streams(stream_id)
                );
            """)
            await db.execute("""
                CREATE TABLE IF NOT EXISTS stream_stats (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    stream_id INTEGER,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    viewer_count INTEGER,
                    chat_connections INTEGER,
                    FOREIGN KEY(stream_id) REFERENCES streams(stream_id)
                );
            """)

            # Ensure high-performance indexes
            await db.execute("CREATE INDEX IF NOT EXISTS idx_stream_user ON messages(stream_id, username);")
            await db.execute("CREATE INDEX IF NOT EXISTS idx_created_at ON messages(created_at);")
            await db.execute("CREATE INDEX IF NOT EXISTS idx_messages_username ON messages(username);")
            await db.execute("CREATE INDEX IF NOT EXISTS idx_stream_stats_stream_time ON stream_stats(stream_id, timestamp);")
            await db.execute("CREATE INDEX IF NOT EXISTS idx_streams_start ON streams(start_time);")

            await db.commit()

    async def fetch_live_status(self):
        """
        Queries Twitch Helix API.
        Returns:
            (True, viewers) - live
            (False, 0) - confirmed offline
            (None, None) - API error / network issue (do not end stream prematurely!)
        """
        token = await get_api_token()
        if not token:
            print(f"[{CHANNEL}] BŁĄD: Brak aktywnego tokenu API!")
            return None, None

        clean_channel = CHANNEL.strip().lstrip('#').lower()
        url = f"https://api.twitch.tv/helix/streams?user_login={clean_channel}"
        headers = {
            "Client-ID": CLIENT_ID.strip(),
            "Authorization": f"Bearer {token}"
        }

        async with aiohttp.ClientSession() as session:
            try:
                async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        if data.get("data"):
                            viewers = data["data"][0]["viewer_count"]
                            print(f"[API] Stream {clean_channel} ONLINE. Widzów: {viewers}")
                            return True, viewers
                        else:
                            print(f"[API] Stream {clean_channel} OFFLINE (Twitch zwrócił pustą listę).")
                            return False, 0
                    elif resp.status == 401:
                        print(f"[API] Odrzucono token API (Błąd 401). Wymuszam odświeżenie...")
                        config = load_config()
                        config["token_expiry"] = ""
                        save_config(config)
                        return None, None
                    else:
                        text = await resp.text()
                        print(f"[API] Nieoczekiwana odpowiedź API HTTP {resp.status}: {text}")
                        return None, None
            except Exception as e:
                print(f"[API] Błąd połączenia z serwerami Twitcha: {e}")
                return None, None

    async def recover_active_stream(self):
        async with aiosqlite.connect(DB_FILE) as db:
            cursor = await db.execute("SELECT stream_id FROM streams WHERE end_time IS NULL ORDER BY stream_id ASC")
            open_streams = await cursor.fetchall()

            if not open_streams:
                return

            try:
                is_live, _ = await self.fetch_live_status()
            except Exception:
                is_live = None

            # If check failed (e.g. temporary network issue on startup), keep stream open
            if is_live is None:
                self.stream_id = open_streams[-1][0]
                print(f"[{CHANNEL}] Nie udało się zweryfikować statusu API przy starcie. Zachowuję aktywną sesję: {self.stream_id}")
                return

            if is_live:
                self.stream_id = open_streams[-1][0]
                streams_to_close = open_streams[:-1]
            else:
                self.stream_id = None
                streams_to_close = open_streams

            for (s_id,) in streams_to_close:
                cursor = await db.execute("SELECT MAX(timestamp) FROM stream_stats WHERE stream_id = ?", (s_id,))
                row = await cursor.fetchone()
                end_t = row[0] if row and row[0] else None

                if not end_t:
                    cursor = await db.execute("SELECT MAX(created_at) FROM messages WHERE stream_id = ?", (s_id,))
                    row_msg = await cursor.fetchone()
                    end_t = row_msg[0] if row_msg and row_msg[0] else None

                if end_t:
                    await db.execute("UPDATE streams SET end_time = ? WHERE stream_id = ?", (end_t, s_id))
                else:
                    await db.execute("UPDATE streams SET end_time = CURRENT_TIMESTAMP WHERE stream_id = ?", (s_id,))

            await db.commit()
            if self.stream_id:
                print(f"[{CHANNEL}] Uratowano aktywną sesję streamu: {self.stream_id}")
            if streams_to_close:
                print(f"[{CHANNEL}] Auto-zamknięto {len(streams_to_close)} osieroconych streamów.")

    async def start_new_stream_session(self):
        async with aiosqlite.connect(DB_FILE) as db:
            await db.execute("INSERT INTO streams (channel) VALUES (?)", (CHANNEL,))
            await db.commit()
            cursor = await db.execute("SELECT last_insert_rowid()")
            row = await cursor.fetchone()
            self.stream_id = row[0]

    async def end_stream_session(self):
        if self.stream_id is not None:
            async with aiosqlite.connect(DB_FILE) as db:
                cursor = await db.execute("SELECT MAX(timestamp) FROM stream_stats WHERE stream_id = ?", (self.stream_id,))
                row = await cursor.fetchone()
                end_t = row[0] if row and row[0] else None

                if not end_t:
                    cursor = await db.execute("SELECT MAX(created_at) FROM messages WHERE stream_id = ?", (self.stream_id,))
                    row_msg = await cursor.fetchone()
                    end_t = row_msg[0] if row_msg and row_msg[0] else None

                if end_t:
                    await db.execute("UPDATE streams SET end_time = ? WHERE stream_id = ?", (end_t, self.stream_id))
                else:
                    await db.execute("UPDATE streams SET end_time = CURRENT_TIMESTAMP WHERE stream_id = ?", (self.stream_id,))
                await db.commit()
            self.stream_id = None

    async def event_message(self, message):
        if message.echo or not message.author:
            return

        username = message.author.name.lower()
        content = message.content.strip() if message.content else ""

        badges = message.author.badges or {}
        is_mod = 1 if ('moderator' in badges or 'broadcaster' in badges) else 0
        is_vip = 1 if 'vip' in badges else 0
        is_sub = 1 if ('subscriber' in badges or 'founder' in badges) else 0

        try:
            async with aiosqlite.connect(DB_FILE) as db:
                await db.execute("""
                    INSERT INTO messages (stream_id, username, content, is_mod, is_vip, is_sub)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (self.stream_id, username, content, is_mod, is_vip, is_sub))
                await db.commit()
        except Exception as e:
            print(f"[{CHANNEL}] Błąd zapisu wiadomości od {username}: {e}")


    async def _check_stream_status(self):
        try:
            is_live, viewer_count = await self.fetch_live_status()

            if is_live is None:
                # Network error or API glitch: do not close stream session
                print(f"[{CHANNEL}] Pomijam aktualizację statusu streama z powodu błędu API/sieci.")
                return

            if is_live:
                self._offline_consecutive_checks = 0
                if self.stream_id is None:
                    await self.start_new_stream_session()
                    print(f"[{CHANNEL}] 🔴 Wykryto start streama! Rozpoczęto nową sesję (ID: {self.stream_id}).")

                async with aiosqlite.connect(DB_FILE) as db:
                    await db.execute("INSERT INTO stream_stats (stream_id, viewer_count, chat_connections) VALUES (?, ?, 0)", (self.stream_id, viewer_count))
                    await db.commit()

            else:
                if self.stream_id is not None:
                    self._offline_consecutive_checks += 1
                    if self._offline_consecutive_checks >= 2:
                        print(f"[{CHANNEL}] ⚫ Potwierdzono koniec streama (2 kolejne odpytania). Zamykam sesję (ID: {self.stream_id}).")
                        await self.end_stream_session()
                        self._offline_consecutive_checks = 0
                    else:
                        print(f"[{CHANNEL}] Stream zgłoszony jako offline ({self._offline_consecutive_checks}/2). Czekam na potwierdzenie w następnym cyklu.")
        except Exception as e:
            print(f"[{CHANNEL}] Wyjątek podczas _check_stream_status: {e}")

async def main():
    if not CHANNEL or not CLIENT_ID or not CLIENT_SECRET:
        print("[BŁĄD] Brak wymaganych zmiennych CHANNEL, CLIENT_ID, CLIENT_SECRET w pliku .env!")
        return

    valid_token = await get_valid_chat_token()
    bot = Bot(valid_token)
    await bot.start()

if __name__ == "__main__":
    asyncio.run(main())
