import sqlite3
import pandas as pd
import streamlit as st
import plotly.express as px
from streamlit_calendar import calendar
from datetime import datetime, timedelta
import os

DB_FILE = os.getenv("DB_FILE", "messages.db")
st.set_page_config(page_title="Twitch Activity Tracker", layout="wide")

@st.cache_resource
def get_db_connection():
    return sqlite3.connect(DB_FILE, check_same_thread=False)

conn = get_db_connection()

@st.cache_data(ttl=60)
def get_user_list():
    query = "SELECT DISTINCT username FROM messages ORDER BY username"
    df = pd.read_sql_query(query, conn)
    return df['username'].tolist()

user_list = get_user_list()

TEXT = {
    "PL": {
        "mode_overall": "Ogólne Statystyki", "mode_users": "Śledzenie Użytkownika", "mode_streams": "Statystyki Streamów",
        "time_period": "Zakres Czasu", "select_dates": "Wybierz okres aktywności:",
        "select_user": "Wybierz użytkownika do analizy:", "user_placeholder": "Wpisz lub wybierz nick...",
        "overall_activity": "Ogólna Aktywność Kanału", "user_activity": "Profil Aktywności: {}",
        "total_msgs": "Suma Wiadomości", "active_days": "Aktywne Dni", "avg_msgs": "Śr. Wiad. / Dzień",
        "unique_users": "Unikalni Użytkownicy", "new_chatters": "Nowi Użytkownicy",
        "avg_viewers": "Śr. Widzów Wideo", "peak_viewers_period": "Max Widzów (Okres)", "est_lurkers": "Szacowani Lurkerzy",
        "vol_over_time": "Aktywność w Czasie ({})", "top_chatters": "Najaktywniejsi Użytkownicy",
        "recent_msgs": "Ostatnie Wiadomości: {}", "stream_calendar": "Historia Streamów",
        "stream_details": "Podsumowanie Streama #{}", "duration": "Czas Trwania", "peak_viewers": "Max Widzów",
        "lurker_ratio": "Lurkerzy vs Aktywni", "timeline_graph": "Oglądalność w Czasie",
        "chatters": "Aktywni", "lurkers": "Lurkerzy", "no_activity": "Brak aktywności.",
        "no_streams": "Brak streamów.", "no_stream_data": "Brak danych dla tego streama.",
        "chatter": "Użytkownik", "messages": "Wiadomości", "date_time": "Data i Czas", "message": "Wiadomość",
        "day": "Dzień", "hour": "Godzina", "cal_prompt": "Kliknij stream w kalendarzu, aby zobaczyć szczegóły.",
        "hide_staff": "Ukryj Modów i VIP-ów", "hide_staff_help": "Wyklucza moderatorów, streamera i VIP-ów.",
        "download_csv": "Pobierz dane (CSV)", "loyalty_score": "Wskaźnik Lojalności", 
        "loyalty_help": "Procent streamów, w których użytkownik uczestniczył od pierwszego pojawienia się.",
        "attended": "Obecność na {}/{} streamach", "peak_hype": "Szczyt Hype'u",
        "peak_help": "Minuta z największą liczbą wiadomości na czacie.",
        "top_words": "Najpopularniejsze Słowa (Top 10)", "msgs_min": "wiad/min",
        "live": "NA ŻYWO", "waiting_stats": "Oczekiwanie na dane API..."
    },
    "EN": {
        "mode_overall": "Overall Stats", "mode_users": "User Tracking", "mode_streams": "Stream Stats",
        "time_period": "Time Period", "select_dates": "Select activity period:",
        "select_user": "Select a user to analyze:", "user_placeholder": "Type or select a username...",
        "overall_activity": "Overall Channel Activity", "user_activity": "Activity Profile: {}",
        "total_msgs": "Total Messages", "active_days": "Active Days", "avg_msgs": "Avg Msgs / Day",
        "unique_users": "Unique Chatters", "new_chatters": "New Chatters",
        "avg_viewers": "Avg Video Viewers", "peak_viewers_period": "Peak Viewers (Period)", "est_lurkers": "Est. Lurkers",
        "vol_over_time": "Volume Over Time ({})", "top_chatters": "Top Active Chatters",
        "recent_msgs": "Recent Messages: {}", "stream_calendar": "Stream History",
        "stream_details": "Stream Summary #{}", "duration": "Duration", "peak_viewers": "Peak Viewers",
        "lurker_ratio": "Lurkers vs Chatters", "timeline_graph": "Viewership Over Time",
        "chatters": "Chatters", "lurkers": "Lurkers", "no_activity": "No activity found.",
        "no_streams": "No streams logged yet.", "no_stream_data": "No data logged for this stream.",
        "chatter": "Chatter", "messages": "Messages", "date_time": "Date & Time", "message": "Message",
        "day": "Day", "hour": "Hour", "cal_prompt": "Click a stream on the calendar to view its details.",
        "hide_staff": "Hide Mods & VIPs", "hide_staff_help": "Excludes Moderators, the Broadcaster, and VIPs.",
        "download_csv": "Download Data (CSV)", "loyalty_score": "Loyalty Score",
        "loyalty_help": "Percentage of total streams this user has attended.",
        "attended": "Attended {}/{} streams", "peak_hype": "Peak Hype Moment",
        "peak_help": "Minute with the highest concentration of messages.",
        "top_words": "Top Used Words (Top 10)", "msgs_min": "msgs/min",
        "live": "LIVE", "waiting_stats": "Waiting for API data..."
    }
}

