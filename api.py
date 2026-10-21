import os
import io
import csv
import json
import time
import random
import sqlite3
import traceback
from datetime import datetime, timedelta, timezone
import zoneinfo
from typing import Optional, List, Dict, Any
from contextlib import contextmanager, asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, Header, Depends, status, Response, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

# Load environment variables if .env file exists
try:
    from dotenv import load_dotenv
    if os.path.exists(".env.channel1"):
        load_dotenv(".env.channel1")
    else:
        load_dotenv()
except ImportError:
    pass

def resolve_db_file():
    db_env = os.getenv("DB_FILE", "messages.db")
    if os.path.exists(db_env):
        return db_env
    if os.path.exists("messages.db"):
        return "messages.db"
    if os.path.exists("./data/channel1/messages.db"):
        return "./data/channel1/messages.db"
    return db_env

def resolve_channel_name():
    ch = os.getenv("CHANNEL")
    if ch:
        return ch.strip().lstrip('#')
    try:
        current_db = resolve_db_file()
        if os.path.exists(current_db):
            with sqlite3.connect(current_db) as conn:
                row = conn.execute("SELECT channel FROM streams WHERE channel IS NOT NULL AND channel != '' LIMIT 1").fetchone()
                if row and row[0]:
                    return row[0].strip().lstrip('#')
    except Exception:
        pass
    return "Streamer"

DB_FILE = resolve_db_file()
CHANNEL = resolve_channel_name()
PANEL_PASSWORD = os.getenv("PANEL_PASSWORD", "").strip()
PANEL_TIMEZONE = os.getenv("PANEL_TIMEZONE", "Europe/Warsaw").strip()

def get_target_timezone(
    x_timezone: Optional[str] = Header(None, alias="X-Timezone"),
    tz: Optional[str] = Query(None)
) -> str:
    """Resolve active timezone from query param, header, or system default."""
    candidate = tz or x_timezone or PANEL_TIMEZONE
    try:
        zoneinfo.ZoneInfo(candidate)
        return candidate
    except Exception:
        try:
            zoneinfo.ZoneInfo(PANEL_TIMEZONE)
            return PANEL_TIMEZONE
        except Exception:
            return "Europe/Warsaw"

def _resolve_tz(tz_name: Optional[str]):
    candidate = tz_name or PANEL_TIMEZONE
    try:
        return zoneinfo.ZoneInfo(candidate)
    except Exception:
        try:
            return zoneinfo.ZoneInfo(PANEL_TIMEZONE)
        except Exception:
            return timezone.utc

def to_local_datetime(utc_str: Optional[str], tz_name: Optional[str] = None) -> Optional[str]:
    if not utc_str:
        return None
    try:
        target_tz = _resolve_tz(tz_name)
        dt = datetime.fromisoformat(utc_str.replace(" ", "T")).replace(tzinfo=timezone.utc)
        return dt.astimezone(target_tz).strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return utc_str

def to_local_date(utc_str: Optional[str], tz_name: Optional[str] = None) -> Optional[str]:
    if not utc_str:
        return None
    try:
        target_tz = _resolve_tz(tz_name)
        dt = datetime.fromisoformat(utc_str.replace(" ", "T")).replace(tzinfo=timezone.utc)
        return dt.astimezone(target_tz).strftime("%Y-%m-%d")
    except Exception:
        return utc_str

def to_local_hour(utc_str: Optional[str], tz_name: Optional[str] = None) -> Optional[str]:
    if not utc_str:
        return None
    try:
        target_tz = _resolve_tz(tz_name)
        dt = datetime.fromisoformat(utc_str.replace(" ", "T")).replace(tzinfo=timezone.utc)
        return dt.astimezone(target_tz).strftime("%H")
    except Exception:
        return "00"

def to_local_minute(utc_str: Optional[str], tz_name: Optional[str] = None) -> Optional[str]:
    if not utc_str:
        return None
    try:
        target_tz = _resolve_tz(tz_name)
        dt = datetime.fromisoformat(utc_str.replace(" ", "T")).replace(tzinfo=timezone.utc)
        return dt.astimezone(target_tz).strftime("%Y-%m-%d %H:%M")
    except Exception:
        return utc_str

# Polish & English common stop-words for cleaner emote/word stats
STOP_WORDS = {
    'i', 'w', 'na', 'z', 'do', 'to', 'nie', 'ze', 'sie', 'się', 'co', 'jak', 'tak', 'ale', 'o', 'a',
    'po', 'za', 'jest', 'od', 'ja', 'ty', 'on', 'ona', 'my', 'wy', 'oni', 'one', 'go', 'jej', 'mu',
    'the', 'and', 'to', 'a', 'in', 'that', 'is', 'for', 'it', 'with', 'as', 'was', 'on', 'at', 'by',
    'this', 'tu', 'tam', 'juz', 'już', 'tylko', 'bo', 'czy', 'moze', 'może', 'mnie', 'cie', 'cię',
    'mi', 'ze', 'dla', 'sa', 'są', 'byl', 'był', 'była', 'będzie', 'bedzie', 'ma', 'mam', 'masz',
    'jaki', 'jaka', 'jakie', 'ten', 'ta', 'te', 'tych', 'jesteś', 'jestem', 'tam', 'tutaj'
}

