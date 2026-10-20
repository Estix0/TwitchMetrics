/**
 * TwitchStreamGames - Frontend Engine
 * Real-time Twitch Chat Quiz (Bulk Import & Hidden Votes), Giveaway Raffle & Hangman
 */

// ============================================================================
// APP & GAME STATE
// ============================================================================
const state = {
  activeGame: 'quiz', // 'quiz' | 'giveaway' | 'hangman' | 'leaderboard'
  isOverlay: new URLSearchParams(window.location.search).get('overlay') === '1',
  targetGame: new URLSearchParams(window.location.search).get('game') || 'quiz',
  channel: 'Streamer',
  authPassword: localStorage.getItem('tm_auth_pwd') || new URLSearchParams(window.location.search).get('password') || '',
  soundEnabled: localStorage.getItem('tm_games_sound') !== 'false',
  latestMsgId: 0,
  pollTimer: null,
  activeChatters: [],
  syncChannel: null,

  quiz: {
    questionList: [], // Custom questions imported by streamer
    currentIndex: 0,
    currentQuestion: null,
    state: 'idle', // 'idle' | 'active' | 'revealed'
    timerVal: 30,
    timerMax: 30,
    timerInterval: null,
    answers: new Map() // username -> { answer, timestamp, isCorrect }
  },

  giveaway: {
    keyword: localStorage.getItem('tm_giveaway_kw') || '!losowanie',
    prize: localStorage.getItem('tm_giveaway_prize') || '',
    isOpen: false,
    participants: new Set(),
    winner: null,
    history: [],
    isRolling: false
  },

  hangman: {
    word: 'WIEDŹMIN DZIKI GON',
    category: 'Gry Komputerowe',
    hint: 'Kultowy RPG od CD Projekt Red',
    revealedLetters: new Set(),
    wrongLetters: new Set(),
    livesLeft: 6,
    maxLives: 6,
    state: 'idle', // 'idle' | 'playing' | 'won' | 'lost'
    turnMode: 'chatter', // 'chatter' (Wybraniec) | 'all' (Czat Razem)
    activeChatter: null,
    activeChatterInfo: null,
    turnTimer: 45,
    turnInterval: null
  },

  leaderboard: new Map() // username -> { score, correctQuiz, correctLetters, lastActive }
};

const API_BASE = window.location.protocol === 'file:' ? 'http://localhost:8000/api' : '/api';

// ============================================================================
// AUDIO SYNTHESIZER (Web Audio API - Offline & Stream Safe)
// ============================================================================
let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) audioCtx = new AudioContextClass();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function playSuccessChime() {
  if (!state.soundEnabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    [523.25, 659.25, 783.99].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.08);
      gain.gain.setValueAtTime(0.18, now + idx * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.32);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.08);
      osc.stop(now + idx * 0.08 + 0.33);
    });
  } catch (e) {}
}

function playErrorBuzzer() {
  if (!state.soundEnabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.setValueAtTime(110, now + 0.15);
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.33);
  } catch (e) {}
}

function playTickSound(freq = 800) {
  if (!state.soundEnabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.06);
  } catch (e) {}
}

function playFanfare() {
  if (!state.soundEnabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    [392.00, 523.25, 659.25, 783.99, 1046.50].forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, now + i * 0.12);
      gain.gain.setValueAtTime(0.2, now + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.45);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.12);
      osc.stop(now + i * 0.12 + 0.48);
    });
  } catch (e) {}
}

function toggleAudio() {
  state.soundEnabled = !state.soundEnabled;
  localStorage.setItem('tm_games_sound', state.soundEnabled ? 'true' : 'false');
  const btn = document.getElementById('btn-audio-toggle');
  if (btn) {
    btn.innerText = state.soundEnabled ? '🔊' : '🔇';
    btn.title = state.soundEnabled ? 'Dźwięki (włączone)' : 'Dźwięki (wyłączone)';
  }
  showToast(state.soundEnabled ? 'Dźwięki włączone' : 'Dźwięki wyciszone', 'info');
}

// ============================================================================
// CANVAS CONFETTI (Celebration Generator)
// ============================================================================
let confettiParticles = [];
let confettiAnimationId = null;

function launchConfetti(durationMs = 4000) {
  const canvas = document.getElementById('confetti-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const colors = ['#9146FF', '#00E6CB', '#FF4F81', '#F5A623', '#10B981', '#ffffff'];
  confettiParticles = [];
  for (let i = 0; i < 90; i++) {
    confettiParticles.push({
      x: Math.random() * canvas.width,
      y: Math.random() * -canvas.height * 0.4,
      size: Math.random() * 8 + 6,
      color: colors[Math.floor(Math.random() * colors.length)],
      speedY: Math.random() * 4 + 3,
      speedX: Math.random() * 4 - 2,
      rotation: Math.random() * 360,
      rotSpeed: Math.random() * 8 - 4
    });
  }

  const startTime = Date.now();
  if (confettiAnimationId) cancelAnimationFrame(confettiAnimationId);

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    confettiParticles.forEach(p => {
      p.y += p.speedY;
      p.x += p.speedX;
      p.rotation += p.rotSpeed;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rotation * Math.PI) / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    });

    if (Date.now() - startTime < durationMs) {
      confettiAnimationId = requestAnimationFrame(animate);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      confettiParticles = [];
    }
  }

  animate();
}

// ============================================================================
// INITIALIZATION
// ============================================================================
window.addEventListener('DOMContentLoaded', async () => {
  // Setup BroadcastChannel for multi-tab sync
  if ('BroadcastChannel' in window) {
    state.syncChannel = new BroadcastChannel('twitch_games_sync');
    state.syncChannel.onmessage = (ev) => handleSyncMessage(ev.data);
  }

  // Load custom questions from localStorage
  loadSavedQuestions();

  // Load giveaway settings
  updateGiveawayUI();

  // Check Overlay Mode
  if (state.isOverlay) {
    document.body.classList.add('overlay-mode');
    switchGameMode(state.targetGame);
  } else {
    updateOBSUrls();
  }

  // Fetch status & message marker
  await fetchStatusInfo();
  await initLatestMsgId();

  // Render initial Quiz question if exists
  if (state.quiz.questionList.length > 0) {
    loadQuizQuestion(state.quiz.currentIndex);
  } else {
    renderQuizEmptyState();
  }

  // Render initial Hangman Word
  setupHangmanWord('WIEDŹMIN DZIKI GON', 'Gry Komputerowe', 'Kultowy RPG od CD Projekt Red');

  // Start background chat polling
  startChatPolling();
});

function handleSyncMessage(msg) {
  if (!msg || !msg.type) return;
  if (msg.type === 'QUIZ_UPDATE') {
    Object.assign(state.quiz, msg.payload);
    renderQuizUI();
  } else if (msg.type === 'GIVEAWAY_UPDATE') {
    Object.assign(state.giveaway, msg.payload);
    updateGiveawayUI();
  } else if (msg.type === 'HANGMAN_UPDATE') {
    Object.assign(state.hangman, msg.payload);
    renderHangmanUI();
  } else if (msg.type === 'SWITCH_MODE') {
    switchGameMode(msg.mode, false);
  }
}