if "app_mode" not in st.session_state: st.session_state.app_mode = "mode_overall"
def set_mode(mode): st.session_state.app_mode = mode

head_col1, head_col2 = st.columns([8, 2])
with head_col1: st.markdown("## Twitch Tracker")
with head_col2: lang = st.radio("Language", ["PL", "EN"], horizontal=True, label_visibility="collapsed")
t = TEXT[lang]

nav1, nav2, nav3 = st.columns(3)
nav1.button(t["mode_overall"], on_click=set_mode, args=("mode_overall",), use_container_width=True, type="primary" if st.session_state.app_mode == "mode_overall" else "secondary")
nav2.button(t["mode_users"], on_click=set_mode, args=("mode_users",), use_container_width=True, type="primary" if st.session_state.app_mode == "mode_users" else "secondary")
nav3.button(t["mode_streams"], on_click=set_mode, args=("mode_streams",), use_container_width=True, type="primary" if st.session_state.app_mode == "mode_streams" else "secondary")
st.divider()

if st.session_state.app_mode == "mode_overall":
    col_left, col_right = st.columns([7, 3])
    with col_left:
        st.subheader(t["overall_activity"])
    with col_right:
        hide_staff = st.checkbox(t["hide_staff"], help=t["hide_staff_help"])
    
    today = datetime.now()
    default_start = today - timedelta(days=30)
    date_range = st.date_input(t["select_dates"], value=(default_start.date(), today.date()), max_value=today.date())

    start_str = f"{date_range[0]} 00:00:00" if len(date_range) < 2 else f"{date_range[0]} 00:00:00"
    end_str = f"{date_range[0]} 23:59:59" if len(date_range) < 2 else f"{date_range[1]} 23:59:59"
        
    staff_filter = "AND (is_mod = 0 OR is_mod IS NULL) AND (is_vip = 0 OR is_vip IS NULL)" if hide_staff else ""
    where_clause = f"WHERE created_at BETWEEN '{start_str}' AND '{end_str}' {staff_filter}"

    metric_col1, metric_col2, metric_col3 = st.columns(3)
    df_overview = pd.read_sql_query(f"SELECT COUNT(*) as total_msgs, COUNT(DISTINCT username) as unique_users FROM messages {where_clause}", conn)
    total_msgs, unique_users = df_overview['total_msgs'][0], df_overview['unique_users'][0]
    
    df_new = pd.read_sql_query(f"SELECT COUNT(*) as new_chatters FROM (SELECT username, MIN(created_at) as first_seen FROM messages GROUP BY username) WHERE first_seen BETWEEN '{start_str}' AND '{end_str}'", conn)
    new_chatters = df_new['new_chatters'][0]

    table_check = pd.read_sql_query("SELECT name FROM sqlite_master WHERE type='table' AND name='stream_stats'", conn)
    avg_viewers, peak_viewers = 0, 0
    if not table_check.empty:
        df_stats = pd.read_sql_query(f"SELECT AVG(viewer_count) as avg_viewers, MAX(viewer_count) as peak_viewers FROM stream_stats WHERE timestamp BETWEEN '{start_str}' AND '{end_str}'", conn)
        avg_viewers = int(df_stats['avg_viewers'][0]) if pd.notna(df_stats['avg_viewers'][0]) else 0
        peak_viewers = int(df_stats['peak_viewers'][0]) if pd.notna(df_stats['peak_viewers'][0]) else 0

    metric_col1.metric(t["total_msgs"], f"{total_msgs:,}")
    metric_col2.metric(t["unique_users"], f"{unique_users:,}")
    metric_col3.metric(t["new_chatters"], f"{new_chatters:,}")
    
    st.divider()
    stat_col1, stat_col2 = st.columns(2)
    stat_col1.metric(t["avg_viewers"], f"{avg_viewers}")
    stat_col2.metric(t["peak_viewers_period"], f"{peak_viewers}")

    st.divider()

    df_timeline = pd.read_sql_query(f"SELECT strftime('%Y-%m-%d', created_at) as time_period, COUNT(*) as message_count FROM messages {where_clause} GROUP BY time_period ORDER BY time_period", conn)
    st.markdown(f"**{t['vol_over_time'].format(t['day'])}**")
    
    if not df_timeline.empty:
        fig_line = px.line(df_timeline, x="time_period", y="message_count", markers=True, labels={"time_period": t["day"], "message_count": t["messages"]}, template="plotly_dark")
        fig_line.update_traces(fill='tozeroy', line_color='#9146FF')
        st.plotly_chart(fig_line, use_container_width=True)
    else:
        st.warning(t["no_activity"])

    st.divider()

    st.markdown(f"**{t['top_chatters']}**")
    df_top = pd.read_sql_query(f"SELECT username, COUNT(*) as message_count, COUNT(DISTINCT strftime('%Y-%m-%d', created_at)) as active_days FROM messages {where_clause} GROUP BY username ORDER BY message_count DESC LIMIT 15", conn)
    if not df_top.empty:
        fig_bar = px.bar(df_top, x="username", y="message_count", text="message_count", hover_data={"active_days": True}, labels={"username": t["chatter"], "message_count": t["messages"], "active_days": t["active_days"]}, color="message_count", color_continuous_scale="Purples")
        st.plotly_chart(fig_bar, use_container_width=True)
        csv = df_top.to_csv(index=False).encode('utf-8')
        st.download_button(t["download_csv"], data=csv, file_name="top_chatters.csv", mime="text/csv")
    else:
        st.info(t["no_activity"])

