/**
 * TwitchMetrics - Frontend Application Logic
 * Vanilla JavaScript & Chart.js Integration
 */

// Global App State
const state = {
  lang: localStorage.getItem('tm_lang') || 'PL',
  activeTab: 'overall',
  datePreset: '30d',
  startDate: null,
  endDate: null,
  hideStaff: localStorage.getItem('tm_hide_staff') === 'true',
  hideViewers: localStorage.getItem('tm_hide_viewers') !== 'false', // Default is TRUE (streamer safe mode)
  authPassword: localStorage.getItem('tm_auth_pwd') || '',
  selectedUser: null,
  selectedStreamId: null,
  channel: 'Streamer',
  isLive: false,
  charts: {}
};

// API Base URL (uses /api on web server, or http://localhost:8000/api when opened directly as file://)
const API_BASE = window.location.protocol === 'file:' ? 'http://localhost:8000/api' : '/api';

// Multilingual Dictionary
const I18N = {
  PL: {
    tab_overall: "Ogólne Statystyki",
    tab_user: "Śledzenie Widza",
    tab_streams: "Historia Streamów",
    tab_status: "Status & Wdrożenie",
    preset_today: "Dziś",
    preset_7d: "7 Dni",
    preset_30d: "30 Dni",
    preset_90d: "90 Dni",
    preset_all: "Wszystko",
    preset_custom: "Własny zakres",
    hide_staff: "Ukryj Modów i VIP",
    export_csv: "Eksportuj CSV",
    kpi_total_msgs: "Suma Wiadomości",
    kpi_msgs_sub: "W wybranym okresie",
    kpi_unique_chatters: "Unikalni Czatujący",
    kpi_users_sub: "Osoby aktywne na czacie",
    kpi_new_chatters: "Nowi Użytkownicy",
    kpi_new_sub: "Pierwsza wiadomość w historii",
    kpi_avg_viewers: "Śr. Widzów Streamów",
    kpi_avg_v_sub: "Z oficjalnego API Twitcha",
    kpi_peak_viewers: "Szczyt Widzów (Peak)",
    kpi_peak_sub: "Maksimum w okresie",
    chart_timeline_title: "Aktywność Czatu w Czasie",
    chart_timeline_sub: "Liczba wiadomości każdego dnia",
    chart_hourly_title: "Rozkład Godzinowy",
    chart_hourly_sub: "Godziny największej aktywności",
    top_chatters_title: "Najbardziej Aktywni Czatujący (Top 20)",
    top_chatters_sub: "Kliknij nick, aby otworzyć szczegółowy profil widza",
    th_user: "Widz",
    th_role: "Ranga",
    th_messages: "Wiadomości",
    th_active_days: "Aktywne Dni",
    th_share: "Udział w Czacie",
    th_action: "Profil",
    btn_search: "Szukaj",
    u_first_seen: "Pierwszy raz na czacie:",
    u_last_seen: "Ostatnia wiadomość:",
    export_user_csv: "Pobierz Historię (CSV)",
    u_total_msgs: "Wiadomości (Okres)",
    u_all_time: "Łącznie w bazie:",
    u_active_days: "Aktywne Dni",
    u_active_days_sub: "Dni z wysłaną wiadomością",
    u_avg_daily: "Śr. Wiadomości / Dzień",
    u_avg_daily_sub: "Podczas aktywnych dni",
    u_loyalty: "Wskaźnik Lojalności",
    u_chart_title: "Aktywność Widza w Czasie",
    u_feed_title: "Ostatnie Wiadomości",
    u_search_placeholder: "🔍 Wpisz nick widza powyżej lub kliknij na nick w tabeli Najaktywniejszych, aby sprawdzić profil.",
    streams_archive_title: "Zarejestrowane Streamy",
    streams_archive_sub: "Wybierz sesję streama, aby zobaczyć szczegółową analizę oglądalności i hype'u",
    s_peak_viewers: "Max Widzów (Peak)",
    s_peak_sub: "Najwyższy punkt sesji",
    s_avg_viewers: "Średnia Widzów",
    s_avg_sub: "Średnia z próbek API",
    s_total_msgs: "Wiadomości",
    s_total_sub: "Wszystkie z czatu",
    s_chatters: "Unikalni Czatujący",
    s_chatters_sub: "Aktywnych na czacie",
    s_lurkers: "Szacowani Lurkerzy",
    s_lurkers_sub: "Śr. widzów bez wiadomości",
    s_hype: "Szczyt Hype'u",
    s_viewers_curve: "Przebieg Oglądalności w Czasie",
    s_viewers_curve_sub: "Liczba widzów co 2 minuty",
    s_chatter_ratio: "Czatujący vs Lurkerzy",
    s_chatter_ratio_sub: "Proporcja zaangażowania",
    s_words_title: "Top Słowa i Emotki na Streamie",
    s_words_sub: "Najczęściej używane na czacie",
    s_mvp_title: "Najbardziej Aktywni na Streamie",
    s_mvp_sub: "Liderzy czatu tej sesji",
    modal_date_title: "Wybierz Własny Zakres Dat",
    modal_date_from: "Data od:",
    modal_date_to: "Data do:",
    btn_cancel: "Anuluj",
    btn_apply: "Zastosuj",
    modal_auth_title: "Panel Zabezpieczony Hasłem",
    modal_auth_desc: "Wprowadź hasło dostępu, aby przeglądać statystyki czatu.",
    btn_login: "Zaloguj",
    btn_logout: "Wyloguj",
    btn_close: "Zamknij",
    badge_mod: "MOD",
    badge_vip: "VIP",
    badge_sub: "SUB",
    chart_msgs: "Wiadomości",
    chart_unique: "Unikalni Czatujący",
    chart_viewers: "Widzowie",
    chart_lurkers: "Lurkerzy",
    chart_chatters: "Czatujący",
    attended_text: "Obecność na {0}/{1} streamach",
    live_badge: "NA ŻYWO",
    offline_badge: "OFFLINE",
    hide_viewers: "Ukryj widzów 🙈",
    hidden_badge: "🙈 Ukryte",
    s_viewers_hidden_chart: "Wykres oglądalności jest ukryty (Tryb bezpieczny streamerki).",
    s_viewers_hidden_hint: "Możesz go odkryć przełącznikiem u góry strony.",
    s_ratio_hidden_chart: "Proporcja widzów ukryta."
  },
  EN: {
    tab_overall: "Overall Stats",
    tab_user: "User Tracking",
    tab_streams: "Stream Archive",
    tab_status: "Status & Deployment",
    preset_today: "Today",
    preset_7d: "7 Days",
    preset_30d: "30 Days",
    preset_90d: "90 Days",
    preset_all: "All Time",
    preset_custom: "Custom Range",
    hide_staff: "Hide Mods & VIPs",
    export_csv: "Export CSV",
    kpi_total_msgs: "Total Messages",
    kpi_msgs_sub: "In selected period",
    kpi_unique_chatters: "Unique Chatters",
    kpi_users_sub: "Active chat participants",
    kpi_new_chatters: "New Chatters",
    kpi_new_sub: "First seen message in DB",
    kpi_avg_viewers: "Avg Stream Viewers",
    kpi_avg_v_sub: "From official Twitch API",
    kpi_peak_viewers: "Peak Viewers",
    kpi_peak_sub: "Period high",
    chart_timeline_title: "Chat Activity Over Time",
    chart_timeline_sub: "Messages and unique chatters per day",
    chart_hourly_title: "Hourly Distribution",
    chart_hourly_sub: "Busiest chat hours of the day",
    top_chatters_title: "Most Active Chatters (Top 20)",
    top_chatters_sub: "Click on any user to view in-depth profile",
    th_user: "User",
    th_role: "Role",
    th_messages: "Messages",
    th_active_days: "Active Days",
    th_share: "Chat Share",
    th_action: "Profile",
    btn_search: "Search",
    u_first_seen: "First seen in chat:",
    u_last_seen: "Last message:",
    export_user_csv: "Download History (CSV)",
    u_total_msgs: "Messages (Period)",
    u_all_time: "All-time total:",
    u_active_days: "Active Days",
    u_active_days_sub: "Days with messages sent",
    u_avg_daily: "Avg Messages / Day",
    u_avg_daily_sub: "During active days",
    u_loyalty: "Loyalty Score",
    u_chart_title: "User Activity Over Time",
    u_feed_title: "Recent Messages",
    u_search_placeholder: "🔍 Type a username above or click on any name in the leaderboard to inspect.",
    streams_archive_title: "Recorded Streams",
    streams_archive_sub: "Select a stream session to inspect viewership and hype analytics",
    s_peak_viewers: "Peak Viewers",
    s_peak_sub: "Session peak viewers",
    s_avg_viewers: "Avg Viewers",
    s_avg_sub: "Average from API samples",
    s_total_msgs: "Messages",
    s_total_sub: "Total chat messages",
    s_chatters: "Unique Chatters",
    s_chatters_sub: "Active chatters",
    s_lurkers: "Estimated Lurkers",
    s_lurkers_sub: "Avg viewers without chatting",
    s_hype: "Peak Hype Moment",
    s_viewers_curve: "Viewership Curve Over Time",
    s_viewers_curve_sub: "Viewer count every 2 minutes",
    s_chatter_ratio: "Chatters vs Lurkers",
    s_chatter_ratio_sub: "Engagement breakdown",
    s_words_title: "Top Words & Emotes",
    s_words_sub: "Most frequent in this stream",
    s_mvp_title: "Stream MVP Chatters",
    s_mvp_sub: "Top chatters of this session",
    modal_date_title: "Select Custom Date Range",
    modal_date_from: "Start Date:",
    modal_date_to: "End Date:",
    btn_cancel: "Cancel",
    btn_apply: "Apply",
    modal_auth_title: "Password Protected Panel",
    modal_auth_desc: "Enter the access password to inspect stream analytics.",
    btn_login: "Login",
    btn_logout: "Logout",
    btn_close: "Close",
    badge_mod: "MOD",
    badge_vip: "VIP",
    badge_sub: "SUB",
    chart_msgs: "Messages",
    chart_unique: "Unique Chatters",
    chart_viewers: "Viewers",
    chart_lurkers: "Lurkers",
    chart_chatters: "Chatters",
    attended_text: "Present at {0}/{1} streams",
    live_badge: "LIVE",
    offline_badge: "OFFLINE",
    hide_viewers: "Hide Viewers 🙈",
    hidden_badge: "🙈 Hidden",
    s_viewers_hidden_chart: "Viewership curve is hidden (Streamer safe mode).",
    s_viewers_hidden_hint: "You can reveal it using the toggle at the top.",
    s_ratio_hidden_chart: "Viewers ratio hidden."
  }
};