function broadcastSync(type, payload) {
  if (state.syncChannel) {
    try {
      state.syncChannel.postMessage({ type, payload });
    } catch (e) {}
  }
}

async function fetchStatusInfo() {
  try {
    const res = await fetch(`${API_BASE}/status`);
    if (res.ok) {
      const data = await res.json();
      state.channel = data.channel || 'Streamer';
      const tag = document.getElementById('header-channel-tag');
      if (tag) tag.innerText = `@${state.channel}`;
    }
  } catch (e) {}
}

async function initLatestMsgId() {
  try {
    const res = await fetch(`${API_BASE}/games/latest-id`);
    if (res.ok) {
      const data = await res.json();
      state.latestMsgId = data.latest_id || 0;
    }
  } catch (e) {}
}

// ============================================================================
// NAVIGATION & TABS
// ============================================================================
function switchGameMode(mode, doBroadcast = true) {
  state.activeGame = mode;

  document.querySelectorAll('.game-tab-btn').forEach(btn => btn.classList.remove('active'));
  const activeBtn = document.getElementById(`tab-btn-${mode}`);
  if (activeBtn) activeBtn.classList.add('active');

  document.querySelectorAll('.game-view-content').forEach(view => view.classList.remove('active'));
  const activeView = document.getElementById(`view-${mode}`);
  if (activeView) activeView.classList.add('active');

  if (mode === 'hangman') {
    refreshActiveChattersList();
  } else if (mode === 'leaderboard') {
    renderGlobalLeaderboard();
  }

  if (doBroadcast) {
    broadcastSync('SWITCH_MODE', mode);
  }
}

// ============================================================================
// CHAT POLLING & REAL-TIME EVENT ENGINE
// ============================================================================
function startChatPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(async () => {
    try {
      const url = `${API_BASE}/games/recent-messages?since_id=${state.latestMsgId}&limit=100`;
      const res = await fetch(url);
      if (!res.ok) return;

      const data = await res.json();
      if (data.messages && data.messages.length > 0) {
        state.latestMsgId = data.max_id;
        for (const msg of data.messages) {
          processIncomingMessage(msg);
        }
      }
    } catch (e) {}
  }, 1000);
}

function processIncomingMessage(msg) {
  const user = (msg.username || '').toLowerCase().trim();
  const rawText = (msg.content || '').trim();
  if (!user || !rawText) return;

  // 1. Process for Active Quiz
  if (state.activeGame === 'quiz' && state.quiz.state === 'active') {
    handleQuizMessage(user, rawText);
  }

  // 2. Process for Active Giveaway / Losowanie
  if (state.giveaway.isOpen) {
    handleGiveawayMessage(user, rawText);
  }

  // 3. Process for Active Hangman
  if (state.activeGame === 'hangman' && state.hangman.state === 'playing') {
    handleHangmanMessage(user, rawText);
  }
}

// ============================================================================
// QUIZ ENGINE (Własne pytania, ukryte procenty i głosy)
// ============================================================================
function loadSavedQuestions() {
  const saved = localStorage.getItem('tm_quiz_questions');
  if (saved) {
    try {
      state.quiz.questionList = JSON.parse(saved);
    } catch (e) {
      state.quiz.questionList = [];
    }
  } else {
    state.quiz.questionList = [];
  }
  updateQuestionManagerUI();
}

function saveQuestions() {
  localStorage.setItem('tm_quiz_questions', JSON.stringify(state.quiz.questionList));
  updateQuestionManagerUI();
}

function loadQuizQuestion(index) {
  if (!state.quiz.questionList || state.quiz.questionList.length === 0) {
    renderQuizEmptyState();
    return;
  }

  state.quiz.currentIndex = Math.max(0, Math.min(index, state.quiz.questionList.length - 1));
  const q = state.quiz.questionList[state.quiz.currentIndex];
  state.quiz.currentQuestion = q;
  state.quiz.state = 'idle';
  state.quiz.answers.clear();

  // Reset UI
  const optionsGrid = document.getElementById('quiz-options-container');
  if (optionsGrid) optionsGrid.classList.remove('voting-active');

  const podium = document.getElementById('quiz-round-podium');
  if (podium) podium.style.display = 'none';

  const log = document.getElementById('quiz-live-log');
  if (log) log.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 1rem;">Rozpocznij rundę, aby zbierać głosy z czatu.</div>';

  renderQuizUI();
  broadcastSync('QUIZ_UPDATE', state.quiz);
}

function renderQuizEmptyState() {
  document.getElementById('quiz-index-indicator').innerText = '0 / 0';
  document.getElementById('quiz-votes-counter').innerText = '0';
  document.getElementById('quiz-question-display').innerText = 'Brak pytań. Kliknij poniżej "Importuj Pytania (Wklej tekst)", aby dodać swój quiz!';
  
  ['A', 'B', 'C', 'D'].forEach(k => {
    const textEl = document.getElementById(`opt-text-${k}`);
    if (textEl) textEl.innerText = '-';
  });

  const btnStart = document.getElementById('btn-quiz-start');
  if (btnStart) btnStart.disabled = true;
}

function stepQuizQuestion(dir) {
  if (!state.quiz.questionList || state.quiz.questionList.length === 0) return;
  const nextIdx = state.quiz.currentIndex + dir;
  if (nextIdx >= 0 && nextIdx < state.quiz.questionList.length) {
    loadQuizQuestion(nextIdx);
  } else {
    showToast(dir > 0 ? 'To było ostatnie pytanie w bazie!' : 'To jest pierwsze pytanie!', 'info');
  }
}

function startQuizRound() {
  if (!state.quiz.currentQuestion) {
    showToast('Najpierw zaimportuj pytania!', 'warning');
    return;
  }

  state.quiz.state = 'active';
  state.quiz.answers.clear();

  const timeSelect = document.getElementById('select-quiz-time');
  const duration = parseInt(timeSelect ? timeSelect.value : '30', 10);
  state.quiz.timerMax = duration;
  state.quiz.timerVal = duration;

  // CRITICAL: Hide voting percentages & breakdown while voting is active!
  const optionsGrid = document.getElementById('quiz-options-container');
  if (optionsGrid) optionsGrid.classList.add('voting-active');

  const podium = document.getElementById('quiz-round-podium');
  if (podium) podium.style.display = 'none';

  const log = document.getElementById('quiz-live-log');
  if (log) log.innerHTML = '';

  document.getElementById('quiz-votes-counter').innerText = '0';
  document.getElementById('btn-quiz-start').disabled = true;
  document.getElementById('btn-quiz-reveal').disabled = false;

  renderQuizUI();
  broadcastSync('QUIZ_UPDATE', state.quiz);

  playSuccessChime();
  showToast('Głosowanie aktywne! Widzowie odpowiadają wpisując A, B, C lub D (wyniki są ukryte do końca rundy).', 'success');

  if (state.quiz.timerInterval) clearInterval(state.quiz.timerInterval);
  if (duration > 0) {
    state.quiz.timerInterval = setInterval(() => {
      state.quiz.timerVal--;
      if (state.quiz.timerVal <= 5 && state.quiz.timerVal > 0) playTickSound();
      updateQuizTimerUI();
      if (state.quiz.timerVal <= 0) {
        clearInterval(state.quiz.timerInterval);
        revealQuizAnswer();
      }
    }, 1000);
  }
}