elif st.session_state.app_mode == "mode_users":
    filter_col1, filter_col2 = st.columns(2)
    with filter_col1:
        today = datetime.now()
        date_range = st.date_input(t["select_dates"], value=(today - timedelta(days=30), today.date()), max_value=today.date())
        start_str = f"{date_range[0]} 00:00:00" if len(date_range) < 2 else f"{date_range[0]} 00:00:00"
        end_str = f"{date_range[0]} 23:59:59" if len(date_range) < 2 else f"{date_range[1]} 23:59:59"
    with filter_col2:
        search_user = st.selectbox(t["select_user"], options=user_list, index=None, placeholder=t["user_placeholder"])

    st.divider()

    if search_user:
        where_clause = f"WHERE created_at BETWEEN '{start_str}' AND '{end_str}' AND username = '{search_user}'"
        st.markdown(f"**{t['user_activity'].format(search_user)}**")
        
        m1, m2, m3, m4 = st.columns(4)
        df_stats = pd.read_sql_query(f"SELECT COUNT(*) as total_msgs, COUNT(DISTINCT strftime('%Y-%m-%d', created_at)) as active_days FROM messages {where_clause}", conn)
        total_msgs, active_days = df_stats['total_msgs'][0], df_stats['active_days'][0]
        avg_msgs = round(total_msgs / active_days) if active_days > 0 else 0
        
        m1.metric(t["total_msgs"], f"{total_msgs:,}")
        m2.metric(t["active_days"], f"{active_days}")
        m3.metric(t["avg_msgs"], f"{avg_msgs}")
        
        df_first = pd.read_sql_query(f"SELECT MIN(created_at) as first_seen FROM messages WHERE username = '{search_user}'", conn)
        first_seen = df_first['first_seen'][0]
        loyalty = 0
        if first_seen:
            total_str = pd.read_sql_query(f"SELECT COUNT(DISTINCT stream_id) as total FROM streams WHERE start_time >= '{first_seen}'", conn)['total'][0]
            attended_str = pd.read_sql_query(f"SELECT COUNT(DISTINCT stream_id) as attended FROM messages WHERE username = '{search_user}'", conn)['attended'][0]
            loyalty = round((attended_str / total_str * 100)) if total_str > 0 else 0
            m4.metric(t["loyalty_score"], f"{loyalty}%", help=f"{t['loyalty_help']}\n\n{t['attended'].format(attended_str, total_str)}")
        
        st.divider()
        st.markdown(f"**{t['recent_msgs'].format(search_user)}**")
        df_logs = pd.read_sql_query(f"SELECT created_at as '{t['date_time']}', content as '{t['message']}' FROM messages {where_clause} ORDER BY created_at DESC LIMIT 100", conn)
        if not df_logs.empty: st.dataframe(df_logs, use_container_width=True, hide_index=True)
    else:
        st.info(t["select_user"])

