import os
import io
import csv
import sqlite3
import traceback
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from contextlib import contextmanager

from fastapi import FastAPI, HTTPException, Query, Header, Depends, status, Response
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

app = FastAPI(title="TwitchMetrics API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
CHANNEL = os.getenv("CHANNEL", "Streamer").strip().lstrip('#')
PANEL_PASSWORD = os.getenv("PANEL_PASSWORD", "").strip()

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

@app.on_event("startup")
def on_startup():
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

def build_date_filter(start_date: Optional[str], end_date: Optional[str], column: str = "created_at"):
    clause = "1=1"
    params = []
    if start_date:
        clause += f" AND {column} >= ?"
        params.append(f"{start_date} 00:00:00")
    if end_date:
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
def get_system_status():
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
                    "start_time": active_row["start_time"],
                    "viewer_count": latest_viewers
                }
    except Exception as e:
        pass

    return {
        "channel": CHANNEL,
        "auth_required": bool(PANEL_PASSWORD),
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
    _: bool = Depends(verify_auth)
):
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            date_clause, params = build_date_filter(start_date, end_date, "created_at")
            
            staff_filter = ""
            if hide_staff:
                staff_filter = " AND (is_mod = 0 OR is_mod IS NULL) AND (is_vip = 0 OR is_vip IS NULL)"

            full_filter = f"{date_clause} {staff_filter}"

            # Total messages and unique users
            cursor.execute(f"SELECT COUNT(*) as total_msgs, COUNT(DISTINCT username) as unique_users FROM messages WHERE {full_filter}", params)
            overview = cursor.fetchone()

            # New chatters in this period
            cursor.execute(f"""
                SELECT COUNT(*) FROM (
                    SELECT username, MIN(created_at) as first_seen 
                    FROM messages 
                    GROUP BY username
                ) 
                WHERE {build_date_filter(start_date, end_date, 'first_seen')[0]}
            """, build_date_filter(start_date, end_date, 'first_seen')[1])
            new_chatters = cursor.fetchone()[0]

            # Stream viewer statistics for period
            date_clause_stats, params_stats = build_date_filter(start_date, end_date, "timestamp")
            cursor.execute(f"""
                SELECT AVG(viewer_count) as avg_viewers, MAX(viewer_count) as peak_viewers 
                FROM stream_stats 
                WHERE {date_clause_stats}
            """, params_stats)
            v_stats = cursor.fetchone()
            avg_viewers = int(round(v_stats["avg_viewers"])) if v_stats and v_stats["avg_viewers"] is not None else 0
            peak_viewers = int(v_stats["peak_viewers"]) if v_stats and v_stats["peak_viewers"] is not None else 0

            # Timeline of daily message volume and unique chatters
            cursor.execute(f"""
                SELECT strftime('%Y-%m-%d', created_at) as date, 
                       COUNT(*) as count,
                       COUNT(DISTINCT username) as unique_chatters
                FROM messages 
                WHERE {full_filter}
                GROUP BY date 
                ORDER BY date ASC
            """, params)
            timeline = [dict(row) for row in cursor.fetchall()]

            # Hourly activity distribution (00 to 23)
            cursor.execute(f"""
                SELECT strftime('%H', created_at) as hour, COUNT(*) as count 
                FROM messages 
                WHERE {full_filter}
                GROUP BY hour 
                ORDER BY hour ASC
            """, params)
            hourly_map = {f"{h:02d}": 0 for h in range(24)}
            for r in cursor.fetchall():
                hourly_map[r["hour"]] = r["count"]
            hourly_distribution = [{"hour": k, "count": v} for k, v in sorted(hourly_map.items())]

            # Top chatters
            cursor.execute(f"""
                SELECT username, 
                       COUNT(*) as count, 
                       COUNT(DISTINCT strftime('%Y-%m-%d', created_at)) as active_days,
                       MAX(is_mod) as is_mod,
                       MAX(is_vip) as is_vip,
                       MAX(is_sub) as is_sub
                FROM messages 
                WHERE {full_filter}
                GROUP BY username 
                ORDER BY count DESC 
                LIMIT 20
            """, params)
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
    _: bool = Depends(verify_auth)
):
    try:
        username = username.strip().lower()
        with get_db() as conn:
            cursor = conn.cursor()
            date_clause, params = build_date_filter(start_date, end_date)
            user_params = [username] + params

            # Total and active days within date range
            cursor.execute(f"""
                SELECT COUNT(*) as total, 
                       COUNT(DISTINCT strftime('%Y-%m-%d', created_at)) as active_days,
                       MAX(is_mod) as is_mod,
                       MAX(is_vip) as is_vip,
                       MAX(is_sub) as is_sub
                FROM messages 
                WHERE username = ? AND {date_clause}
            """, user_params)
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

            # Loyalty Score: % of streams attended since first seen
            loyalty_score = 0
            streams_attended = 0
            total_streams = 0
            first_seen = all_time["first_seen"] if all_time else None
            last_seen = all_time["last_seen"] if all_time else None

            if first_seen:
                cursor.execute("""
                    SELECT COUNT(DISTINCT stream_id) FROM streams 
                    WHERE end_time >= ? OR end_time IS NULL OR start_time >= ?
                """, (first_seen, first_seen))
                total_streams = cursor.fetchone()[0] or 0

                cursor.execute("SELECT COUNT(DISTINCT stream_id) FROM messages WHERE username = ? AND stream_id IS NOT NULL", (username,))
                streams_attended = cursor.fetchone()[0] or 0

                total_streams = max(total_streams, streams_attended)
                if total_streams > 0:
                    loyalty_score = min(100, round((streams_attended / total_streams) * 100))

            # Daily timeline for user
            cursor.execute(f"""
                SELECT strftime('%Y-%m-%d', created_at) as date, COUNT(*) as count 
                FROM messages 
                WHERE username = ? AND {date_clause}
                GROUP BY date 
                ORDER BY date ASC
            """, user_params)
            timeline = [dict(row) for row in cursor.fetchall()]

            # Recent 50 messages
            cursor.execute(f"""
                SELECT created_at, content, stream_id FROM messages 
                WHERE username = ? AND {date_clause}
                ORDER BY created_at DESC LIMIT 50
            """, user_params)
            recent_msgs = [dict(row) for row in cursor.fetchall()]

            return {
                "username": username,
                "total_msgs": total_msgs,
                "all_time_msgs": all_time["all_time_total"] if all_time else 0,
                "active_days": active_days,
                "avg_msgs_per_day": avg_msgs_per_day,
                "first_seen": first_seen,
                "last_seen": last_seen,
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
    _: bool = Depends(verify_auth)
):
    try:
        username = username.strip().lower()
        with get_db() as conn:
            cursor = conn.cursor()
            date_clause, params = build_date_filter(start_date, end_date)
            user_params = [username] + params + [limit, offset]

            cursor.execute(f"""
                SELECT created_at, content, stream_id 
                FROM messages 
                WHERE username = ? AND {date_clause} 
                ORDER BY created_at DESC
                LIMIT ? OFFSET ?
            """, user_params)
            return [dict(row) for row in cursor.fetchall()]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/streams")