function t(key) {
  return (I18N[state.lang] && I18N[state.lang][key]) || key;
}

// Custom Fetch with optional Password Header
async function fetchAPI(endpoint, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (state.authPassword) {
    headers['X-Panel-Password'] = state.authPassword;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
  
  if (response.status === 401) {
    openAuthModal();
    throw new Error("Wymagana autoryzacja (kod 401). Wprowadź hasło.");
  }
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Błąd HTTP ${response.status}: ${errorText}`);
  }
  
  return await response.json();
}

// Toast Notifications
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${type === 'error' ? '⚠️' : '✅'}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Date Range Calculation
function calculateDateRange(preset) {
  const now = new Date();
  const format = d => d.toISOString().split('T')[0];
  state.datePreset = preset;

  if (preset === 'today') {
    state.startDate = format(now);
    state.endDate = format(now);
  } else if (preset === '7d') {
    const past = new Date();
    past.setDate(now.getDate() - 7);
    state.startDate = format(past);
    state.endDate = format(now);
  } else if (preset === '30d') {
    const past = new Date();
    past.setDate(now.getDate() - 30);
    state.startDate = format(past);
    state.endDate = format(now);
  } else if (preset === '90d') {
    const past = new Date();
    past.setDate(now.getDate() - 90);
    state.startDate = format(past);
    state.endDate = format(now);
  } else if (preset === 'all') {
    state.startDate = '';
    state.endDate = '';
  }
}

function getDateQueryParams() {
  const params = new URLSearchParams();
  if (state.startDate) params.append('start_date', state.startDate);
  if (state.endDate) params.append('end_date', state.endDate);
  if (state.hideStaff) params.append('hide_staff', 'true');
  return params.toString() ? `?${params.toString()}` : '';
}

// Initialize Application
window.addEventListener('DOMContentLoaded', async () => {
  // Chart.js High-Performance Settings (Zero lag even in CPU/software rasterization)
  if (window.Chart) {
    Chart.defaults.animation = false; // Disable heavy canvas tweening
    Chart.defaults.responsive = true;
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.devicePixelRatio = 1; // 1:1 pixel mapping for ultra-fast CPU rasterization
    Chart.defaults.resizeDelay = 200;
    Chart.defaults.hover.animationDuration = 0;
    Chart.defaults.plugins.tooltip.animation = false;
  }

  // Load settings
  calculateDateRange('30d');
  document.getElementById('hide-staff-toggle').checked = state.hideStaff;
  const viewerToggle = document.getElementById('hide-viewers-toggle');
  if (viewerToggle) viewerToggle.checked = state.hideViewers;
  
  // Set initial i18n
  applyLanguageUI();

  // Load Status & Users List
  await checkStatus();
  loadUsersAutocomplete();

  // Load Default Tab
  loadOverallStats();
});

// Switch Tab
function switchTab(tabId) {
  state.activeTab = tabId;
  document.querySelectorAll('.nav-tab-btn').forEach(btn => btn.classList.remove('active'));
  document.getElementById(`tab-btn-${tabId}`).classList.add('active');

  document.querySelectorAll('.tab-content').forEach(view => view.classList.remove('active'));
  document.getElementById(`view-${tabId}`).classList.add('active');

  const toolbar = document.getElementById('main-toolbar');
  if (tabId === 'streams' || tabId === 'status') {
    toolbar.style.display = 'none';
  } else {
    toolbar.style.display = 'flex';
  }

  if (tabId === 'overall') loadOverallStats();
  if (tabId === 'streams') loadStreams();
  if (tabId === 'status') checkStatus();
}

function refreshCurrentTab() {
  if (state.activeTab === 'overall') loadOverallStats();
  if (state.activeTab === 'user' && state.selectedUser) loadUserData(state.selectedUser);
  if (state.activeTab === 'streams') loadStreams();
  checkStatus();
  showToast("Zaktualizowano dane!", "success");
}

// Language Switcher
function switchLanguage(lang) {
  state.lang = lang;
  localStorage.setItem('tm_lang', lang);
  document.getElementById('lang-pl').classList.toggle('active', lang === 'PL');
  document.getElementById('lang-en').classList.toggle('active', lang === 'EN');
  applyLanguageUI();
  refreshCurrentTab();
}

function applyLanguageUI() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.innerText = t(key);
  });
}

// Status check
async function checkStatus() {
  try {
    const data = await fetchAPI('/status');
    state.channel = data.channel || 'Streamer';
    state.isLive = data.is_live;

    document.getElementById('channel-name-display').innerText = state.channel;
    document.getElementById('streamer-link').href = `https://twitch.tv/${state.channel}`;

    const livePill = document.getElementById('live-status-pill');
    const liveText = document.getElementById('live-status-text');
    if (data.is_live) {
      livePill.className = 'status-pill live';
      if (state.hideViewers) {
        liveText.innerText = t('live_badge');
      } else {
        liveText.innerText = `${t('live_badge')} (${data.current_stream?.viewer_count || 0} ${t('chart_viewers')})`;
      }
    } else {
      livePill.className = 'status-pill offline';
      liveText.innerText = t('offline_badge');
    }

    // Tab Status details
    document.getElementById('sys-channel').innerText = state.channel;
    document.getElementById('sys-msgs').innerText = (data.total_messages || 0).toLocaleString();
    document.getElementById('sys-streams').innerText = data.total_streams || 0;
    document.getElementById('sys-db-size').innerText = `${data.db_size_mb || 0} MB`;
    document.getElementById('sys-auth-status').innerText = data.auth_required ? 'Włączona (hasło wymagane)' : 'Wyłączona (otwarty dostęp)';

    const logoutBtn = document.getElementById('btn-logout');
    if (state.authPassword) {
      logoutBtn.style.display = 'block';
    } else {
      logoutBtn.style.display = 'none';
    }
  } catch (err) {
    console.error("Status fetch failed:", err);
  }
}

