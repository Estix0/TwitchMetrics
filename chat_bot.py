import os
import aiohttp
import aiosqlite
import asyncio
from datetime import datetime
from twitchio.ext import commands, routines

CHANNEL = os.getenv("CHANNEL")
CLIENT_ID = os.getenv("CLIENT_ID")
CLIENT_SECRET = os.getenv("CLIENT_SECRET")
DB_FILE = os.getenv("DB_FILE", "messages.db")

INITIAL_ACCESS_TOKEN = os.getenv("ACCESS_TOKEN") 
INITIAL_REFRESH_TOKEN = os.getenv("REFRESH_TOKEN")

async def get_valid_token():
    async with aiosqlite.connect(DB_FILE) as db:
        await db.execute("CREATE TABLE IF NOT EXISTS auth (id INTEGER PRIMARY KEY CHECK (id = 1), access_token TEXT, refresh_token TEXT)")
        await db.commit()
        
        cursor = await db.execute("SELECT access_token, refresh_token FROM auth WHERE id = 1")
        row = await cursor.fetchone()
        
        if row:
            access_token, refresh_token = row
        else:
            access_token, refresh_token = INITIAL_ACCESS_TOKEN, INITIAL_REFRESH_TOKEN
            await db.execute("INSERT INTO auth (id, access_token, refresh_token) VALUES (1, ?, ?)", (access_token, refresh_token))
            await db.commit()

    async with aiohttp.ClientSession() as session:
        headers = {"Authorization": f"OAuth {access_token}"}
        async with session.get("https://id.twitch.tv/oauth2/validate", headers=headers) as resp:
            if resp.status == 200:
                return access_token
                
        url = "https://id.twitch.tv/oauth2/token"
        data = {
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "grant_type": "refresh_token",
            "refresh_token": refresh_token
        }
        
        async with session.post(url, data=data) as resp:
            if resp.status != 200:
                os._exit(1)
                
            tokens = await resp.json()
            new_access_token = tokens["access_token"]
            new_refresh_token = tokens.get("refresh_token", refresh_token) 
            
    async with aiosqlite.connect(DB_FILE) as db:
        await db.execute("UPDATE auth SET access_token = ?, refresh_token = ? WHERE id = 1", (new_access_token, new_refresh_token))
        await db.commit()
        
    return new_access_token

class Bot(commands.Bot):
    def __init__(self, token):
        super().__init__(token=token, prefix="!", initial_channels=[CHANNEL])
        self.stream_id = None

    async def event_ready(self):
        await self.init_db()
        await self.recover_active_stream()
        await self._check_stream_status() 
        self.poll_stats.start()

    async def init_db(self):
        async with aiosqlite.connect(DB_FILE) as db:
            await db.execute("PRAGMA journal_mode=WAL;")
            await db.execute("CREATE TABLE IF NOT EXISTS streams (stream_id INTEGER PRIMARY KEY AUTOINCREMENT, channel TEXT NOT NULL, start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP, end_time TIMESTAMP);")
            await db.execute("CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, stream_id INTEGER, username TEXT NOT NULL, content TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(stream_id) REFERENCES streams(stream_id));")
            
            try: await db.execute("ALTER TABLE messages ADD COLUMN is_mod BOOLEAN DEFAULT 0")
            except Exception: pass
            try: await db.execute("ALTER TABLE messages ADD COLUMN is_vip BOOLEAN DEFAULT 0")
            except Exception: pass
            try: await db.execute("ALTER TABLE messages ADD COLUMN is_sub BOOLEAN DEFAULT 0")
            except Exception: pass
            
            await db.execute("CREATE INDEX IF NOT EXISTS idx_stream_user ON messages(stream_id, username);")
            await db.execute("CREATE INDEX IF NOT EXISTS idx_created_at ON messages(created_at);")
            await db.execute("CREATE TABLE IF NOT EXISTS stream_stats (id INTEGER PRIMARY KEY AUTOINCREMENT, stream_id INTEGER, timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP, viewer_count INTEGER, chat_connections INTEGER, FOREIGN KEY(stream_id) REFERENCES streams(stream_id));")
            await db.commit()

    async def recover_active_stream(self):
        async with aiosqlite.connect(DB_FILE) as db:
            cursor = await db.execute("SELECT stream_id FROM streams WHERE end_time IS NULL ORDER BY stream_id ASC")
            open_streams = await cursor.fetchall()
            
            if not open_streams:
                return

            try:
                live_data = await self.fetch_streams(user_logins=[CHANNEL])
                is_live = len(live_data) > 0
            except:
                is_live = False

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
                
                if end_t:
                    await db.execute("UPDATE streams SET end_time = ? WHERE stream_id = ?", (end_t, s_id))
                else:
                    await db.execute("UPDATE streams SET end_time = start_time WHERE stream_id = ?", (s_id,))
            
            await db.commit()
            if self.stream_id:
                print(f"[{CHANNEL}] Recovered active stream session: {self.stream_id}")
            if streams_to_close:
                print(f"[{CHANNEL}] Auto-closed {len(streams_to_close)} ghost streams.")

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
                
                if end_t:
                    await db.execute("UPDATE streams SET end_time = ? WHERE stream_id = ?", (end_t, self.stream_id))
                else:
                    await db.execute("UPDATE streams SET end_time = CURRENT_TIMESTAMP WHERE stream_id = ?", (self.stream_id,))
                await db.commit()
            self.stream_id = None

    async def event_message(self, message):
        if message.echo:
            return

        username = message.author.name.lower()
        content = message.content.strip() 

        badges = message.author.badges or {}
        is_mod = 1 if 'moderator' in badges or 'broadcaster' in badges else 0
        is_vip = 1 if 'vip' in badges else 0
        is_sub = 1 if 'subscriber' in badges or 'founder' in badges else 0

        async with aiosqlite.connect(DB_FILE) as db:
            await db.execute("""
                INSERT INTO messages (stream_id, username, content, is_mod, is_vip, is_sub)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (self.stream_id, username, content, is_mod, is_vip, is_sub))
            await db.commit()

    @routines.routine(minutes=2)
    async def poll_stats(self):
        await self._check_stream_status()

    async def _check_stream_status(self):
        try:
            streams = await self.fetch_streams(user_logins=[CHANNEL])
            if streams:
                viewer_count = streams[0].viewer_count
                if self.stream_id is None:
                    await self.start_new_stream_session()

                async with aiosqlite.connect(DB_FILE) as db:
                    await db.execute("INSERT INTO stream_stats (stream_id, viewer_count, chat_connections) VALUES (?, ?, 0)", (self.stream_id, viewer_count))
                    await db.commit()
            else:
                if self.stream_id is not None:
                    await self.end_stream_session()
        except Exception as e:
            if "401" in str(e) or "Unauthorized" in str(e):
                os._exit(1)

async def main():
    valid_token = await get_valid_token()
    bot = Bot(valid_token)
    await bot.start()

if __name__ == "__main__":
    asyncio.run(main())