function handleQuizMessage(username, text) {
  // Only first answer per chatter counts!
  if (state.quiz.answers.has(username)) return;

  const clean = text.toUpperCase().replace(/[^A-D]/g, '');
  let chosenKey = null;

  if (clean.length > 0 && ['A', 'B', 'C', 'D'].includes(clean[0])) {
    chosenKey = clean[0];
  }

  if (!chosenKey) return;

  const q = state.quiz.currentQuestion;
  const isCorrect = chosenKey === q.correctAnswer;
  state.quiz.answers.set(username, {
    answer: chosenKey,
    timestamp: Date.now(),
    isCorrect
  });

  // Update total vote counter
  const counter = document.getElementById('quiz-votes-counter');
  if (counter) counter.innerText = state.quiz.answers.size;

  // Add to live incoming feed WITHOUT revealing which letter they chose!
  const log = document.getElementById('quiz-live-log');
  if (log) {
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.innerHTML = `<span><strong>@${username}</strong> oddał(a) głos</span><span style="color: var(--accent-emerald); font-weight: 700;">✅</span>`;
    log.prepend(entry);
    if (log.children.length > 30) log.lastElementChild.remove();
  }

  playTickSound(900);
}

function revealQuizAnswer() {
  if (state.quiz.timerInterval) clearInterval(state.quiz.timerInterval);
  state.quiz.state = 'revealed';

  // REVEAL: Remove voting-active class so percentages & counts animate into view!
  const optionsGrid = document.getElementById('quiz-options-container');
  if (optionsGrid) optionsGrid.classList.remove('voting-active');

  const q = state.quiz.currentQuestion;
  const correctKey = q ? q.correctAnswer : 'A';

  document.querySelectorAll('.option-card').forEach(card => {
    const k = card.getAttribute('data-key');
    if (k === correctKey) {
      card.classList.add('correct');
      card.classList.remove('wrong');
    } else {
      card.classList.add('wrong');
      card.classList.remove('correct');
    }
  });

  // Calculate vote percentages
  const counts = { A: 0, B: 0, C: 0, D: 0 };
  const correctChatters = [];

  state.quiz.answers.forEach((val, user) => {
    if (counts[val.answer] !== undefined) counts[val.answer]++;
    if (val.isCorrect) correctChatters.push({ user, timestamp: val.timestamp });
  });

  const total = state.quiz.answers.size;
  ['A', 'B', 'C', 'D'].forEach(key => {
    const countEl = document.getElementById(`opt-count-${key}`);
    const progEl = document.getElementById(`opt-prog-${key}`);
    const c = counts[key] || 0;
    const pct = total > 0 ? Math.round((c / total) * 100) : 0;
    if (countEl) countEl.innerText = `${c} odp. (${pct}%)`;
    if (progEl) progEl.style.width = `${pct}%`;
  });

  // Sort correct chatters by speed
  correctChatters.sort((a, b) => a.timestamp - b.timestamp);

  // Award Leaderboard Points
  correctChatters.forEach((item, idx) => {
    const bonus = idx === 0 ? 50 : (idx === 1 ? 30 : (idx === 2 ? 15 : 0));
    addPointsToUser(item.user, 100 + bonus, true, false);
  });

  // Reveal Podium
  const podiumCard = document.getElementById('quiz-round-podium');
  const podiumLetter = document.getElementById('podium-correct-letter');
  const podiumSub = document.getElementById('podium-stats-sub');
  const podiumList = document.getElementById('podium-list');

  if (podiumCard && podiumList) {
    podiumCard.style.display = 'block';
    if (podiumLetter) podiumLetter.innerText = correctKey;
    if (podiumSub) podiumSub.innerText = `${correctChatters.length} poprawnych odpowiedzi (na ${total} głosujących)`;

    podiumList.innerHTML = correctChatters.slice(0, 5).map((c, i) => `
      <div style="background: rgba(0,0,0,0.35); padding: 0.4rem 0.85rem; border-radius: var(--radius-md); border: 1px solid rgba(16,185,129,0.3); font-size: 0.85rem; display: flex; align-items: center; gap: 0.4rem;">
        <span>${i === 0 ? '🥇' : (i === 1 ? '🥈' : (i === 2 ? '🥉' : '🎖️'))}</span>
        <strong>@${c.user}</strong>
        <span style="color: var(--accent-emerald); font-weight: 700;">+${100 + (i === 0 ? 50 : (i === 1 ? 30 : (i === 2 ? 15 : 0)))} pkt</span>
      </div>
    `).join('') || '<div style="color: var(--text-muted); font-size: 0.85rem;">Nikt nie odpowiedział poprawnie w tej rundzie!</div>';
  }

  document.getElementById('btn-quiz-start').disabled = false;
  document.getElementById('btn-quiz-reveal').disabled = true;

  playFanfare();
  launchConfetti(3500);
  broadcastSync('QUIZ_UPDATE', state.quiz);
}

function renderQuizUI() {
  const q = state.quiz.currentQuestion;
  if (!q) {
    renderQuizEmptyState();
    return;
  }

  const indicator = document.getElementById('quiz-index-indicator');
  if (indicator) indicator.innerText = `${state.quiz.currentIndex + 1} / ${state.quiz.questionList.length}`;

  const qText = document.getElementById('quiz-question-display');
  if (qText) qText.innerText = q.question;

  q.options.forEach(opt => {
    const textEl = document.getElementById(`opt-text-${opt.key}`);
    if (textEl) textEl.innerText = opt.text;
  });

  document.getElementById('btn-quiz-start').disabled = false;
  document.getElementById('btn-quiz-reveal').disabled = true;
  document.getElementById('quiz-votes-counter').innerText = state.quiz.answers.size;

  updateQuizTimerUI();
}