// Date Presets
function setDatePreset(preset) {
  calculateDateRange(preset);
  document.querySelectorAll('#date-presets .filter-chip').forEach(c => c.classList.remove('active'));
  const activeBtn = document.querySelector(`#date-presets [data-range="${preset}"]`);
  if (activeBtn) activeBtn.classList.add('active');
  document.getElementById('custom-date-label').innerText = t('preset_custom');
  
  if (state.activeTab === 'overall') loadOverallStats();
  if (state.activeTab === 'user' && state.selectedUser) loadUserData(state.selectedUser);
}

function openCustomDateModal() {
  document.getElementById('input-date-start').value = state.startDate || '';
  document.getElementById('input-date-end').value = state.endDate || '';
  document.getElementById('custom-date-modal').classList.add('active');
}

function closeCustomDateModal() {
  document.getElementById('custom-date-modal').classList.remove('active');
}

function applyCustomDates() {
  const s = document.getElementById('input-date-start').value;
  const e = document.getElementById('input-date-end').value;
  if (!s || !e) {
    showToast("Wybierz obie daty!", "error");
    return;
  }
  state.startDate = s;
  state.endDate = e;
  state.datePreset = 'custom';
  
  document.querySelectorAll('#date-presets .filter-chip').forEach(c => c.classList.remove('active'));
  document.getElementById('chip-custom-date').classList.add('active');
  document.getElementById('custom-date-label').innerText = `${s} -> ${e}`;

  closeCustomDateModal();
  if (state.activeTab === 'overall') loadOverallStats();
  if (state.activeTab === 'user' && state.selectedUser) loadUserData(state.selectedUser);
}