def get_streams_list(_: bool = Depends(verify_auth)):
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
                end_dt = datetime.fromisoformat(effective_end_str.replace(" ", "T")) if (effective_end_str and not is_live) else (datetime.utcnow() if is_live else None)

                duration_min = 0
                if start_dt and end_dt:
                    duration_min = max(1, int((end_dt - start_dt).total_seconds() / 60))

                row["end_time"] = effective_end_str if not is_live else None
                row["is_live"] = is_live
                row["duration_minutes"] = duration_min
                streams.append(row)
            return streams
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/streams/{stream_id}")
def get_stream_details(stream_id: int, _: bool = Depends(verify_auth)):
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

            # Peak hype minute
            cursor.execute("""
                SELECT strftime('%Y-%m-%d %H:%M', created_at) as minute, COUNT(*) as count 
                FROM messages 
                WHERE stream_id = ? 
                GROUP BY minute 
                ORDER BY count DESC LIMIT 1
            """, (stream_id,))
            hype_row = cursor.fetchone()
            peak_hype = {"minute": hype_row["minute"], "count": hype_row["count"]} if hype_row else {"minute": "-", "count": 0}

            # Viewers timeline
            cursor.execute("""
                SELECT timestamp, viewer_count, chat_connections 
                FROM stream_stats 
                WHERE stream_id = ? 
                ORDER BY timestamp ASC
            """, (stream_id,))
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
            end_dt = datetime.fromisoformat(effective_end_str.replace(" ", "T")) if (effective_end_str and not is_live) else (datetime.utcnow() if is_live else None)
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
                "start_time": stream_info["start_time"],
                "end_time": effective_end_str if not is_live else None,
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
    _: bool = Depends(verify_auth)
):
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            date_clause, params = build_date_filter(start_date, end_date)
            staff_filter = " AND (is_mod = 0 OR is_mod IS NULL) AND (is_vip = 0 OR is_vip IS NULL)" if hide_staff else ""

            cursor.execute(f"""
                SELECT username, COUNT(*) as message_count, 
                       COUNT(DISTINCT strftime('%Y-%m-%d', created_at)) as active_days,
                       MAX(is_mod) as is_mod, MAX(is_vip) as is_vip, MAX(is_sub) as is_sub
                FROM messages 
                WHERE {date_clause} {staff_filter}
                GROUP BY username 
                ORDER BY message_count DESC
            """, params)

            output = io.StringIO()
            output.write('\ufeff')  # UTF-8 BOM for Excel compatibility
            writer = csv.writer(output)
            writer.writerow(["username", "message_count", "active_days", "is_mod", "is_vip", "is_sub"])
            for r in cursor.fetchall():
                writer.writerow([r["username"], r["message_count"], r["active_days"], r["is_mod"], r["is_vip"], r["is_sub"]])

            output.seek(0)
            return StreamingResponse(
                iter([output.getvalue()]),
                media_type="text/csv; charset=utf-8",
                headers={"Content-Disposition": f"attachment; filename=top_chatters_{start_date or 'all'}_{end_date or 'all'}.csv"}
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/export/user_messages/{username}")
def export_user_messages_csv(
    username: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    _: bool = Depends(verify_auth)
):
    try:
        username = username.strip().lower()
        with get_db() as conn:
            cursor = conn.cursor()
            date_clause, params = build_date_filter(start_date, end_date)
            user_params = [username] + params

            cursor.execute(f"""
                SELECT created_at, stream_id, content 
                FROM messages 
                WHERE username = ? AND {date_clause}
                ORDER BY created_at ASC
            """, user_params)

            output = io.StringIO()
            output.write('\ufeff')  # UTF-8 BOM for Excel compatibility
            writer = csv.writer(output)
            writer.writerow(["created_at", "stream_id", "content"])
            for r in cursor.fetchall():
                writer.writerow([r["created_at"], r["stream_id"], r["content"]])

            output.seek(0)
            return StreamingResponse(
                iter([output.getvalue()]),
                media_type="text/csv; charset=utf-8",
                headers={"Content-Disposition": f"attachment; filename=messages_{username}.csv"}
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Mount static files and webpanel
FRONTEND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "frontend")
if os.path.isdir(FRONTEND_DIR):
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

@app.get("/")
def read_root():
    index_path = os.path.join(FRONTEND_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"status": "ok", "message": "TwitchMetrics API is running"}

if os.path.isdir(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