function updateQuizTimerUI() {
  const sec = document.getElementById('quiz-timer-sec');
  const fill = document.getElementById('quiz-timer-fill');
  const badge = document.getElementById('quiz-timer-badge');

  if (sec) sec.innerText = state.quiz.timerVal;
  if (fill && state.quiz.timerMax > 0) {
    const pct = Math.max(0, (state.quiz.timerVal / state.quiz.timerMax) * 100);
    fill.style.width = `${pct}%`;
    fill.style.background = pct < 25 ? 'var(--accent-red)' : (pct < 50 ? 'var(--accent-amber)' : 'linear-gradient(90deg, var(--twitch-purple), var(--accent-cyan))');
  }

  if (badge) {
    if (state.quiz.timerVal <= 5 && state.quiz.timerVal > 0) badge.classList.add('danger');
    else badge.classList.remove('danger');
  }
}

// -------------------------------------------------------------
// BULK IMPORT PARSER (Multi-line / Pipe / Semicolon / CSV)
// -------------------------------------------------------------
function openBulkImportModal() {
  document.getElementById('modal-bulk-import').classList.add('active');
}

function insertExampleQuestions() {
  const example = 
`W którym roku wydano grę Wiedźmin 3: Dziki Gon? | 2013 | 2014 | 2015 | 2016 | C
Jak nazywa się główna postać w GTA: San Andreas? | Tommy Vercetti | CJ (Carl Johnson) | Franklin | Niko Bellic | B
Jaka emotka na Twitchu oznacza sarkazm? | Kappa | PogChamp | LUL | KEKW | A
Z ilu graczy składa się drużyna na Summoner's Rift w LoL? | 3 | 4 | 5 | 6 | C
Jaka jest stolica Australii? | Sydney | Melbourne | Canberra | Brisbane | C`;
  
  document.getElementById('textarea-bulk-import').value = example;
}

function processBulkImport() {
  const text = document.getElementById('textarea-bulk-import').value.trim();
  if (!text) {
    showToast('Wklej pytania w pole tekstowe!', 'error');
    return;
  }

  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const parsed = [];

  for (let line of lines) {
    // 1. Check for separator: pipe (|) or semicolon (;)
    const sep = line.includes('|') ? '|' : (line.includes(';') ? ';' : null);
    if (sep) {
      const parts = line.split(sep).map(p => p.trim());
      if (parts.length >= 6) {
        const [q, a, b, c, d, correct] = parts;
        parsed.push({
          question: q,
          options: [
            { key: 'A', text: a },
            { key: 'B', text: b },
            { key: 'C', text: c },
            { key: 'D', text: d }
          ],
          correctAnswer: correct.toUpperCase().replace(/[^A-D]/g, '') || 'A'
        });
      }
    }
  }

  if (parsed.length === 0) {
    showToast('Nie rozpoznano formatu! Użyj formatu: Pytanie | Opcja A | Opcja B | Opcja C | Opcja D | Poprawna', 'error');
    return;
  }

  state.quiz.questionList = parsed;
  saveQuestions();
  closeModal('modal-bulk-import');
  loadQuizQuestion(0);
  showToast(`Pomyślnie zaimportowano ${parsed.length} pytań!`, 'success');
}

function openQuestionManagerModal() {
  updateQuestionManagerUI();
  document.getElementById('modal-question-manager').classList.add('active');
}

function updateQuestionManagerUI() {
  const totalCountEl = document.getElementById('qm-total-count');
  const btnCount = document.getElementById('btn-count-loaded-q');
  const container = document.getElementById('qm-items-container');
  const quickList = document.getElementById('quick-question-list');

  const count = state.quiz.questionList.length;
  if (totalCountEl) totalCountEl.innerText = count;
  if (btnCount) btnCount.innerText = count;

  if (container) {
    if (count === 0) {
      container.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 2rem;">Brak pytań w bazie. Kliknij poniżej "Wklej Nowe Pytania".</div>';
    } else {
      container.innerHTML = state.quiz.questionList.map((q, idx) => `
        <div class="qm-item ${idx === state.quiz.currentIndex ? 'active' : ''}">
          <div style="flex: 1;">
            <div style="font-weight: 700; color: #fff; margin-bottom: 0.25rem;">
              ${idx + 1}. ${q.question}
            </div>
            <div style="font-size: 0.8rem; color: var(--text-secondary); display: flex; gap: 0.75rem;">
              <span>A: ${q.options[0].text}</span>
              <span>B: ${q.options[1].text}</span>
              <span>C: ${q.options[2].text}</span>
              <span>D: ${q.options[3].text}</span>
              <span style="color: var(--accent-emerald); font-weight: 700;">Poprawna: ${q.correctAnswer}</span>
            </div>
          </div>
          <div style="display: flex; gap: 0.5rem;">
            <button class="btn btn-secondary btn-icon" onclick="jumpToQuizQuestion(${idx})" title="Załaduj na planszę">▶</button>
            <button class="btn btn-danger btn-icon" onclick="deleteQuizQuestion(${idx})" title="Usuń pytanie">🗑️</button>
          </div>
        </div>
      `).join('');
    }
  }

  // Sidebar Quick List
  if (quickList) {
    if (count === 0) {
      quickList.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 1rem; font-size: 0.85rem;">Brak pytań. Kliknij "Importuj Pytania" powyżej.</div>';
    } else {
      quickList.innerHTML = state.quiz.questionList.map((q, idx) => `
        <div class="leader-item ${idx === state.quiz.currentIndex ? 'rank-1' : ''}" style="cursor: pointer;" onclick="jumpToQuizQuestion(${idx})">
          <div class="leader-left">
            <span class="rank-badge">${idx + 1}</span>
            <span class="leader-name" style="font-size: 0.825rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 220px;">
              ${q.question}
            </span>
          </div>
        </div>
      `).join('');
    }
  }
}

function jumpToQuizQuestion(index) {
  closeModal('modal-question-manager');
  loadQuizQuestion(index);
}

function deleteQuizQuestion(index) {
  state.quiz.questionList.splice(index, 1);
  saveQuestions();
  if (state.quiz.currentIndex >= state.quiz.questionList.length) {
    state.quiz.currentIndex = Math.max(0, state.quiz.questionList.length - 1);
  }
  loadQuizQuestion(state.quiz.currentIndex);
  showToast('Usunięto pytanie.', 'info');
}

function clearAllQuestions() {
  if (confirm("Czy na pewno chcesz usunąć wszystkie załadowane pytania?")) {
    state.quiz.questionList = [];
    saveQuestions();
    renderQuizEmptyState();
    closeModal('modal-question-manager');
    showToast("Wyczyszczono bazę pytań.", "info");
  }
}

// ============================================================================
// MODULE 2: GIVEAWAY / LOSOWANIE (Słowo kluczowe & Losowanie usera)
// ============================================================================
function openGiveawaySettingsModal() {
  document.getElementById('input-giveaway-keyword').value = state.giveaway.keyword;
  document.getElementById('input-giveaway-prize').value = state.giveaway.prize;
  document.getElementById('modal-giveaway-settings').classList.add('active');
}