function toggleHideStaff(checked) {
  state.hideStaff = checked;
  localStorage.setItem('tm_hide_staff', checked ? 'true' : 'false');
  if (state.activeTab === 'overall') loadOverallStats();
}

function toggleHideViewers(checked) {
  state.hideViewers = checked;
  localStorage.setItem('tm_hide_viewers', checked ? 'true' : 'false');
  refreshCurrentTab();
}

// -------------------------------------------------------------
// TAB 1: OVERALL STATS
// -------------------------------------------------------------
async function loadOverallStats() {
  try {
    const data = await fetchAPI(`/stats/overall${getDateQueryParams()}`);
    
    // KPI Cards
    document.getElementById('kpi-total-msgs').innerText = (data.total_msgs || 0).toLocaleString();
    document.getElementById('kpi-unique-users').innerText = (data.unique_users || 0).toLocaleString();
    document.getElementById('kpi-new-chatters').innerText = (data.new_chatters || 0).toLocaleString();
    
    if (state.hideViewers) {
      document.getElementById('kpi-avg-viewers').innerHTML = `<span class="hidden-stat-badge">${t('hidden_badge')}</span>`;
      document.getElementById('kpi-peak-viewers').innerHTML = `<span class="hidden-stat-badge">${t('hidden_badge')}</span>`;
    } else {
      document.getElementById('kpi-avg-viewers').innerText = (data.avg_viewers || 0).toLocaleString();
      document.getElementById('kpi-peak-viewers').innerText = (data.peak_viewers || 0).toLocaleString();
    }

    // Chart 1: Activity Timeline
    renderTimelineChart(data.timeline || []);

    // Chart 2: Hourly Distribution
    renderHourlyChart(data.hourly_distribution || []);

    // Top Chatters Table
    renderTopUsersTable(data.top_users || []);
  } catch (err) {
    showToast(`Błąd pobierania statystyk: ${err.message}`, 'error');
  }
}