elif st.session_state.app_mode == "mode_streams":
    df_streams = pd.read_sql_query("SELECT stream_id, start_time, end_time FROM streams ORDER BY start_time DESC", conn)
    
    if df_streams.empty:
        st.warning(t["no_streams"])
    else:
        st.markdown(f"**{t['stream_calendar']}**")
        st.caption(t["cal_prompt"])
        
        calendar_events = []
        df_streams['start_time'] = pd.to_datetime(df_streams['start_time'])
        df_streams['end_time'] = pd.to_datetime(df_streams['end_time'])
        
        for _, row in df_streams.iterrows():
            is_live = pd.isna(row['end_time'])
            s_str = row['start_time'].strftime("%Y-%m-%dT%H:%M:%S")
            e_str = s_str if is_live else row['end_time'].strftime("%Y-%m-%dT%H:%M:%S")
            title = f"{t['live']} #{row['stream_id']}" if is_live else f"Stream #{row['stream_id']}"
            color = "#FF4B4B" if is_live else "#9146FF" 
            calendar_events.append({"title": title, "start": s_str, "end": e_str, "id": str(row['stream_id']), "backgroundColor": color, "borderColor": color})
            
        cal_state = calendar(events=calendar_events, options={"initialView": "dayGridMonth", "headerToolbar": {"left": "prev,next today", "center": "title", "right": "dayGridMonth,timeGridWeek"}, "selectable": True, "height": 550}, key="stream_cal")
        selected_stream_id = int(cal_state["eventClick"]["event"]["id"]) if cal_state.get("eventClick") else None

        if selected_stream_id:
            st.divider()
            stream_info = df_streams[df_streams['stream_id'] == selected_stream_id].iloc[0]
            is_stream_live = pd.isna(stream_info['end_time'])
            header_status = f" ({t['live']})" if is_stream_live else ""
            
            st.subheader(t["stream_details"].format(selected_stream_id) + header_status)
            
            df_st = pd.read_sql_query(f"SELECT * FROM stream_stats WHERE stream_id = {selected_stream_id} ORDER BY timestamp", conn)
            df_msgs = pd.read_sql_query(f"SELECT COUNT(*) as msgs, COUNT(DISTINCT username) as chatters FROM messages WHERE stream_id = {selected_stream_id}", conn)
            
            avg_viewers = int(df_st['viewer_count'].mean()) if not df_st.empty else 0
            peak_viewers = df_st['viewer_count'].max() if not df_st.empty else 0
            total_chatters = df_msgs['chatters'][0]
            total_msgs = df_msgs['msgs'][0]
            est_lurkers = max(0, avg_viewers - total_chatters)
            
            m1, m2, m3, m4, m5 = st.columns(5)
            m1.metric(t["peak_viewers"], f"{peak_viewers:,}")
            m2.metric(t["total_msgs"], f"{total_msgs:,}")
            m3.metric(t["unique_users"], f"{total_chatters:,}")
            m4.metric(t["est_lurkers"], f"{est_lurkers:,}")
            
            df_peak = pd.read_sql_query(f"SELECT strftime('%Y-%m-%d %H:%M', created_at) as minute, COUNT(*) as count FROM messages WHERE stream_id = {selected_stream_id} GROUP BY minute ORDER BY count DESC LIMIT 1", conn)
            if not df_peak.empty:
                m5.metric(t["peak_hype"], f"{df_peak['count'][0]} {t['msgs_min']}", help=f"{t['peak_help']}\n\n{t['date_time']}: {df_peak['minute'][0]}")
            else:
                m5.metric(t["peak_hype"], f"0 {t['msgs_min']}", help=t["peak_help"])
            
            st.text("") 

            if not df_st.empty:
                df_st['timestamp'] = pd.to_datetime(df_st['timestamp']) 
                
                graph_col, pie_col = st.columns([7, 3])
                with graph_col:
                    st.markdown(f"**{t['timeline_graph']}**")
                    
                    y_cols = ["viewer_count"]
                    if "chat_connections" in df_st.columns and df_st["chat_connections"].sum() > 0:
                        y_cols.append("chat_connections")
                        
                    fig_st = px.line(df_st, x="timestamp", y=y_cols, markers=True, 
                                     labels={"value": "Count", "timestamp": t["date_time"], "variable": "Metric"}, 
                                     template="plotly_dark")
                    
                    fig_st.update_traces(patch={"line": {"color": "#9146FF", "width": 3}}, selector={"name": "viewer_count"})
                    if "chat_connections" in y_cols:
                        fig_st.update_traces(patch={"line": {"color": "#00E6CB", "width": 2, "dash": "dot"}}, selector={"name": "chat_connections"})
                        
                    st.plotly_chart(fig_st, use_container_width=True)
                    
                with pie_col:
                    st.markdown(f"**{t['lurker_ratio']}**")
                    if total_chatters + est_lurkers > 0:
                        pie_data = pd.DataFrame({"Type": [t["chatters"], t["lurkers"]], "Count": [total_chatters, est_lurkers]})
                        fig_pie = px.pie(pie_data, names="Type", values="Count", template="plotly_dark", color="Type", color_discrete_map={t["chatters"]: "#9146FF", t["lurkers"]: "#555555"})
                        fig_pie.update_traces(textinfo='percent+label', pull=[0.05, 0])
                        st.plotly_chart(fig_pie, use_container_width=True)
                    else:
                        st.info(t["waiting_stats"])
            else:
                st.info(t["waiting_stats"])
            
            st.divider()
            
            df_all_content = pd.read_sql_query(f"SELECT content FROM messages WHERE stream_id = {selected_stream_id}", conn)
            if not df_all_content.empty:
                st.markdown(f"**{t['top_words']}**")
                words = pd.Series(' '.join(df_all_content['content']).split())
                words = words[words.str.len() > 2] 
                top_words = words.value_counts().head(10).reset_index()
                top_words.columns = ["Word/Emote", "Count"]
                
                fig_words = px.bar(top_words, x="Count", y="Word/Emote", orientation='h', template="plotly_dark")
                fig_words.update_layout(yaxis={'categoryorder':'total ascending'})
                fig_words.update_traces(marker_color='#00E6CB')
                st.plotly_chart(fig_words, use_container_width=True)