function saveGiveawaySettings() {
  const kw = document.getElementById('input-giveaway-keyword').value.trim() || '!losowanie';
  const prize = document.getElementById('input-giveaway-prize').value.trim();

  state.giveaway.keyword = kw;
  state.giveaway.prize = prize;
  localStorage.setItem('tm_giveaway_kw', kw);
  localStorage.setItem('tm_giveaway_prize', prize);

  closeModal('modal-giveaway-settings');
  updateGiveawayUI();
  broadcastSync('GIVEAWAY_UPDATE', state.giveaway);
  showToast(`Ustawiono słowo kluczowe: "${kw}"`, 'success');
}

function startGiveawayRegistration() {
  state.giveaway.isOpen = true;
  updateGiveawayUI();
  playSuccessChime();
  showToast(`Zapisy OTWARTE! Czat wpisuje "${state.giveaway.keyword}", aby wziąć udział.`, 'success');
  broadcastSync('GIVEAWAY_UPDATE', state.giveaway);
}

function closeGiveawayRegistration() {
  state.giveaway.isOpen = false;
  updateGiveawayUI();
  playErrorBuzzer();
  showToast(`Zapisy ZAMKNIĘTE. Zapisano ${state.giveaway.participants.size} uczestników.`, 'info');
  broadcastSync('GIVEAWAY_UPDATE', state.giveaway);
}

function handleGiveawayMessage(username, text) {
  if (!state.giveaway.isOpen) return;

  const targetKw = state.giveaway.keyword.toLowerCase();
  const msgLower = text.toLowerCase();

  // If message equals or starts with the keyword
  if (msgLower === targetKw || msgLower.startsWith(targetKw + ' ') || msgLower.endsWith(' ' + targetKw)) {
    if (!state.giveaway.participants.has(username)) {
      state.giveaway.participants.add(username);
      updateGiveawayParticipantsUI();
      playTickSound(1000);
    }
  }
}

function updateGiveawayUI() {
  const kwBadge = document.getElementById('giveaway-keyword-badge');
  const pill = document.getElementById('giveaway-status-pill');
  const btnOpen = document.getElementById('btn-giveaway-open');
  const btnClose = document.getElementById('btn-giveaway-close');

  if (kwBadge) kwBadge.innerText = state.giveaway.keyword;

  if (pill) {
    if (state.giveaway.isOpen) {
      pill.className = 'giveaway-status-badge open';
      pill.innerText = '🟢 Zapisy Otwarte (Czat Dołącza)';
    } else {
      pill.className = 'giveaway-status-badge closed';
      pill.innerText = '🔴 Zapisy Zamknięte';
    }
  }

  if (btnOpen) btnOpen.disabled = state.giveaway.isOpen;
  if (btnClose) btnClose.disabled = !state.giveaway.isOpen;

  updateGiveawayParticipantsUI();
}

function updateGiveawayParticipantsUI() {
  const countDisplay = document.getElementById('giveaway-participants-count');
  const sidebarCount = document.getElementById('sidebar-giveaway-count');
  const listEl = document.getElementById('giveaway-participants-list');

  const count = state.giveaway.participants.size;
  if (countDisplay) countDisplay.innerText = count;
  if (sidebarCount) sidebarCount.innerText = count;

  if (listEl) {
    if (count === 0) {
      listEl.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 1.5rem; font-size: 0.85rem;">Brak zapisanych uczestników.</div>';
    } else {
      listEl.innerHTML = Array.from(state.giveaway.participants).map((u, i) => `
        <div class="leader-item">
          <div class="leader-left">
            <span class="rank-badge">${i + 1}</span>
            <span class="leader-name">@${u}</span>
          </div>
          <span style="font-size: 0.75rem; color: var(--accent-emerald);">Zapisany ✓</span>
        </div>
      `).join('');
    }
  }
}

function rollGiveawayWinner() {
  const entrants = Array.from(state.giveaway.participants);
  if (entrants.length === 0) {
    showToast('Brak uczestników do losowania! Otwórz najpierw zapisy.', 'warning');
    return;
  }

  // Close registration automatically before drawing
  state.giveaway.isOpen = false;
  state.giveaway.isRolling = true;
  updateGiveawayUI();

  const spinnerBox = document.getElementById('giveaway-spinner-container');
  const spinnerText = document.getElementById('giveaway-spinner-text');
  const idleHint = document.getElementById('giveaway-idle-hint');
  const winnerCard = document.getElementById('giveaway-winner-card');

  if (idleHint) idleHint.style.display = 'none';
  if (winnerCard) winnerCard.style.display = 'none';
  if (spinnerText) spinnerText.style.display = 'block';
  if (spinnerBox) spinnerBox.classList.add('rolling');

  // Animated Roulette Spinner with decelerating interval
  let speed = 50;
  let elapsed = 0;
  const totalDuration = 3200; // 3.2 seconds roll

  function spinStep() {
    const randomPick = entrants[Math.floor(Math.random() * entrants.length)];
    if (spinnerText) spinnerText.innerText = `@${randomPick}`;
    playTickSound(700 + Math.random() * 400);

    elapsed += speed;
    speed += 15; // Deceleration curve

    if (elapsed < totalDuration) {
      setTimeout(spinStep, speed);
    } else {
      // Pick Final Winner!
      const finalWinner = entrants[Math.floor(Math.random() * entrants.length)];
      finishGiveawayRoll(finalWinner);
    }
  }

  spinStep();
}

function finishGiveawayRoll(winner) {
  state.giveaway.isRolling = false;
  state.giveaway.winner = winner;

  const spinnerBox = document.getElementById('giveaway-spinner-container');
  const spinnerText = document.getElementById('giveaway-spinner-text');
  const winnerCard = document.getElementById('giveaway-winner-card');
  const winnerName = document.getElementById('giveaway-winner-name');
  const winnerDetails = document.getElementById('giveaway-winner-details');

  if (spinnerBox) spinnerBox.classList.remove('rolling');
  if (spinnerText) spinnerText.style.display = 'none';

  if (winnerCard && winnerName) {
    winnerCard.style.display = 'flex';
    winnerName.innerText = `@${winner}`;
    if (winnerDetails) {
      const prizeText = state.giveaway.prize ? `Nagroda: ${state.giveaway.prize} • ` : '';
      winnerDetails.innerText = `${prizeText}Wyłoniono spośród ${state.giveaway.participants.size} uczestników`;
    }
  }

  // Add to session history
  state.giveaway.history.unshift({
    winner,
    time: new Date().toLocaleTimeString(),
    entrants: state.giveaway.participants.size
  });
  updateGiveawayHistoryUI();

  playFanfare();
  launchConfetti(4500);
  showToast(`🎉 ZWYCIĘZCA: @${winner}! Gratulacje!`, 'success');
  broadcastSync('GIVEAWAY_UPDATE', state.giveaway);
}