function renderTimelineChart(timeline) {
  const ctx = document.getElementById('canvas-timeline').getContext('2d');
  if (state.charts.timeline) state.charts.timeline.destroy();

  const labels = timeline.map(item => item.date);
  const msgCounts = timeline.map(item => item.count);
  const userCounts = timeline.map(item => item.unique_chatters);

  state.charts.timeline = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: t('chart_msgs'),
          data: msgCounts,
          borderColor: '#9146FF',
          backgroundColor: 'rgba(145, 70, 255, 0.12)',
          fill: true,
          tension: 0.15,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          spanGaps: true,
          normalized: true
        },
        {
          label: t('chart_unique'),
          data: userCounts,
          borderColor: '#00E6CB',
          borderDash: [4, 4],
          fill: false,
          tension: 0.15,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          spanGaps: true,
          normalized: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#A1A1AA', font: { family: 'Inter', size: 12 } } },
        tooltip: { backgroundColor: '#18181b', borderColor: '#27272a', borderWidth: 1, titleFont: { family: 'Outfit', size: 14 } }
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#71717A', maxTicksLimit: 12 } },
        y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.06)' }, ticks: { color: '#71717A' } }
      }
    }
  });
}

function renderHourlyChart(hourly) {
  const ctx = document.getElementById('canvas-hourly').getContext('2d');
  if (state.charts.hourly) state.charts.hourly.destroy();

  const labels = hourly.map(item => `${item.hour}:00`);
  const counts = hourly.map(item => item.count);

  state.charts.hourly = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: t('chart_msgs'),
        data: counts,
        backgroundColor: '#bf94ff',
        borderRadius: 4,
        hoverBackgroundColor: '#00E6CB'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor: '#18181b', borderColor: '#27272a', borderWidth: 1 }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#71717A', maxTicksLimit: 8 } },
        y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#71717A' } }
      }
    }
  });
}