@contextmanager
def get_db():
    current_db = resolve_db_file()
    if not os.path.exists(current_db):
        raise FileNotFoundError(f"Baza danych '{current_db}' nie istnieje.")
    conn = sqlite3.connect(current_db, timeout=20.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout=5000;")
    conn.create_function("to_local", -1, to_local_datetime)
    conn.create_function("local_date", -1, to_local_date)
    conn.create_function("local_hour", -1, to_local_hour)
    conn.create_function("local_minute", -1, to_local_minute)
    try:
        yield conn
    finally:
        conn.close()

def ensure_indexes():
    """Ensure database indexes exist for high-speed analytics queries."""
    if not os.path.exists(DB_FILE):
        return
    try:
        with get_db() as conn:
            conn.execute("CREATE INDEX IF NOT EXISTS idx_messages_username ON messages(username);")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_messages_stream_user ON messages(stream_id, username);")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_stream_stats_stream_time ON stream_stats(stream_id, timestamp);")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_streams_start ON streams(start_time);")
            conn.commit()
    except Exception as e:
        print(f"[DB] Indeksowanie pominięte lub błąd: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    ensure_indexes()
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE streams
                SET end_time = (
                    SELECT MAX(created_at)
                    FROM messages
                    WHERE messages.stream_id = streams.stream_id
                )
                WHERE (end_time = start_time OR end_time IS NULL)
                  AND EXISTS (
                      SELECT 1 FROM messages
                      WHERE messages.stream_id = streams.stream_id
                        AND messages.created_at > streams.start_time
                  )
            """)
            conn.commit()
    except Exception as e:
        print(f"[DB] Błąd auto-naprawy end_time: {e}")
    yield

app = FastAPI(title="TwitchMetrics API", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)

def verify_auth(
    x_panel_password: Optional[str] = Header(None, alias="X-Panel-Password"),
    password: Optional[str] = Query(None)
):
    """Verify password protection if PANEL_PASSWORD is set."""
    if not PANEL_PASSWORD:
        return True
    if x_panel_password == PANEL_PASSWORD or password == PANEL_PASSWORD:
        return True
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Wymagana autoryzacja lub nieprawidłowe hasło dostępu."
    )

def build_date_filter(
    start_date: Optional[str],
    end_date: Optional[str],
    column: str = "created_at",
    tz_name: Optional[str] = None
):
    """
    Constructs a SQL date filter. Converts client local dates to exact UTC bounds
    to maintain 100% index utilization on SQLite created_at column.
    """
    clause = "1=1"
    params = []
    tz = zoneinfo.ZoneInfo(tz_name or PANEL_TIMEZONE)
    if start_date:
        try:
            s_dt = datetime.strptime(start_date, "%Y-%m-%d").replace(tzinfo=tz)
            start_utc = s_dt.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
            clause += f" AND {column} >= ?"
            params.append(start_utc)
        except Exception:
            clause += f" AND {column} >= ?"
            params.append(f"{start_date} 00:00:00")
    if end_date:
        try:
            e_dt = datetime.strptime(end_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59, tzinfo=tz)
            end_utc = e_dt.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
            clause += f" AND {column} <= ?"
            params.append(end_utc)
        except Exception:
            clause += f" AND {column} <= ?"
            params.append(f"{end_date} 23:59:59")
    return clause, params

class AuthRequest(BaseModel):
    password: str

@app.post("/api/auth/verify")
def check_auth(req: AuthRequest):
    if not PANEL_PASSWORD:
        return {"success": True, "required": False}
    if req.password == PANEL_PASSWORD:
        return {"success": True, "required": True}
    raise HTTPException(status_code=401, detail="Nieprawidłowe hasło")

@app.get("/api/status")
def get_system_status(target_tz: str = Depends(get_target_timezone)):
    """Returns general service status, live stream state, and DB overview."""
    db_size = 0
    if os.path.exists(DB_FILE):
        db_size = round(os.path.getsize(DB_FILE) / (1024 * 1024), 2)

    total_msgs = 0
    total_streams = 0
    is_live = False
    current_stream = None
    latest_viewers = 0

    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM messages")
            total_msgs = cursor.fetchone()[0]

            cursor.execute("SELECT COUNT(*) FROM streams")
            total_streams = cursor.fetchone()[0]

            cursor.execute("SELECT stream_id, channel, start_time, end_time FROM streams WHERE end_time IS NULL ORDER BY stream_id DESC LIMIT 1")
            active_row = cursor.fetchone()
            if active_row:
                is_live = True
                cursor.execute("SELECT viewer_count FROM stream_stats WHERE stream_id = ? ORDER BY timestamp DESC LIMIT 1", (active_row["stream_id"],))
                v_row = cursor.fetchone()
                if v_row:
                    latest_viewers = v_row["viewer_count"]

                current_stream = {
                    "stream_id": active_row["stream_id"],
                    "start_time": to_local_datetime(active_row["start_time"], target_tz),
                    "viewer_count": latest_viewers
                }
    except Exception as e:
        pass

    return {
        "channel": CHANNEL,
        "auth_required": bool(PANEL_PASSWORD),
        "timezone": target_tz,
        "is_live": is_live,
        "current_stream": current_stream,
        "total_messages": total_msgs,
        "total_streams": total_streams,
        "db_size_mb": db_size
    }

@app.get("/api/stats/overall")
def get_overall_stats(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    hide_staff: bool = False,
    target_tz: str = Depends(get_target_timezone),
    _: bool = Depends(verify_auth)
):
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            date_clause, params = build_date_filter(start_date, end_date, "created_at", target_tz)
            
            staff_filter = ""
            if hide_staff:
                staff_filter = " AND (is_mod = 0 OR is_mod IS NULL) AND (is_vip = 0 OR is_vip IS NULL)"

            full_filter = f"{date_clause} {staff_filter}"

            # Total messages and unique users
            cursor.execute(f"SELECT COUNT(*) as total_msgs, COUNT(DISTINCT username) as unique_users FROM messages WHERE {full_filter}", params)
            overview = cursor.fetchone()

            # New chatters in this period
            new_date_clause, new_params = build_date_filter(start_date, end_date, 'first_seen', target_tz)
            cursor.execute(f"""
                SELECT COUNT(*) FROM (
                    SELECT username, MIN(created_at) as first_seen 
                    FROM messages 
                    GROUP BY username
                ) 
                WHERE {new_date_clause}
            """, new_params)
            new_chatters = cursor.fetchone()[0]

            # Stream viewer statistics for period
            date_clause_stats, params_stats = build_date_filter(start_date, end_date, "timestamp", target_tz)
            cursor.execute(f"""
                SELECT AVG(viewer_count) as avg_viewers, MAX(viewer_count) as peak_viewers 
                FROM stream_stats 
                WHERE {date_clause_stats}
            """, params_stats)
            v_stats = cursor.fetchone()
            avg_viewers = int(round(v_stats["avg_viewers"])) if v_stats and v_stats["avg_viewers"] is not None else 0
            peak_viewers = int(v_stats["peak_viewers"]) if v_stats and v_stats["peak_viewers"] is not None else 0

            # Timeline of daily message volume and unique chatters (using local_date)
            cursor.execute(f"""
                SELECT local_date(created_at, ?) as date, 
                       COUNT(*) as count,
                       COUNT(DISTINCT username) as unique_chatters
                FROM messages 
                WHERE {full_filter}
                GROUP BY date 
                ORDER BY date ASC
            """, [target_tz] + params)
            timeline = [dict(row) for row in cursor.fetchall()]

            # Hourly activity distribution (00 to 23 using local_hour)
            cursor.execute(f"""
                SELECT local_hour(created_at, ?) as hour, COUNT(*) as count 
                FROM messages 
                WHERE {full_filter}
                GROUP BY hour 
                ORDER BY hour ASC
            """, [target_tz] + params)
            hourly_map = {f"{h:02d}": 0 for h in range(24)}
            for r in cursor.fetchall():
                hourly_map[r["hour"]] = r["count"]
            hourly_distribution = [{"hour": k, "count": v} for k, v in sorted(hourly_map.items())]

            # Top chatters (using local_date for active_days)
            cursor.execute(f"""
                SELECT username, 
                       COUNT(*) as count, 
                       COUNT(DISTINCT local_date(created_at, ?)) as active_days,
                       MAX(is_mod) as is_mod,
                       MAX(is_vip) as is_vip,
                       MAX(is_sub) as is_sub
                FROM messages 
                WHERE {full_filter}
                GROUP BY username 
                ORDER BY count DESC 
                LIMIT 20
            """, [target_tz] + params)
            total_for_perc = overview["total_msgs"] or 1
            top_users = []
            for row in cursor.fetchall():
                d = dict(row)
                d["percentage"] = round((d["count"] / total_for_perc) * 100, 1)
                top_users.append(d)

            return {
                "total_msgs": overview["total_msgs"],
                "unique_users": overview["unique_users"],
                "new_chatters": new_chatters,
                "avg_viewers": avg_viewers,
                "peak_viewers": peak_viewers,
                "timeline": timeline,
                "hourly_distribution": hourly_distribution,
                "top_users": top_users
            }
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/users")
def get_users(q: Optional[str] = None, limit: int = 100, _: bool = Depends(verify_auth)):
    """Search/list chatters with message count and badges."""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            if q:
                pattern = f"%{q.strip().lower()}%"
                cursor.execute("""
                    SELECT username, COUNT(*) as total_msgs, 
                           MAX(is_mod) as is_mod, MAX(is_vip) as is_vip, MAX(is_sub) as is_sub
                    FROM messages 
                    WHERE username LIKE ?
                    GROUP BY username
                    ORDER BY total_msgs DESC
                    LIMIT ?
                """, (pattern, limit))
            else:
                cursor.execute("""
                    SELECT username, COUNT(*) as total_msgs,
                           MAX(is_mod) as is_mod, MAX(is_vip) as is_vip, MAX(is_sub) as is_sub
                    FROM messages 
                    GROUP BY username 
                    ORDER BY total_msgs DESC 
                    LIMIT ?
                """, (limit,))
            return [dict(r) for r in cursor.fetchall()]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/stats/user/{username}")
def get_user_stats(
    username: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    target_tz: str = Depends(get_target_timezone),
    _: bool = Depends(verify_auth)
):
    try:
        username = username.strip().lower()
        with get_db() as conn:
            cursor = conn.cursor()
            date_clause, params = build_date_filter(start_date, end_date, "created_at", target_tz)
            user_params = [username] + params

            # Total and active days within date range (local_date)
            cursor.execute(f"""
                SELECT COUNT(*) as total, 
                       COUNT(DISTINCT local_date(created_at, ?)) as active_days,
                       MAX(is_mod) as is_mod,
                       MAX(is_vip) as is_vip,
                       MAX(is_sub) as is_sub
                FROM messages 
                WHERE username = ? AND {date_clause}
            """, [target_tz] + user_params)
            stats = cursor.fetchone()

            # All-time messages & first seen / last seen
            cursor.execute("""
                SELECT COUNT(*) as all_time_total,
                       MIN(created_at) as first_seen,
                       MAX(created_at) as last_seen
                FROM messages
                WHERE username = ?
            """, (username,))
            all_time = cursor.fetchone()

            total_msgs = stats["total"] if stats else 0
            active_days = stats["active_days"] if stats else 0
            avg_msgs_per_day = round(total_msgs / active_days, 1) if active_days > 0 else 0

            first_seen_raw = all_time["first_seen"] if all_time else None
            last_seen_raw = all_time["last_seen"] if all_time else None

            # Loyalty Score: % of streams attended since first seen
            loyalty_score = 0
            streams_attended = 0
            total_streams = 0

            if first_seen_raw:
                cursor.execute("""
                    SELECT COUNT(DISTINCT stream_id) FROM streams 
                    WHERE end_time >= ? OR end_time IS NULL OR start_time >= ?
                """, (first_seen_raw, first_seen_raw))
                total_streams = cursor.fetchone()[0] or 0

                cursor.execute("SELECT COUNT(DISTINCT stream_id) FROM messages WHERE username = ? AND stream_id IS NOT NULL", (username,))
                streams_attended = cursor.fetchone()[0] or 0

                total_streams = max(total_streams, streams_attended)
                if total_streams > 0:
                    loyalty_score = min(100, round((streams_attended / total_streams) * 100))

            # Daily timeline for user using local_date
            cursor.execute(f"""
                SELECT local_date(created_at, ?) as date, COUNT(*) as count 
                FROM messages 
                WHERE username = ? AND {date_clause}
                GROUP BY date 
                ORDER BY date ASC
            """, [target_tz] + user_params)
            timeline = [dict(row) for row in cursor.fetchall()]

            # Recent 50 messages formatted with to_local
            cursor.execute(f"""
                SELECT to_local(created_at, ?) as created_at, content, stream_id FROM messages 
                WHERE username = ? AND {date_clause}
                ORDER BY messages.created_at DESC LIMIT 50
            """, [target_tz] + user_params)
            recent_msgs = [dict(row) for row in cursor.fetchall()]

            return {
                "username": username,
                "total_msgs": total_msgs,
                "all_time_msgs": all_time["all_time_total"] if all_time else 0,
                "active_days": active_days,
                "avg_msgs_per_day": avg_msgs_per_day,
                "first_seen": to_local_datetime(first_seen_raw, target_tz),
                "last_seen": to_local_datetime(last_seen_raw, target_tz),
                "badges": {
                    "is_mod": bool(stats["is_mod"]) if stats else False,
                    "is_vip": bool(stats["is_vip"]) if stats else False,
                    "is_sub": bool(stats["is_sub"]) if stats else False,
                },
                "loyalty_score": loyalty_score,
                "streams_attended": streams_attended,
                "total_streams_since_first": total_streams,
                "timeline": timeline,
                "recent_msgs": recent_msgs
            }
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/messages/user/{username}")
def get_user_messages(
    username: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    limit: int = 1000,
    offset: int = 0,
    target_tz: str = Depends(get_target_timezone),
    _: bool = Depends(verify_auth)
):
    try:
        username = username.strip().lower()
        with get_db() as conn:
            cursor = conn.cursor()
            date_clause, params = build_date_filter(start_date, end_date, "created_at", target_tz)
            user_params = [username] + params + [limit, offset]

            cursor.execute(f"""
                SELECT to_local(created_at, ?) as created_at, content, stream_id 
                FROM messages 
                WHERE username = ? AND {date_clause} 
                ORDER BY messages.created_at DESC
                LIMIT ? OFFSET ?
            """, [target_tz] + user_params)
            return [dict(row) for row in cursor.fetchall()]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/streams")
def get_streams_list(
    target_tz: str = Depends(get_target_timezone),
    _: bool = Depends(verify_auth)
):
    """List all recorded streams with summary statistics."""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT s.stream_id, s.channel, s.start_time, s.end_time,
                       COALESCE(MAX(st.viewer_count), 0) as peak_viewers,
                       COALESCE(ROUND(AVG(st.viewer_count)), 0) as avg_viewers,
                       (SELECT COUNT(*) FROM messages m WHERE m.stream_id = s.stream_id) as total_msgs,
                       (SELECT COUNT(DISTINCT m.username) FROM messages m WHERE m.stream_id = s.stream_id) as unique_chatters,
                       (SELECT MAX(created_at) FROM messages m WHERE m.stream_id = s.stream_id) as last_msg_time,
                       (SELECT MAX(timestamp) FROM stream_stats st2 WHERE st2.stream_id = s.stream_id) as last_stat_time
                FROM streams s
                LEFT JOIN stream_stats st ON s.stream_id = st.stream_id
                GROUP BY s.stream_id
                ORDER BY s.stream_id DESC
            """)
            streams = []
            for r in cursor.fetchall():
                row = dict(r)
                is_live = row["end_time"] is None
                
                # Determine effective end time
                effective_end_str = row["end_time"]
                if not is_live:
                    if not effective_end_str or effective_end_str == row["start_time"]:
                        effective_end_str = row.get("last_msg_time") or row.get("last_stat_time") or row["start_time"]
                    elif row.get("last_msg_time") and row["last_msg_time"] > effective_end_str:
                        effective_end_str = row["last_msg_time"]

                start_dt = datetime.fromisoformat(row["start_time"].replace(" ", "T")) if row["start_time"] else None
                end_dt = datetime.fromisoformat(effective_end_str.replace(" ", "T")) if (effective_end_str and not is_live) else (datetime.now(timezone.utc).replace(tzinfo=None) if is_live else None)

                duration_min = 0
                if start_dt and end_dt:
                    duration_min = max(1, int((end_dt - start_dt).total_seconds() / 60))

                row["start_time"] = to_local_datetime(row["start_time"], target_tz)
                row["end_time"] = to_local_datetime(effective_end_str, target_tz) if not is_live else None
                row["is_live"] = is_live
                row["duration_minutes"] = duration_min
                streams.append(row)
            return streams
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/streams/{stream_id}")
def get_stream_details(
    stream_id: int,
    target_tz: str = Depends(get_target_timezone),
    _: bool = Depends(verify_auth)
):
    """Detailed analytics for a specific stream."""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT stream_id, channel, start_time, end_time FROM streams WHERE stream_id = ?", (stream_id,))
            stream_info = cursor.fetchone()
            if not stream_info:
                raise HTTPException(status_code=404, detail="Nie znaleziono streama")

            is_live = stream_info["end_time"] is None

            # Stream stats summary
            cursor.execute("""
                SELECT MAX(viewer_count) as peak_viewers,
                       ROUND(AVG(viewer_count)) as avg_viewers
                FROM stream_stats 
                WHERE stream_id = ?
            """, (stream_id,))
            st_summary = cursor.fetchone()
            peak_viewers = int(st_summary["peak_viewers"]) if st_summary and st_summary["peak_viewers"] is not None else 0
            avg_viewers = int(st_summary["avg_viewers"]) if st_summary and st_summary["avg_viewers"] is not None else 0

            # Message count & unique chatters
            cursor.execute("""
                SELECT COUNT(*) as msgs, 
                       COUNT(DISTINCT username) as chatters,
                       MAX(created_at) as last_msg
                FROM messages WHERE stream_id = ?
            """, (stream_id,))
            msg_summary = cursor.fetchone()
            total_msgs = msg_summary["msgs"] if msg_summary else 0
            unique_chatters = msg_summary["chatters"] if msg_summary else 0
            last_msg_time = msg_summary["last_msg"] if msg_summary else None

            cursor.execute("SELECT MAX(timestamp) FROM stream_stats WHERE stream_id = ?", (stream_id,))
            last_stat_row = cursor.fetchone()
            last_stat_time = last_stat_row[0] if last_stat_row else None

            # Effective end time
            effective_end_str = stream_info["end_time"]
            if not is_live:
                if not effective_end_str or effective_end_str == stream_info["start_time"]:
                    effective_end_str = last_msg_time or last_stat_time or stream_info["start_time"]
                elif last_msg_time and last_msg_time > effective_end_str:
                    effective_end_str = last_msg_time

            est_lurkers = max(0, avg_viewers - unique_chatters)

            # Peak hype minute in local timezone
            cursor.execute("""
                SELECT local_minute(created_at, ?) as minute, COUNT(*) as count 
                FROM messages 
                WHERE stream_id = ? 
                GROUP BY minute 
                ORDER BY count DESC LIMIT 1
            """, (target_tz, stream_id))
            hype_row = cursor.fetchone()
            peak_hype = {"minute": hype_row["minute"], "count": hype_row["count"]} if hype_row else {"minute": "-", "count": 0}

            # Viewers timeline with to_local
            cursor.execute("""
                SELECT to_local(timestamp, ?) as timestamp, viewer_count, chat_connections 
                FROM stream_stats 
                WHERE stream_id = ? 
                ORDER BY timestamp ASC
            """, (target_tz, stream_id))
            viewers_timeline = [dict(r) for r in cursor.fetchall()]

            # Top words / emotes
            cursor.execute("SELECT content FROM messages WHERE stream_id = ?", (stream_id,))
            from collections import Counter
            word_counts = Counter()
            for (msg_text,) in cursor.fetchall():
                if not msg_text:
                    continue
                for token in msg_text.split():
                    clean = token.strip('.,!?:;\"\'()[]{}~')
                    if len(clean) >= 2 and clean.lower() not in STOP_WORDS:
                        word_counts[clean] += 1
            top_words = [{"word": w, "count": c} for w, c in word_counts.most_common(12)]

            # Top chatters for this stream
            cursor.execute("""
                SELECT username, COUNT(*) as count, MAX(is_mod) as is_mod, MAX(is_vip) as is_vip, MAX(is_sub) as is_sub
                FROM messages
                WHERE stream_id = ?
                GROUP BY username
                ORDER BY count DESC
                LIMIT 10
            """, (stream_id,))
            top_chatters = [dict(r) for r in cursor.fetchall()]

            # Duration formatting
            start_dt = datetime.fromisoformat(stream_info["start_time"].replace(" ", "T")) if stream_info["start_time"] else None
            end_dt = datetime.fromisoformat(effective_end_str.replace(" ", "T")) if (effective_end_str and not is_live) else (datetime.now(timezone.utc).replace(tzinfo=None) if is_live else None)
            duration_str = "-"
            if start_dt and end_dt:
                diff = end_dt - start_dt
                total_secs = max(0, int(diff.total_seconds()))
                hours, remainder = divmod(total_secs, 3600)
                minutes, _ = divmod(remainder, 60)
                if hours == 0 and minutes == 0:
                    duration_str = "< 1m"
                else:
                    duration_str = f"{hours}h {minutes}m"

            return {
                "stream_id": stream_id,
                "start_time": to_local_datetime(stream_info["start_time"], target_tz),
                "end_time": to_local_datetime(effective_end_str, target_tz) if not is_live else None,
                "is_live": is_live,
                "duration_formatted": duration_str,
                "peak_viewers": peak_viewers,
                "avg_viewers": avg_viewers,
                "total_msgs": total_msgs,
                "unique_chatters": unique_chatters,
                "est_lurkers": est_lurkers,
                "peak_hype": peak_hype,
                "viewers_timeline": viewers_timeline,
                "top_words": top_words,
                "top_chatters": top_chatters
            }
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/export/top_users")
def export_top_users_csv(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    hide_staff: bool = False,
    target_tz: str = Depends(get_target_timezone),
    _: bool = Depends(verify_auth)
):
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            date_clause, params = build_date_filter(start_date, end_date, "created_at", target_tz)
            staff_filter = " AND (is_mod = 0 OR is_mod IS NULL) AND (is_vip = 0 OR is_vip IS NULL)" if hide_staff else ""

            cursor.execute(f"""
                SELECT username, COUNT(*) as message_count, 
                       COUNT(DISTINCT local_date(created_at, ?)) as active_days,
                       MAX(is_mod) as is_mod, MAX(is_vip) as is_vip, MAX(is_sub) as is_sub
                FROM messages 
                WHERE {date_clause} {staff_filter}
                GROUP BY username 
                ORDER BY message_count DESC
            """, [target_tz] + params)

            output = io.StringIO()
            output.write('\ufeff')  # UTF-8 BOM for Excel compatibility
            writer = csv.writer(output)
            writer.writerow(["username", "message_count", "active_days", "is_mod", "is_vip", "is_sub"])
            for r in cursor.fetchall():
                writer.writerow([r["username"], r["message_count"], r["active_days"], r["is_mod"], r["is_vip"], r["is_sub"]])

            output.seek(0)
            return Response(
                content=output.getvalue(),
                media_type="text/csv; charset=utf-8",
                headers={
                    "Content-Disposition": f"attachment; filename=top_chatters_{start_date or 'all'}_{end_date or 'all'}.csv",
                    "Access-Control-Expose-Headers": "Content-Disposition"
                }
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/export/user_messages/{username}")
def export_user_messages_csv(
    username: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    target_tz: str = Depends(get_target_timezone),
    _: bool = Depends(verify_auth)
):
    try:
        username = username.strip().lower()
        with get_db() as conn:
            cursor = conn.cursor()
            date_clause, params = build_date_filter(start_date, end_date, "created_at", target_tz)
            user_params = [target_tz, username] + params

            cursor.execute(f"""
                SELECT to_local(created_at, ?) as created_at, stream_id, content 
                FROM messages 
                WHERE username = ? AND {date_clause}
                ORDER BY messages.created_at ASC
            """, user_params)

            output = io.StringIO()
            output.write('\ufeff')  # UTF-8 BOM for Excel compatibility
            writer = csv.writer(output)
            writer.writerow(["created_at", "stream_id", "content"])
            for r in cursor.fetchall():
                writer.writerow([r["created_at"], r["stream_id"], r["content"]])

            output.seek(0)
            return Response(
                content=output.getvalue(),
                media_type="text/csv; charset=utf-8",
                headers={
                    "Content-Disposition": f"attachment; filename=messages_{username}.csv",
                    "Access-Control-Expose-Headers": "Content-Disposition"
                }
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Synchronized state for games (Host Dashboard <-> OBS Studio Overlay):
GAME_STATE: Dict[str, Any] = {
    "active_game": "quiz",
    "version": 1,
    "quiz": {
        "question": "",
        "category": "Ogólne",
        "type": "choice",
        "options": [
            {"key": "A", "text": ""},
            {"key": "B", "text": ""},
            {"key": "C", "text": ""},
            {"key": "D", "text": ""}
        ],
        "correct_answer": "A",
        "state": "idle",
        "start_time": None,
        "duration_seconds": 30,
        "answers_count": 0,
        "distribution": {"A": 0, "B": 0, "C": 0, "D": 0},
        "recent_answers": [],
        "podium": [],
        "revealed": False
    },
    "hangman": {
        "word": "WIEDŹMIN DZIKI GON",
        "category": "Gry Komputerowe",
        "hint": "Kultowy RPG od CD Projekt Red",
        "revealed_letters": [" "],
        "wrong_letters": [],
        "max_lives": 6,
        "lives_left": 6,
        "state": "playing",
        "active_chatter": None,
        "turn_mode": "all",
        "turn_start_time": None,
        "turn_timeout_seconds": 45,
        "letter_history": []
    },
    "giveaway": {
        "keyword": "!losowanie",
        "prize": "",
        "state": "idle",
        "participants": [],
        "winner": None,
        "history": []
    },
    "leaderboard": {}
}

def init_game_state_store():
    try:
        db_path = resolve_db_file()
        with sqlite3.connect(db_path, timeout=10.0) as conn:
            conn.execute("PRAGMA journal_mode=WAL;")
            conn.execute("""
                CREATE TABLE IF NOT EXISTS game_state_store (
                    id INTEGER PRIMARY KEY,
                    version INTEGER,
                    state_json TEXT,
                    updated_at REAL
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS hangman_words (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    word TEXT NOT NULL UNIQUE,
                    category TEXT NOT NULL,
                    hint TEXT DEFAULT '',
                    created_at REAL
                )
            """)
            count_row = conn.execute("SELECT COUNT(*) FROM hangman_words").fetchone()
            if count_row and count_row[0] == 0:
                default_words = [
                    ("WIEDŹMIN DZIKI GON", "Gry Komputerowe", "Kultowy RPG od polskiego studia CD Projekt Red", time.time()),
                    ("CYBERPUNK", "Gry Komputerowe", "Futurystyczne Night City i Johnny Silverhand", time.time()),
                    ("MINECRAFT", "Gry Komputerowe", "Klockowy świat, creepery i crafting", time.time()),
                    ("GOTHIC", "Gry Komputerowe", "Kolonia karna, magiczna bariera i Bezimienny", time.time()),
                    ("LEAGUE OF LEGENDS", "Gry Komputerowe", "Summoner's Rift i zniszczenie nexusa", time.time()),
                    ("SHREK", "Filmy i Animacje", "Zielony ogr, gadający osioł i bagno", time.time()),
                    ("STAR WARS", "Filmy i Seriale", "Rycerze Jedi, miecze świetlne i ciemna strona mocy", time.time()),
                    ("PIEROGI RUSKIE", "Jedzenie", "Tradycyjne polskie danie z twarogiem i ziemniakami", time.time())
                ]
                conn.executemany("INSERT OR IGNORE INTO hangman_words (word, category, hint, created_at) VALUES (?, ?, ?, ?)", default_words)
            conn.commit()
    except Exception as e:
        print(f"[init_game_state_store] Error: {e}")

init_game_state_store()

def load_persisted_game_state() -> Dict[str, Any]:
    global GAME_STATE
    db_path = resolve_db_file()
    try:
        with sqlite3.connect(db_path, timeout=5.0) as conn:
            conn.execute("PRAGMA journal_mode=WAL;")
            row = conn.execute("SELECT version, state_json FROM game_state_store WHERE id = 1").fetchone()
            if row and row[1]:
                state = json.loads(row[1])
                state["version"] = row[0]
                GAME_STATE = state
                return state
    except Exception:
        pass
    return GAME_STATE

def save_persisted_game_state(state: Dict[str, Any]) -> int:
    global GAME_STATE
    GAME_STATE = state
    db_path = resolve_db_file()
    try:
        with sqlite3.connect(db_path, timeout=5.0) as conn:
            conn.execute("PRAGMA journal_mode=WAL;")
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO game_state_store (id, version, state_json, updated_at)
                VALUES (1, 1, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    version = game_state_store.version + 1,
                    state_json = excluded.state_json,
                    updated_at = excluded.updated_at
                RETURNING version
            """, (json.dumps(state, ensure_ascii=False), time.time()))
            row = cur.fetchone()
            conn.commit()
            if row:
                state["version"] = row[0]
                return row[0]
    except Exception as e:
        print(f"[save_persisted_game_state] Error: {e}")
    state["version"] = state.get("version", 0) + 1
    return state["version"]

@app.get("/api/games/state")
def get_game_state():
    """Retrieve current synchronized game state for Host and OBS Overlay."""
    return load_persisted_game_state()

@app.post("/api/games/state")
def update_game_state(new_state: Dict[str, Any]):
    """Merge partial game state updates and increment version."""
    state = load_persisted_game_state()

    # Protection: Do NOT overwrite an active question with an empty string unless force_empty is True
    if "quiz" in new_state and isinstance(new_state["quiz"], dict):
        incoming_q = new_state["quiz"].get("question", "")
        current_q = state.get("quiz", {}).get("question", "")
        if not incoming_q and current_q and not new_state.get("force_empty", False):
            new_state["quiz"]["question"] = current_q
            if "options" in new_state["quiz"] and not new_state["quiz"]["options"]:
                new_state["quiz"]["options"] = state["quiz"].get("options", [])
            if "correct_answer" in new_state["quiz"] and not new_state["quiz"]["correct_answer"]:
                new_state["quiz"]["correct_answer"] = state["quiz"].get("correct_answer", "A")

    for k, v in new_state.items():
        if isinstance(v, dict) and k in state and isinstance(state[k], dict):
            state[k].update(v)
        else:
            state[k] = v

    new_ver = save_persisted_game_state(state)
    return {"status": "ok", "version": new_ver, "state": state}

@app.post("/api/games/reset")
def reset_game_state(mode: Optional[str] = Query(None)):
    """Reset a specific game mode or global leaderboard."""
    state = load_persisted_game_state()
    if mode == "quiz":
        state["quiz"]["state"] = "idle"
        state["quiz"]["answers_count"] = 0
        state["quiz"]["distribution"] = {"A": 0, "B": 0, "C": 0, "D": 0}
        state["quiz"]["recent_answers"] = []
        state["quiz"]["podium"] = []
        state["quiz"]["revealed"] = False
    elif mode == "hangman":
        state["hangman"]["state"] = "idle"
        state["hangman"]["revealed_letters"] = []
        state["hangman"]["wrong_letters"] = []
        state["hangman"]["lives_left"] = state["hangman"].get("max_lives", 6)
        state["hangman"]["active_chatter"] = None
        state["hangman"]["letter_history"] = []
    elif mode == "giveaway":
        state["giveaway"]["state"] = "idle"
        state["giveaway"]["participants"] = []
        state["giveaway"]["winner"] = None
    elif mode == "leaderboard":
        state["leaderboard"] = {}
    else:
        state["active_game"] = "quiz"
    new_ver = save_persisted_game_state(state)
    return {"status": "ok", "version": new_ver}

@app.get("/api/games/hangman/words")
def get_hangman_words():
    """Retrieve saved custom words for Hangman from SQLite database."""
    db_path = resolve_db_file()
    try:
        with sqlite3.connect(db_path, timeout=5.0) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute("SELECT id, word, category, hint, created_at FROM hangman_words ORDER BY id DESC").fetchall()
            return [dict(r) for r in rows]
    except Exception as e:
        return []

@app.post("/api/games/hangman/words")
def save_hangman_word(payload: Dict[str, Any] = Body(...)):
    """Save or update a Hangman word in SQLite database."""
    word = payload.get("word", "").strip().upper()
    category = payload.get("category", "Gry Komputerowe").strip() or "Gry Komputerowe"
    hint = payload.get("hint", "").strip()
    if not word or len(word) < 2:
        raise HTTPException(status_code=400, detail="Hasło musi mieć przynajmniej 2 znaki.")
    db_path = resolve_db_file()
    try:
        with sqlite3.connect(db_path, timeout=5.0) as conn:
            conn.execute("""
                INSERT INTO hangman_words (word, category, hint, created_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(word) DO UPDATE SET
                    category = excluded.category,
                    hint = excluded.hint,
                    created_at = excluded.created_at
            """, (word, category, hint, time.time()))
            conn.commit()
            conn.row_factory = sqlite3.Row
            rows = conn.execute("SELECT id, word, category, hint, created_at FROM hangman_words ORDER BY id DESC").fetchall()
            return {"status": "ok", "words": [dict(r) for r in rows]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/games/hangman/words/{word_id}")
def delete_hangman_word(word_id: int):
    """Delete a Hangman word by ID from SQLite database."""
    db_path = resolve_db_file()
    try:
        with sqlite3.connect(db_path, timeout=5.0) as conn:
            conn.execute("DELETE FROM hangman_words WHERE id = ?", (word_id,))
            conn.commit()
            conn.row_factory = sqlite3.Row
            rows = conn.execute("SELECT id, word, category, hint, created_at FROM hangman_words ORDER BY id DESC").fetchall()
            return {"status": "ok", "words": [dict(r) for r in rows]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/games/hangman/words")
def clear_all_hangman_words():
    """Clear all Hangman words from SQLite database."""
    db_path = resolve_db_file()
    try:
        with sqlite3.connect(db_path, timeout=5.0) as conn:
            conn.execute("DELETE FROM hangman_words")
            conn.commit()
            return {"status": "ok", "words": []}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/games/active-chatters")
def get_active_chatters(minutes: int = Query(2, ge=1, le=60)):
    """
    Get chatters who sent messages in the last N minutes.
    Used for 'Chatter' mechanic in Hangman.
    Falls back to recent stream chatters if stream/chat has been quiet.
    """
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            # 1. First attempt: true recent messages in the last N minutes
            cursor.execute(f"""
                SELECT username, MAX(created_at) as last_seen, COUNT(*) as msg_count
                FROM messages
                WHERE created_at >= datetime('now', '-{minutes} minutes')
                GROUP BY username
                ORDER BY last_seen DESC
                LIMIT 50
            """)
            rows = [dict(r) for r in cursor.fetchall()]

            # 2. Fallback to latest chatters in DB if fewer than 2 found (e.g. offline testing)
            is_fallback = False
            if len(rows) < 2:
                cursor.execute(f"""
                    SELECT username, MAX(created_at) as last_seen, COUNT(*) as msg_count
                    FROM messages
                    WHERE created_at >= (SELECT datetime(MAX(created_at), '-{minutes} minutes') FROM messages)
                    GROUP BY username
                    ORDER BY last_seen DESC
                    LIMIT 50
                """)
                fallback_rows = [dict(r) for r in cursor.fetchall()]
                if fallback_rows:
                    rows = fallback_rows
                    is_fallback = True

            random_pick = random.choice(rows)["username"] if rows else None

            return {
                "active_chatters": rows,
                "count": len(rows),
                "random_pick": random_pick,
                "is_fallback": is_fallback,
                "window_minutes": minutes
            }
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/games/recent-messages")
def get_game_recent_messages(since_id: int = Query(0), limit: int = Query(100, ge=1, le=500)):
    """Fetch chat messages newer than since_id for real-time game polling."""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT id, username, content, created_at, is_mod, is_vip, is_sub
                FROM messages
                WHERE id > ?
                ORDER BY id ASC
                LIMIT ?
            """, (since_id, limit))
            msgs = [dict(r) for r in cursor.fetchall()]
            max_id = msgs[-1]["id"] if msgs else since_id
            return {"messages": msgs, "max_id": max_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/games/latest-id")
def get_latest_message_id():
    """Get latest message ID so the game starts listening only from now."""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT COALESCE(MAX(id), 0) FROM messages")
            row = cursor.fetchone()
            return {"latest_id": row[0] if row else 0}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class SimulateMessagePayload(BaseModel):
    username: str
    content: str

@app.post("/api/games/simulate-message")
def simulate_chat_message(payload: SimulateMessagePayload):
    """Inject a test message into the database to test game mechanics locally."""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO messages (stream_id, username, content, is_mod, is_vip, is_sub)
                VALUES (1, ?, ?, 0, 0, 0)
            """, (payload.username.lower().strip(), payload.content.strip()))
            conn.commit()
            return {"status": "ok", "message_id": cursor.lastrowid}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/games/quiz/export")
def export_quiz_results(data: Dict[str, Any]):
    """Export current quiz session scores to CSV with Excel compatibility."""
    try:
        leaderboard = data.get("leaderboard", [])
        output = io.StringIO()
        output.write('\ufeff')  # UTF-8 BOM
        writer = csv.writer(output, delimiter=';')
        writer.writerow(["Pozycja", "Widz (Nick)", "Punkty", "Poprawne Odpowiedzi", "Skuteczność (%)"])
        for idx, entry in enumerate(leaderboard, 1):
            writer.writerow([
                idx,
                entry.get("username", ""),
                entry.get("score", 0),
                entry.get("correct_answers", 0),
                f"{entry.get('accuracy', 0):.1f}%"
            ])
        output.seek(0)
        return Response(
            content=output.getvalue(),
            media_type="text/csv; charset=utf-8",
            headers={
                "Content-Disposition": f"attachment; filename=quiz_wyniki_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv",
                "Access-Control-Expose-Headers": "Content-Disposition"
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Mount static files and webpanel
FRONTEND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "frontend")
if not os.path.isdir(FRONTEND_DIR) or not os.path.exists(os.path.join(FRONTEND_DIR, "index.html")):
    FRONTEND_DIR = os.path.dirname(os.path.abspath(__file__))

if os.path.isdir(FRONTEND_DIR):
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

@app.get("/")
def read_root():
    index_path = os.path.join(FRONTEND_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path, media_type="text/html; charset=utf-8")
    return {"status": "ok", "message": "TwitchMetrics API is running"}

@app.get("/games")
@app.get("/games/")
@app.get("/games.html")
def read_games():
    games_path = os.path.join(FRONTEND_DIR, "games.html")
    if os.path.exists(games_path):
        return FileResponse(games_path, media_type="text/html; charset=utf-8")
    index_path = os.path.join(FRONTEND_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path, media_type="text/html; charset=utf-8")
    return {"status": "ok", "message": "Games page not found"}

if os.path.isdir(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    host = os.getenv("HOST", "127.0.0.1")
    reload_env = os.getenv("RELOAD", "false").lower() in ("true", "1", "yes")
    print(f"TwitchMetrics server starting on http://{host}:{port} (reload={reload_env})")
    if reload_env:
        uvicorn.run("api:app", host=host, port=port, reload=True, reload_excludes=["*.db*", "*.sqlite*", "*.log"])
    else:
        uvicorn.run(app, host=host, port=port, reload=False)