function updateGiveawayHistoryUI() {
  const container = document.getElementById('giveaway-history-list');
  if (!container) return;

  if (state.giveaway.history.length === 0) {
    container.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 1rem; font-size: 0.85rem;">Brak wcześniejszych losowań.</div>';
    return;
  }

  container.innerHTML = state.giveaway.history.map(h => `
    <div class="leader-item rank-1">
      <div class="leader-left">
        <span style="font-size: 1.1rem;">👑</span>
        <span class="leader-name">@${h.winner}</span>
      </div>
      <span style="font-size: 0.75rem; color: var(--text-muted);">${h.time} (${h.entrants} os.)</span>
    </div>
  `).join('');
}

function clearGiveawayParticipants() {
  if (confirm("Czy na pewno chcesz wyczyścić listę zapisanych osób?")) {
    state.giveaway.participants.clear();
    state.giveaway.winner = null;

    const winnerCard = document.getElementById('giveaway-winner-card');
    const idleHint = document.getElementById('giveaway-idle-hint');
    if (winnerCard) winnerCard.style.display = 'none';
    if (idleHint) idleHint.style.display = 'block';

    updateGiveawayUI();
    showToast("Wyczyszczono listę uczestników losowania.", "info");
    broadcastSync('GIVEAWAY_UPDATE', state.giveaway);
  }
}

// ============================================================================
// MODULE 3: WISIELEC / ZGADYWANKA ("WYBRANIEC CZATU")
// ============================================================================
function setupHangmanWord(word, category = 'Gry Komputerowe', hint = '') {
  state.hangman.word = word.toUpperCase().trim();
  state.hangman.category = category;
  state.hangman.hint = hint;
  state.hangman.revealedLetters.clear();
  state.hangman.wrongLetters.clear();
  state.hangman.livesLeft = state.hangman.maxLives;
  state.hangman.state = 'playing';

  for (const ch of state.hangman.word) {
    if (!ch.match(/[A-ZĄĆĘŁŃÓŚŹŻ]/i)) {
      state.hangman.revealedLetters.add(ch);
    }
  }

  renderHangmanUI();
  broadcastSync('HANGMAN_UPDATE', state.hangman);
  showToast(`Rozpoczęto hasło: ${category}`, 'info');

  if (state.hangman.turnMode === 'chatter') {
    rollActiveChatter();
  }
}

function renderHangmanUI() {
  const catDisplay = document.getElementById('hangman-category-display');
  const hintDisplay = document.getElementById('hangman-hint-display');
  if (catDisplay) catDisplay.innerText = state.hangman.category;
  if (hintDisplay) hintDisplay.innerText = state.hangman.hint ? `💡 Podpowiedź: ${state.hangman.hint}` : '';

  for (let i = 1; i <= state.hangman.maxLives; i++) {
    const heart = document.getElementById(`heart-${i}`);
    if (heart) {
      if (i <= state.hangman.livesLeft) {
        heart.classList.remove('lost');
        heart.innerText = '❤️';
      } else {
        heart.classList.add('lost');
        heart.innerText = '💔';
      }
    }
  }

  const livesNum = document.getElementById('hangman-lives-num');
  if (livesNum) livesNum.innerText = `${state.hangman.livesLeft}/${state.hangman.maxLives}`;

  const board = document.getElementById('hangman-board');
  if (board) {
    board.innerHTML = '';
    const words = state.hangman.word.split(' ');

    words.forEach((w, wIdx) => {
      const segment = document.createElement('div');
      segment.className = 'word-segment';

      for (let i = 0; i < w.length; i++) {
        const char = w[i];
        const isRevealed = state.hangman.revealedLetters.has(char);
        const tile = document.createElement('div');
        tile.className = `letter-tile ${isRevealed ? 'revealed' : ''}`;
        tile.innerText = isRevealed ? char : '';
        segment.appendChild(tile);
      }

      board.appendChild(segment);

      if (wIdx < words.length - 1) {
        const spaceTile = document.createElement('div');
        spaceTile.className = 'letter-tile space';
        board.appendChild(spaceTile);
      }
    });
  }

  const wrongContainer = document.getElementById('wrong-letters-chips');
  if (wrongContainer) {
    if (state.hangman.wrongLetters.size === 0) {
      wrongContainer.innerHTML = '<span style="font-size: 0.8rem; color: var(--text-muted); font-style: italic;">Brak</span>';
    } else {
      wrongContainer.innerHTML = Array.from(state.hangman.wrongLetters).map(ch => `
        <span class="wrong-letter-chip">${ch}</span>
      `).join('');
    }
  }
}

async function refreshActiveChattersList() {
  try {
    const res = await fetch(`${API_BASE}/games/active-chatters?minutes=2`);
    if (res.ok) {
      const data = await res.json();
      state.activeChatters = data.active_chatters || [];
      renderActiveChattersSidebar(data.is_fallback);
    }
  } catch (e) {}
}

function renderActiveChattersSidebar(isFallback = false) {
  const container = document.getElementById('active-chatters-pool');
  if (!container) return;

  if (state.activeChatters.length === 0) {
    container.innerHTML = '<div style="color: var(--text-muted); font-size: 0.85rem; padding: 0.75rem; text-align: center;">Brak aktywnych wiadomości w ostatnich minutach.</div>';
    return;
  }

  const note = isFallback ? '<div style="font-size: 0.75rem; color: var(--accent-amber); padding: 0.35rem; margin-bottom: 0.4rem;">⚠️ Tryb offline: Ostatni czatujący w bazie</div>' : '';

  container.innerHTML = note + state.activeChatters.map(c => `
    <div class="leader-item" style="cursor: pointer;" onclick="assignTurnToChatter('${c.username}')" title="Kliknij, aby przekazać turę">
      <div class="leader-left">
        <span class="rank-badge" style="background: rgba(145, 70, 255, 0.2); color: var(--twitch-purple-light);">💬</span>
        <span class="leader-name">@${c.username}</span>
      </div>
      <span class="leader-score" style="font-size: 0.75rem; color: var(--text-muted);">${c.msg_count} wiad.</span>
    </div>
  `).join('');
}

async function rollActiveChatter() {
  try {
    const res = await fetch(`${API_BASE}/games/active-chatters?minutes=2`);
    if (!res.ok) throw new Error("Błąd pobierania");
    const data = await res.json();
    state.activeChatters = data.active_chatters || [];

    let chosen = data.random_pick;
    if (!chosen && state.activeChatters.length > 0) {
      chosen = state.activeChatters[0].username;
    }

    if (!chosen) {
      showToast('Brak aktywnych osób w ostatnich 1-2 minutach! Przełączam w tryb otwarty.', 'warning');
      state.hangman.turnMode = 'all';
      updateTurnModeUI();
      return;
    }

    assignTurnToChatter(chosen);
  } catch (err) {
    showToast(`Nie udało się wylosować widza: ${err.message}`, 'error');
  }
}