function renderTopUsersTable(topUsers) {
  const tbody = document.getElementById('top-users-tbody');
  if (!topUsers.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Brak danych w wybranym okresie.</td></tr>`;
    return;
  }

  tbody.innerHTML = topUsers.map((u, idx) => {
    let rankClass = 'rank-other';
    if (idx === 0) rankClass = 'rank-1';
    else if (idx === 1) rankClass = 'rank-2';
    else if (idx === 2) rankClass = 'rank-3';

    let badges = '';
    if (u.is_mod) badges += `<span class="role-badge role-mod">${t('badge_mod')}</span>`;
    if (u.is_vip) badges += `<span class="role-badge role-vip">${t('badge_vip')}</span>`;
    if (u.is_sub) badges += `<span class="role-badge role-sub">${t('badge_sub')}</span>`;

    return `
      <tr>
        <td><span class="rank-badge ${rankClass}">${idx + 1}</span></td>
        <td>
          <a class="chatter-link" onclick="openUserProfile('${u.username}')">${u.username}</a>
        </td>
        <td>${badges || '<span style="color: var(--text-muted); font-size: 0.75rem;">-</span>'}</td>
        <td>
          <strong>${u.count.toLocaleString()}</strong>
          <div class="progress-bar-bg">
            <div class="progress-bar-fill" style="width: ${Math.min(100, u.percentage * 4)}%;"></div>
          </div>
        </td>
        <td>${u.active_days} dni</td>
        <td><span style="font-family: monospace; font-size: 0.85rem;">${u.percentage}%</span></td>
        <td style="text-align: right;">
          <button class="btn btn-secondary" style="padding: 0.3rem 0.65rem; font-size: 0.75rem;" onclick="openUserProfile('${u.username}')">
            👤 ${t('th_action')}
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

// -------------------------------------------------------------
// TAB 2: USER INTELLIGENCE & TRACKING
// -------------------------------------------------------------
async function loadUsersAutocomplete() {
  try {
    const users = await fetchAPI('/users?limit=250');
    const datalist = document.getElementById('users-datalist');
    datalist.innerHTML = users.map(u => `<option value="${u.username}">`).join('');
  } catch (err) {}
}

function openUserProfile(username) {
  document.getElementById('user-search-input').value = username;
  switchTab('user');
  loadUserData(username);
}

function searchSelectedUser() {
  const username = document.getElementById('user-search-input').value.trim();
  if (!username) {
    showToast("Wpisz nick widza!", "error");
    return;
  }
  loadUserData(username);
}

async function loadUserData(username) {
  state.selectedUser = username;
  document.getElementById('user-placeholder').style.display = 'none';
  document.getElementById('user-details-wrapper').style.display = 'block';

  try {
    const data = await fetchAPI(`/stats/user/${encodeURIComponent(username)}${getDateQueryParams()}`);
    
    // Header
    document.getElementById('u-avatar').innerText = username.charAt(0).toUpperCase();
    document.getElementById('u-name').innerText = username;
    
    let badges = '';
    if (data.badges?.is_mod) badges += `<span class="role-badge role-mod">${t('badge_mod')}</span>`;
    if (data.badges?.is_vip) badges += `<span class="role-badge role-vip">${t('badge_vip')}</span>`;
    if (data.badges?.is_sub) badges += `<span class="role-badge role-sub">${t('badge_sub')}</span>`;
    document.getElementById('u-badges-container').innerHTML = badges;

    document.getElementById('u-first-seen').innerText = data.first_seen || '-';
    document.getElementById('u-last-seen').innerText = data.last_seen || '-';

    // 4 KPI Cards
    document.getElementById('u-period-msgs').innerText = (data.total_msgs || 0).toLocaleString();
    document.getElementById('u-alltime-msgs').innerText = (data.all_time_msgs || 0).toLocaleString();
    document.getElementById('u-active-days').innerText = data.active_days || 0;
    document.getElementById('u-avg-daily').innerText = data.avg_msgs_per_day || 0;
    
    document.getElementById('u-loyalty').innerText = `${data.loyalty_score}%`;
    const attendedMsg = t('attended_text').replace('{0}', data.streams_attended || 0).replace('{1}', data.total_streams_since_first || 0);
    document.getElementById('u-loyalty-sub').innerText = attendedMsg;

    // User Chart
    renderUserTimelineChart(data.timeline || []);

    // Recent Messages
    renderUserMessagesFeed(data.recent_msgs || []);

  } catch (err) {
    showToast(`Błąd profilu użytkownika: ${err.message}`, 'error');
  }
}

function renderUserTimelineChart(timeline) {
  const ctx = document.getElementById('canvas-user-timeline').getContext('2d');
  if (state.charts.userTimeline) state.charts.userTimeline.destroy();

  state.charts.userTimeline = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: timeline.map(item => item.date),
      datasets: [{
        label: t('chart_msgs'),
        data: timeline.map(item => item.count),
        backgroundColor: '#00E6CB',
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor: '#18181b', borderColor: '#27272a', borderWidth: 1 }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#71717A', maxTicksLimit: 10 } },
        y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#71717A' } }
      }
    }
  });
}

function renderUserMessagesFeed(messages) {
  const feed = document.getElementById('user-messages-feed');
  if (!messages.length) {
    feed.innerHTML = `<div class="empty-state">Brak wiadomości w wybranym okresie.</div>`;
    return;
  }

  feed.innerHTML = messages.map(m => `
    <div class="message-item">
      <div class="message-meta">
        <span>🕒 ${m.created_at}</span>
        ${m.stream_id ? `<span>Stream #${m.stream_id}</span>` : ''}
      </div>
      <div class="message-text">${escapeHTML(m.content)}</div>
    </div>
  `).join('');
}

// -------------------------------------------------------------
// TAB 3: STREAM ARCHIVE & HYPE ANALYTICS
// -------------------------------------------------------------
async function loadStreams() {
  const grid = document.getElementById('streams-selector-grid');
  grid.innerHTML = '<div class="loading-spinner"></div>';

  try {
    const streams = await fetchAPI('/streams');
    if (!streams.length) {
      grid.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;">Brak zarejestrowanych streamów w bazie.</div>`;
      return;
    }

    grid.innerHTML = streams.map(s => `
      <div class="stream-card glass-panel ${state.selectedStreamId === s.stream_id ? 'selected' : ''}" onclick="selectStream(${s.stream_id})">
        <div class="stream-card-header">
          <span class="stream-date">Stream #${s.stream_id}</span>
          ${s.is_live ? '<span class="status-pill live">LIVE</span>' : `<span class="brand-channel-badge">${formatDuration(s.duration_minutes)}</span>`}
        </div>
        <div style="font-size: 0.8rem; color: var(--text-muted);">${s.start_time || '-'}</div>
        <div class="stream-metrics-mini">
          <div>
            <div class="mini-stat-label">${t('s_peak_viewers')}</div>
            <div class="mini-stat-val" style="color: var(--accent-cyan);">${state.hideViewers ? `<span class="hidden-stat-badge" style="font-size: 0.8rem; padding: 0.1rem 0.4rem;">${t('hidden_badge')}</span>` : s.peak_viewers.toLocaleString()}</div>
          </div>
          <div>
            <div class="mini-stat-label">${t('s_total_msgs')}</div>
            <div class="mini-stat-val" style="color: var(--twitch-purple-light);">${s.total_msgs.toLocaleString()}</div>
          </div>
        </div>
      </div>
    `).join('');

    // Automatically select the first/latest stream if none selected
    if (!state.selectedStreamId && streams.length > 0) {
      selectStream(streams[0].stream_id);
    } else if (state.selectedStreamId) {
      selectStream(state.selectedStreamId);
    }

  } catch (err) {
    grid.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;">Błąd ładowania streamów: ${err.message}</div>`;
  }
}

async function selectStream(streamId) {
  state.selectedStreamId = streamId;
  document.querySelectorAll('.stream-card').forEach(c => c.classList.remove('selected'));
  
  const panel = document.getElementById('stream-detail-panel');
  panel.style.display = 'block';

  try {
    const s = await fetchAPI(`/streams/${streamId}`);
    
    document.getElementById('stream-detail-title').firstElementChild.innerText = `Stream #${s.stream_id}`;
    const liveBadge = document.getElementById('stream-live-badge');
    if (s.is_live) liveBadge.style.display = 'inline-flex';
    else liveBadge.style.display = 'none';

    document.getElementById('stream-detail-time').innerText = `${s.start_time} — ${s.end_time || t('live_badge')}`;
    document.getElementById('stream-detail-duration').innerText = `⏱️ ${s.duration_formatted}`;

    // 6 KPI Cards
    if (state.hideViewers) {
      document.getElementById('s-peak-v').innerHTML = `<span class="hidden-stat-badge">${t('hidden_badge')}</span>`;
      document.getElementById('s-avg-v').innerHTML = `<span class="hidden-stat-badge">${t('hidden_badge')}</span>`;
      document.getElementById('s-lurkers').innerHTML = `<span class="hidden-stat-badge">${t('hidden_badge')}</span>`;
    } else {
      document.getElementById('s-peak-v').innerText = s.peak_viewers.toLocaleString();
      document.getElementById('s-avg-v').innerText = s.avg_viewers.toLocaleString();
      document.getElementById('s-lurkers').innerText = s.est_lurkers.toLocaleString();
    }

    document.getElementById('s-hype').innerText = `${s.peak_hype?.count || 0} wiad/min`;
    document.getElementById('s-hype-sub').innerText = s.peak_hype?.minute ? `Godzina: ${s.peak_hype.minute}` : '-';

    // Charts
    renderStreamViewersChart(s.viewers_timeline || []);
    renderStreamRatioChart(s.unique_chatters || 0, s.est_lurkers || 0);
    renderStreamWordsChart(s.top_words || []);
    renderStreamMvpTable(s.top_chatters || []);

  } catch (err) {
    showToast(`Błąd detali streama: ${err.message}`, 'error');
  }
}

function renderStreamViewersChart(timeline) {
  const canvas = document.getElementById('canvas-stream-viewers');
  const msgHidden = document.getElementById('msg-stream-viewers-hidden');

  if (state.hideViewers) {
    canvas.style.display = 'none';
    if (msgHidden) msgHidden.style.display = 'flex';
    if (state.charts.streamViewers) {
      state.charts.streamViewers.destroy();
      state.charts.streamViewers = null;
    }
    return;
  }

  canvas.style.display = 'block';
  if (msgHidden) msgHidden.style.display = 'none';

  const ctx = canvas.getContext('2d');
  if (state.charts.streamViewers) state.charts.streamViewers.destroy();

  const labels = timeline.map(i => i.timestamp.split(' ')[1] || i.timestamp);
  const viewers = timeline.map(i => i.viewer_count);

  state.charts.streamViewers = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: t('chart_viewers'),
        data: viewers,
        borderColor: '#9146FF',
        backgroundColor: 'rgba(145, 70, 255, 0.12)',
        fill: true,
        tension: 0.15,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        spanGaps: true,
        normalized: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor: '#18181b', borderColor: '#27272a', borderWidth: 1 }
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#71717A', maxTicksLimit: 10 } },
        y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.06)' }, ticks: { color: '#71717A' } }
      }
    }
  });
}

function renderStreamRatioChart(chatters, lurkers) {
  const canvas = document.getElementById('canvas-stream-ratio');
  const msgHidden = document.getElementById('msg-stream-ratio-hidden');

  if (state.hideViewers) {
    canvas.style.display = 'none';
    if (msgHidden) msgHidden.style.display = 'flex';
    if (state.charts.streamRatio) {
      state.charts.streamRatio.destroy();
      state.charts.streamRatio = null;
    }
    return;
  }

  canvas.style.display = 'block';
  if (msgHidden) msgHidden.style.display = 'none';

  const ctx = canvas.getContext('2d');
  if (state.charts.streamRatio) state.charts.streamRatio.destroy();

  state.charts.streamRatio = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: [t('chart_chatters'), t('chart_lurkers')],
      datasets: [{
        data: [chatters, lurkers],
        backgroundColor: ['#9146FF', '#3F3F46'],
        borderWidth: 0,
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#A1A1AA', font: { family: 'Inter' } } }
      },
      cutout: '68%'
    }
  });
}