function assignTurnToChatter(username) {
  state.hangman.activeChatter = username.toLowerCase();
  const info = state.activeChatters.find(c => c.username.toLowerCase() === username.toLowerCase());
  state.hangman.activeChatterInfo = info;

  const avatar = document.getElementById('chatter-avatar-initial');
  const nameDisplay = document.getElementById('chatter-name-display');
  const subHint = document.getElementById('chatter-sub-hint');

  if (avatar) avatar.innerText = username.charAt(0).toUpperCase();
  if (nameDisplay) nameDisplay.innerText = `@${username}`;
  if (subHint) {
    const msgCount = info ? `${info.msg_count} wiadomości w ostatnich minutach` : 'Aktywny widz';
    subHint.innerText = `${msgCount} • Wpisz literkę lub całe hasło na czacie!`;
  }

  state.hangman.turnTimer = 45;
  const timerCircle = document.getElementById('chatter-turn-timer');
  if (timerCircle) timerCircle.innerText = '45';

  if (state.hangman.turnInterval) clearInterval(state.hangman.turnInterval);
  state.hangman.turnInterval = setInterval(() => {
    state.hangman.turnTimer--;
    if (timerCircle) timerCircle.innerText = state.hangman.turnTimer;
    if (state.hangman.turnTimer <= 0) {
      clearInterval(state.hangman.turnInterval);
      showToast(`Czas gracza @${username} minął! Losuję kolejną osobę.`, 'warning');
      playErrorBuzzer();
      rollActiveChatter();
    }
  }, 1000);

  playSuccessChime();
  showToast(`🎲 Tura gracza: @${username}! Czekam na literkę na czacie...`, 'info');
  broadcastSync('HANGMAN_UPDATE', state.hangman);
}

function skipActiveChatter() {
  if (state.hangman.turnInterval) clearInterval(state.hangman.turnInterval);
  showToast('Pominięto gracza (AFK). Losuję następnego...', 'info');
  rollActiveChatter();
}

function toggleTurnMode() {
  state.hangman.turnMode = state.hangman.turnMode === 'chatter' ? 'all' : 'chatter';
  updateTurnModeUI();
  showToast(`Zmieniono tryb na: ${state.hangman.turnMode === 'chatter' ? 'Wybraniec Czatu' : 'Czat Zgaduje Razem'}`, 'info');
  broadcastSync('HANGMAN_UPDATE', state.hangman);
}

function updateTurnModeUI() {
  const btn = document.getElementById('btn-turn-mode-toggle');
  const banner = document.getElementById('hangman-chatter-banner');

  if (state.hangman.turnMode === 'chatter') {
    if (btn) btn.innerText = '👤 Tryb: Wybraniec';
    if (banner) banner.style.display = 'flex';
  } else {
    if (btn) btn.innerText = '👥 Tryb: Czat Razem';
    if (banner) banner.style.display = 'none';
  }
}

function handleHangmanMessage(username, text) {
  if (state.hangman.turnMode === 'chatter') {
    if (!state.hangman.activeChatter || username.toLowerCase() !== state.hangman.activeChatter) {
      return;
    }
  }

  const clean = text.toUpperCase().trim();
  if (!clean) return;

  const targetNormalized = state.hangman.word.replace(/\s+/g, ' ');
  if (clean === targetNormalized || clean.replace(/\s+/g, '') === targetNormalized.replace(/\s+/g, '')) {
    for (const ch of state.hangman.word) state.hangman.revealedLetters.add(ch);
    renderHangmanUI();
    addPointsToUser(username, 500, false, true);

    playFanfare();
    launchConfetti(4500);
    showToast(`🎉 NIESAMOWITE! @${username} odgadł(a) całe hasło: "${state.hangman.word}"! (+500 pkt)`, 'success');
    state.hangman.state = 'won';
    broadcastSync('HANGMAN_UPDATE', state.hangman);
    return;
  }

  const letters = clean.match(/[A-ZĄĆĘŁŃÓŚŹŻ]/gi);
  if (!letters || letters.length === 0) return;
  const guess = letters[0].toUpperCase();

  if (state.hangman.revealedLetters.has(guess) || state.hangman.wrongLetters.has(guess)) {
    return;
  }

  if (state.hangman.word.includes(guess)) {
    state.hangman.revealedLetters.add(guess);
    addPointsToUser(username, 100, false, true);
    playSuccessChime();
    showToast(`✅ Trafienie! @${username} odsłonił(a) literę "${guess}"! (+100 pkt)`, 'success');

    renderHangmanUI();

    let allRevealed = true;
    for (const ch of state.hangman.word) {
      if (!state.hangman.revealedLetters.has(ch)) {
        allRevealed = false;
        break;
      }
    }

    if (allRevealed) {
      state.hangman.state = 'won';
      playFanfare();
      launchConfetti(4500);
      showToast(`🏆 Brawo! Całe hasło zostało odgadnięte: "${state.hangman.word}"!`, 'success');
    }
  } else {
    state.hangman.wrongLetters.add(guess);
    state.hangman.livesLeft = Math.max(0, state.hangman.livesLeft - 1);
    playErrorBuzzer();
    showToast(`❌ Pudło! Litery "${guess}" nie ma w haśle! (-1 życie)`, 'error');

    renderHangmanUI();

    if (state.hangman.livesLeft <= 0) {
      state.hangman.state = 'lost';
      revealHangmanWord();
      showToast(`💀 Koniec szans! Prawidłowe hasło to: "${state.hangman.word}"`, 'error');
    } else {
      if (state.hangman.turnMode === 'chatter') {
        setTimeout(() => rollActiveChatter(), 1200);
      }
    }
  }

  broadcastSync('HANGMAN_UPDATE', state.hangman);
}

function revealHangmanWord() {
  for (const ch of state.hangman.word) state.hangman.revealedLetters.add(ch);
  renderHangmanUI();
  broadcastSync('HANGMAN_UPDATE', state.hangman);
  showToast(`Odsłonięto hasło: ${state.hangman.word}`, 'info');
}

function openCustomWordModal() {
  document.getElementById('modal-custom-word').classList.add('active');
}

function applyCustomWord() {
  const word = document.getElementById('input-custom-word').value.trim();
  const cat = document.getElementById('input-custom-cat').value.trim() || 'Własne Hasło';
  const hint = document.getElementById('input-custom-hint').value.trim();

  if (!word || word.length < 2) {
    showToast('Wpisz hasło o długości przynajmniej 2 liter!', 'error');
    return;
  }

  closeModal('modal-custom-word');
  setupHangmanWord(word, cat, hint);
}

// ============================================================================
// GLOBAL SESSION LEADERBOARD & EXCEL/CSV EXPORT
// ============================================================================
function addPointsToUser(username, points, isQuiz = false, isHangman = false) {
  const norm = username.toLowerCase();
  const entry = state.leaderboard.get(norm) || {
    username,
    score: 0,
    correctQuiz: 0,
    correctLetters: 0,
    lastActive: new Date().toLocaleTimeString()
  };

  entry.score += points;
  if (isQuiz) entry.correctQuiz++;
  if (isHangman) entry.correctLetters++;
  entry.lastActive = new Date().toLocaleTimeString();

  state.leaderboard.set(norm, entry);
}