function renderStreamWordsChart(topWords) {
  const ctx = document.getElementById('canvas-stream-words').getContext('2d');
  if (state.charts.streamWords) state.charts.streamWords.destroy();

  state.charts.streamWords = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: topWords.map(w => w.word),
      datasets: [{
        label: 'Wystąpienia',
        data: topWords.map(w => w.count),
        backgroundColor: '#00E6CB',
        borderRadius: 4
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#71717A' } },
        y: { grid: { display: false }, ticks: { color: '#F4F4F5' } }
      }
    }
  });
}

function renderStreamMvpTable(mvps) {
  const tbody = document.getElementById('stream-mvps-tbody');
  tbody.innerHTML = mvps.map((u, i) => `
    <tr>
      <td><span class="rank-badge ${i < 3 ? `rank-${i+1}` : 'rank-other'}">${i+1}</span></td>
      <td><a class="chatter-link" onclick="openUserProfile('${u.username}')">${u.username}</a></td>
      <td><strong>${u.count.toLocaleString()}</strong></td>
    </tr>
  `).join('');
}

// -------------------------------------------------------------
// CSV EXPORTS (Native & Resilient Downloads)
// -------------------------------------------------------------
function downloadCSV(endpoint, filename) {
  if (state.authRequired && !state.authPassword) {
    openAuthModal();
    showToast('Wprowadź hasło dostępu, aby pobrać plik CSV', 'warning');
    return;
  }

  showToast('Rozpoczynanie pobierania CSV...', 'info');

  let url = `${API_BASE}${endpoint}`;
  if (state.authPassword && !url.includes('password=')) {
    const sep = url.includes('?') ? '&' : '?';
    url += `${sep}password=${encodeURIComponent(state.authPassword)}`;
  }

  // Direct anchor download without target=_blank (prevents popup blocker in Brave)
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  if (filename) a.setAttribute('download', filename);
  document.body.appendChild(a);
  a.click();

  setTimeout(() => {
    if (a.parentNode) a.parentNode.removeChild(a);
  }, 1000);
}

function exportTopUsersCSV() {
  const params = new URLSearchParams();
  if (state.startDate) params.append('start_date', state.startDate);
  if (state.endDate) params.append('end_date', state.endDate);
  if (state.hideStaff) params.append('hide_staff', 'true');
  if (state.authPassword) params.append('password', state.authPassword);

  const endpoint = `/export/top_users?${params.toString()}`;
  const filename = `top_chatters_${state.datePreset}_${state.channel || 'twitch'}.csv`;
  downloadCSV(endpoint, filename);
}

function exportUserMessagesCSV() {
  if (!state.selectedUser) {
    showToast('Wybierz lub wyszukaj widza, aby pobrać jego wiadomości!', 'warning');
    return;
  }
  const params = new URLSearchParams();
  if (state.startDate) params.append('start_date', state.startDate);
  if (state.endDate) params.append('end_date', state.endDate);
  if (state.authPassword) params.append('password', state.authPassword);

  const endpoint = `/export/user_messages/${encodeURIComponent(state.selectedUser)}?${params.toString()}`;
  const filename = `messages_${state.selectedUser}.csv`;
  downloadCSV(endpoint, filename);
}

// -------------------------------------------------------------
// AUTH MODAL & PASSWORD HANDLING
// -------------------------------------------------------------
function openAuthModal() {
  document.getElementById('input-auth-password').value = state.authPassword;
  document.getElementById('auth-modal').classList.add('active');
}

function closeAuthModal() {
  document.getElementById('auth-modal').classList.remove('active');
}

async function submitAuthPassword() {
  const pwd = document.getElementById('input-auth-password').value.trim();
  try {
    const res = await fetch(`${API_BASE}/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwd })
    });
    
    if (res.ok) {
      state.authPassword = pwd;
      localStorage.setItem('tm_auth_pwd', pwd);
      closeAuthModal();
      showToast("Pomyślnie zalogowano!", "success");
      refreshCurrentTab();
    } else {
      showToast("Nieprawidłowe hasło!", "error");
    }
  } catch (err) {
    showToast(`Błąd autoryzacji: ${err.message}`, "error");
  }
}

function clearAuthPassword() {
  state.authPassword = '';
  localStorage.removeItem('tm_auth_pwd');
  closeAuthModal();
  showToast("Wylogowano.", "info");
  refreshCurrentTab();
}

// Helpers
function formatDuration(minutes) {
  if (!minutes) return '-';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag] || tag));
}