function renderGlobalLeaderboard() {
  const tbody = document.getElementById('global-leaderboard-body');
  if (!tbody) return;

  const entries = Array.from(state.leaderboard.values());
  entries.sort((a, b) => b.score - a.score);

  if (entries.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; padding: 2.5rem; color: var(--text-muted);">
          Brak zarejestrowanych punktów w bieżącej sesji.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = entries.map((e, idx) => `
    <tr style="border-bottom: 1px solid var(--border-subtle); transition: background 0.15s ease;">
      <td style="padding: 0.85rem 1rem;">
        <span class="rank-badge ${idx === 0 ? 'rank-1' : (idx === 1 ? 'rank-2' : (idx === 2 ? 'rank-3' : ''))}">
          ${idx + 1}
        </span>
      </td>
      <td style="padding: 0.85rem 1rem; font-weight: 700; color: #fff;">
        @${e.username}
      </td>
      <td style="padding: 0.85rem 1rem; font-weight: 800; color: var(--accent-cyan); font-size: 1.05rem;">
        ${e.score.toLocaleString()} pkt
      </td>
      <td style="padding: 0.85rem 1rem; color: var(--accent-emerald); font-weight: 600;">
        ${e.correctQuiz}
      </td>
      <td style="padding: 0.85rem 1rem; color: var(--twitch-purple-light); font-weight: 600;">
        ${e.correctLetters}
      </td>
      <td style="padding: 0.85rem 1rem; color: var(--text-muted); font-size: 0.85rem;">
        ${e.lastActive}
      </td>
    </tr>
  `).join('');
}

function resetLeaderboard() {
  if (confirm("Czy na pewno chcesz zresetować tabelę wyników tej sesji?")) {
    state.leaderboard.clear();
    renderGlobalLeaderboard();
    showToast("Zresetowano ranking sesji.", "info");
  }
}

async function exportQuizCSV() {
  const entries = Array.from(state.leaderboard.values());
  entries.sort((a, b) => b.score - a.score);

  if (entries.length === 0) {
    showToast("Tabela wyników jest pusta! Zagraj przynajmniej 1 rundę, aby pobrać CSV.", "warning");
    return;
  }

  showToast("Generowanie pliku Excel / CSV...", "info");

  try {
    const formatted = entries.map(e => ({
      username: e.username,
      score: e.score,
      correct_answers: e.correctQuiz + e.correctLetters,
      accuracy: 100
    }));

    const headers = { 'Content-Type': 'application/json' };
    if (state.authPassword) headers['X-Panel-Password'] = state.authPassword;

    let url = `${API_BASE}/games/quiz/export`;
    if (state.authPassword) url += `?password=${encodeURIComponent(state.authPassword)}`;

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ leaderboard: formatted })
    });

    if (!res.ok) throw new Error(`Błąd HTTP ${res.status}`);

    const blob = await res.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `quiz_wyniki_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      window.URL.revokeObjectURL(blobUrl);
      a.remove();
    }, 45000);

    showToast("Plik CSV został pomyślnie pobrany!", "success");
  } catch (err) {
    showToast(`Błąd eksportu: ${err.message}`, "error");
  }
}

// ============================================================================
// OBS OVERLAY UTILS & MODALS
// ============================================================================
function openOBSModal() {
  updateOBSUrls();
  document.getElementById('modal-obs').classList.add('active');
}

function updateOBSUrls() {
  const base = `${window.location.origin}${window.location.pathname}`;
  const pwdParam = state.authPassword ? `&password=${encodeURIComponent(state.authPassword)}` : '';

  const quizInput = document.getElementById('obs-url-quiz');
  const giveawayInput = document.getElementById('obs-url-giveaway');
  const hangmanInput = document.getElementById('obs-url-hangman');

  if (quizInput) quizInput.value = `${base}?overlay=1&game=quiz${pwdParam}`;
  if (giveawayInput) giveawayInput.value = `${base}?overlay=1&game=giveaway${pwdParam}`;
  if (hangmanInput) hangmanInput.value = `${base}?overlay=1&game=hangman${pwdParam}`;
}

function copyOBSUrl(gameType) {
  const inputMap = {
    quiz: 'obs-url-quiz',
    giveaway: 'obs-url-giveaway',
    hangman: 'obs-url-hangman'
  };
  const input = document.getElementById(inputMap[gameType]);
  if (input) {
    input.select();
    navigator.clipboard.writeText(input.value);
    showToast(`Skopiowano link Overlay (${gameType}) do schowka! Wklej go w OBS.`, 'success');
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove('active');
}

window.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('active');
  }
});

function showToast(message, type = 'info') {
  if (state.isOverlay) return;
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${type === 'error' ? '⚠️' : (type === 'success' ? '✅' : 'ℹ️')}</span><span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ============================================================================
// LOCAL CHAT SIMULATOR (Dla testów na localhost)
// ============================================================================
function openSimModal() {
  document.getElementById('modal-sim').classList.add('active');
}

async function sendSimMessage(username, content) {
  try {
    const res = await fetch(`${API_BASE}/games/simulate-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, content })
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

async function simQuizVotes() {
  const voters = [
    { u: 'wojtek_banan', opt: 'A' },
    { u: 'chillerek369', opt: 'B' },
    { u: 'artur__o', opt: 'B' },
    { u: 'ilomile', opt: 'C' },
    { u: 'przemowskyyy', opt: 'B' }
  ];
  showToast('Wysyłam 5 symulowanych głosów na czat...', 'info');
  for (const v of voters) {
    await sendSimMessage(v.u, v.opt);
    await new Promise(r => setTimeout(r, 200));
  }
  closeModal('modal-sim');
}

async function simGiveawayEntrants() {
  const kw = state.giveaway.keyword || '!losowanie';
  const entrants = ['wojtek_banan', 'chillerek369', 'artur__o', 'ilomile', 'przemowskyyy', 'martynapanda'];
  showToast(`Wysyłam ${entrants.length} zgłoszeń z hasłem "${kw}"...`, 'info');
  for (const u of entrants) {
    await sendSimMessage(u, kw);
    await new Promise(r => setTimeout(r, 150));
  }
  closeModal('modal-sim');
}

async function simCustomMessage() {
  const user = document.getElementById('sim-input-user').value.trim() || 'test_widz';
  const msg = document.getElementById('sim-input-msg').value.trim();
  if (!msg) {
    showToast('Wpisz treść wiadomości!', 'error');
    return;
  }
  const ok = await sendSimMessage(user, msg);
  if (ok) {
    showToast(`Wysłano: [${user}]: ${msg}`, 'success');
    document.getElementById('sim-input-msg').value = '';
  } else {
    showToast('Błąd wysyłania wiadomości!', 'error');
  }
}
