// TwitchStreamGames Engine
// Sraken pierdaken jak to nie będzie działać to przeprowadzam się do lasu :>
// https://www.youtube.com/watch?v=NjOEdJ78eYM :oh:

const urlParams = new URLSearchParams(window.location.search);
const overlayParam = (urlParams.get('overlay') || '').toLowerCase();
const isOverlayMode = overlayParam === '1' || overlayParam === 'true' || overlayParam === 'yes' || urlParams.has('overlay');

const state = {
  activeGame: 'quiz', // 'quiz' | 'giveaway' | 'hangman' | 'leaderboard'
  lastPlayableGame: 'quiz',
  isOverlay: isOverlayMode,
  targetGame: urlParams.get('game') || 'auto',
  channel: 'Streamer',
  authPassword: localStorage.getItem('tm_auth_pwd') || urlParams.get('password') || '',
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
    answers: new Map(), // username -> { answer, timestamp, isCorrect }
    remoteAnswersCount: 0,
    remoteDistribution: { A: 0, B: 0, C: 0, D: 0 },
    remotePodium: [],
    revealed: false,
    podium: []
  },

  giveaway: {
    keyword: localStorage.getItem('tm_giveaway_kw') || '!losowanie',
    prize: localStorage.getItem('tm_giveaway_prize') || '',
    isOpen: false,
    participants: new Set(),
    remoteCount: 0,
    remoteParticipants: [],
    winner: null,
    lastRollHash: null,
    rollTrail: [],
    history: [],
    isRolling: false
  },

  hangman: {
    word: 'WIEDŹMIN DZIKI GON',
    category: 'Gry Komputerowe',
    hint: 'Kultowy RPG od CD Projekt Red',
    wordList: [], // Saved words: [{ word, category, hint }]
    revealedLetters: new Set(),
    wrongLetters: new Set(),
    livesLeft: 6,
    maxLives: 6,
    state: 'idle', // 'idle' | 'playing' | 'won' | 'lost'
    turnMode: 'chatter', // 'chatter' (Chatter) | 'all' (Czat Razem)
    activeChatter: null,
    activeChatterInfo: null,
    turnTimer: 45,
    turnInterval: null
  },

  leaderboard: new Map() // username -> { score, correctQuiz, correctLetters, lastActive }
};

// Immediate overlay tag on <html> to prevent any background flash in OBS Studio
if (state.isOverlay && document.documentElement) {
  document.documentElement.classList.add('overlay-mode');
}

const API_BASE = window.location.protocol === 'file:' ? 'http://localhost:8000/api' : '/api';

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Audio sounds disabled per streamer preference
function playSuccessChime() {}
function playErrorBuzzer() {}
function playTickSound() {}
function playFanfare() {}

// Confetti generator - lekki, zeby nie spalic procesora bez akceleracji GPU
let confettiParticles = [];
let confettiAnimationId = null;

function launchConfetti(durationMs = 1500) {
  const canvas = document.getElementById('confetti-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const colors = ['#9146FF', '#00d6c6', '#ffb020', '#00ad03', '#ffffff'];
  confettiParticles = [];
  for (let i = 0; i < 25; i++) {
    confettiParticles.push({
      x: Math.random() * canvas.width,
      y: Math.random() * -canvas.height * 0.3,
      size: Math.random() * 6 + 5,
      color: colors[Math.floor(Math.random() * colors.length)],
      speedY: Math.random() * 4 + 3,
      speedX: Math.random() * 4 - 2
    });
  }

  const startTime = Date.now();
  if (confettiAnimationId) cancelAnimationFrame(confettiAnimationId);

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < confettiParticles.length; i++) {
      const p = confettiParticles[i];
      p.y += p.speedY;
      p.x += p.speedX;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }

    if (Date.now() - startTime < durationMs) {
      confettiAnimationId = requestAnimationFrame(animate);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      confettiParticles = [];
      confettiAnimationId = null;
    }
  }

  animate();
}

// OBS Studio Synchronization Engine
// Synchronizacja stanu przez HTTP POST/GET do FastAPI z throttlingiem (~200ms).
function serializeGameState(forceEmpty = false) {
  // Set w JS serializuje sie do {}, Array.from() ratuje uczestnikow losowania
  const counts = { A: 0, B: 0, C: 0, D: 0 };
  state.quiz.answers.forEach((val) => {
    if (counts[val.answer] !== undefined) counts[val.answer]++;
  });

  const q = state.quiz.currentQuestion;
  const exportedGame = (state.activeGame === 'leaderboard') ? (state.lastPlayableGame || 'quiz') : state.activeGame;

  return {
    active_game: exportedGame,
    force_empty: forceEmpty,
    quiz: {
      question: q ? q.question : '',
      category: q ? (q.category || 'Ogólne') : 'Ogólne',
      options: q ? q.options : [],
      correct_answer: q ? (q.correctAnswer || q.correct || 'A') : 'A',
      state: state.quiz.state,
      duration_seconds: state.quiz.timerMax,
      timer_val: state.quiz.timerVal,
      answers_count: state.quiz.answers.size,
      distribution: counts,
      podium: state.quiz.podium || [],
      revealed: state.quiz.state === 'revealed'
    },
    giveaway: {
      keyword: state.giveaway.keyword,
      prize: state.giveaway.prize,
      state: state.giveaway.isOpen ? 'open' : (state.giveaway.winner ? 'drawn' : 'idle'),
      participants_count: state.giveaway.participants.size,
      participants: Array.from(state.giveaway.participants),
      winner: state.giveaway.winner,
      is_rolling: state.giveaway.isRolling,
      roll_trail: state.giveaway.rollTrail || [],
      roll_hash: state.giveaway.lastRollHash || null
    },
    hangman: {
      word: state.hangman.word,
      category: state.hangman.category,
      hint: state.hangman.hint,
      revealed_letters: Array.from(state.hangman.revealedLetters),
      wrong_letters: Array.from(state.hangman.wrongLetters),
      max_lives: state.hangman.maxLives,
      lives_left: state.hangman.livesLeft,
      state: state.hangman.state,
      active_chatter: state.hangman.activeChatter,
      turn_mode: state.hangman.turnMode,
      turn_timer: state.hangman.turnTimer
    }
  };
}

let syncDebounceTimer = null;
let lastSyncSendTime = 0;
let isPushingState = false;

async function pushStateToServer(immediate = false, forceEmpty = false) {
  if (state.isOverlay) return; // Only host pushes state

  const payload = serializeGameState(forceEmpty);
  broadcastSync('STATE_SYNC', payload);

  const send = async () => {
    if (isPushingState) return;
    isPushingState = true;
    lastSyncSendTime = Date.now();
    try {
      await fetch(`${API_BASE}/games/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(serializeGameState(forceEmpty))
      });
    } catch (e) {
    } finally {
      isPushingState = false;
    }
  };

  if (immediate) {
    if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
    syncDebounceTimer = null;
    await send();
  } else {
    const elapsed = Date.now() - lastSyncSendTime;
    if (elapsed > 200) {
      if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
      syncDebounceTimer = null;
      await send();
    } else if (!syncDebounceTimer) {
      syncDebounceTimer = setTimeout(() => {
        syncDebounceTimer = null;
        send();
      }, Math.max(20, 200 - elapsed));
    }
  }
}

let lastOverlayVersion = -1;
let isPollingOverlay = false;

function startOverlaySync() {
  async function pollOverlayState() {
    if (isPollingOverlay) return;
    isPollingOverlay = true;

    try {
      const res = await fetch(`${API_BASE}/games/state?t=${Date.now()}`);
      if (res.ok) {
        const data = await res.json();
        const ver = data.version || 0;
        if (ver !== lastOverlayVersion) {
          lastOverlayVersion = ver;
          applyServerState(data);
        }
      }
    } catch (e) {
    } finally {
      isPollingOverlay = false;
    }
  }

  pollOverlayState();
  setInterval(pollOverlayState, 250);
}

function applyServerState(data) {
  if (!data) return;

  // 1. Auto-switch mode on Overlay
  if (state.isOverlay) {
    const forcedGame = new URLSearchParams(window.location.search).get('game');
    if (!forcedGame || forcedGame === 'all' || forcedGame === 'auto') {
      if (data.active_game && data.active_game !== 'leaderboard' && data.active_game !== state.activeGame) {
        switchGameMode(data.active_game, false);
      }
    }
  }

  // 2. QUIZ MODULE SYNC
  if (data.quiz) {
    const sq = data.quiz;
    const wasRevealed = state.quiz.revealed;
    const prevQ = state.quiz.currentQuestion ? state.quiz.currentQuestion.question : '';
    const prevState = state.quiz.state;

    if (sq.question) {
      state.quiz.currentQuestion = {
        question: sq.question,
        category: sq.category || 'Ogólne',
        options: sq.options || [],
        correctAnswer: sq.correct_answer || 'A'
      };
    } else if (state.isOverlay && state.quiz.currentQuestion && state.quiz.currentQuestion.question) {
      if (data.force_empty === true) {
        state.quiz.currentQuestion = null;
      }
    } else if (!state.isOverlay) {
      state.quiz.currentQuestion = null;
    }

    const currentQ = state.quiz.currentQuestion ? state.quiz.currentQuestion.question : '';
    const sameQuestion = (prevQ === currentQ && currentQ !== '');
    const incomingState = sq.state || 'idle';
    const incomingTimer = sq.timer_val !== undefined ? sq.timer_val : (sq.duration_seconds || 30);
    const incomingVotes = sq.answers_count || 0;

    state.quiz.state = incomingState;
    state.quiz.timerMax = sq.duration_seconds || 30;
    state.quiz.remotePodium = sq.podium || [];
    state.quiz.revealed = !!sq.revealed;

    // MONOTONIC ANTI-JUMP PROTECTION FOR OBS OVERLAY:
    if (state.isOverlay && incomingState === 'active' && prevState === 'active' && sameQuestion) {
      // 1. Timer can only count down during an active round.
      if (incomingTimer < state.quiz.timerVal || incomingTimer >= (state.quiz.timerMax - 1)) {
        state.quiz.timerVal = incomingTimer;
      }

      // 2. Answers count can only increase during active voting. Never jump downwards!
      if (incomingVotes >= (state.quiz.remoteAnswersCount || 0)) {
        state.quiz.remoteAnswersCount = incomingVotes;
        if (sq.distribution) state.quiz.remoteDistribution = sq.distribution;
      }
    } else {
      // Fresh round started, round ended, or question changed: apply authoritative state
      state.quiz.timerVal = incomingTimer;
      state.quiz.remoteAnswersCount = incomingVotes;
      state.quiz.remoteDistribution = sq.distribution || { A: 0, B: 0, C: 0, D: 0 };
    }

    renderQuizUI();

    if (state.isOverlay && !wasRevealed && state.quiz.revealed) {
      launchConfetti(3500);
    }
  }

  // 3. GIVEAWAY MODULE SYNC
  if (data.giveaway) {
    const sg = data.giveaway;
    const prevWinner = state.giveaway.winner;
    const prevRolling = state.giveaway.isRolling;

    state.giveaway.keyword = sg.keyword || '!losowanie';
    state.giveaway.prize = sg.prize || '';
    state.giveaway.isOpen = sg.state === 'open';
    state.giveaway.remoteCount = sg.participants_count || 0;
    if (sg.participants && Array.isArray(sg.participants)) {
      state.giveaway.remoteParticipants = sg.participants;
    }
    state.giveaway.isRolling = !!sg.is_rolling;
    state.giveaway.winner = sg.winner;
    state.giveaway.lastRollHash = sg.roll_hash || null;
    state.giveaway.rollTrail = sg.roll_trail || [];

    if (state.isOverlay) {
      if (state.giveaway.isRolling && !prevRolling) {
        startOverlayRoulette(state.giveaway.rollTrail.length > 0 ? state.giveaway.rollTrail : (state.giveaway.remoteParticipants || []));
      } else if (sg.winner && sg.winner !== prevWinner) {
        finishOverlayRoulette(sg.winner);
        launchConfetti(4500);
      } else if (!state.giveaway.isRolling) {
        updateGiveawayUI();
      }
    } else {
      updateGiveawayUI();
    }
  }

  // 4. HANGMAN MODULE SYNC
  if (data.hangman) {
    const sh = data.hangman;
    state.hangman.word = sh.word || '';
    state.hangman.category = sh.category || 'Hasło';
    state.hangman.hint = sh.hint || '';
    state.hangman.revealedLetters = new Set(sh.revealed_letters || []);
    state.hangman.wrongLetters = new Set(sh.wrong_letters || []);
    state.hangman.livesLeft = sh.lives_left !== undefined ? sh.lives_left : 6;
    state.hangman.maxLives = sh.max_lives || 6;
    state.hangman.state = sh.state || 'idle';
    state.hangman.activeChatter = sh.active_chatter;
    state.hangman.turnMode = sh.turn_mode || 'chatter';
    state.hangman.turnTimer = sh.turn_timer !== undefined ? sh.turn_timer : 45;

    renderHangmanUI();
    updateTurnModeUI();
  }
}

// Inicjalizacja aplikacji i kanalu synchronizacji
window.addEventListener('DOMContentLoaded', async () => {
  // Setup BroadcastChannel ONLY on Host (avoids racing against HTTP poll on overlay)
  if (!state.isOverlay && 'BroadcastChannel' in window) {
    state.syncChannel = new BroadcastChannel('twitch_games_sync');
    state.syncChannel.onmessage = (ev) => handleSyncMessage(ev.data);
  }

  // Fetch status & message marker
  await fetchStatusInfo();
  await initLatestMsgId();

  // Check Overlay Mode
  if (state.isOverlay) {
    document.documentElement.classList.add('overlay-mode');
    document.body.classList.add('overlay-mode');
    let initialGame = (state.targetGame && state.targetGame !== 'auto' && state.targetGame !== 'all') ? state.targetGame : 'quiz';
    if (initialGame === 'leaderboard') initialGame = 'quiz';
    switchGameMode(initialGame, false);
    // Overlay polls server state and renders in real-time
    startOverlaySync();
  } else {
    // Host Mode
    await loadSavedQuestions();
    await loadSavedHangman();
    updateGiveawayUI();
    updateOBSUrls();

    // Fetch active server state to synchronize with what's running on server
    try {
      const sRes = await fetch(`${API_BASE}/games/state?t=${Date.now()}`);
      if (sRes.ok) {
        const sData = await sRes.json();
        // Adopt active game mode if present on server
        if (sData.active_game && sData.active_game !== 'leaderboard') {
          switchGameMode(sData.active_game, false);
        }
        // Adopt quiz state if question is active
        if (sData.quiz && sData.quiz.question) {
          const matchIdx = state.quiz.questionList.findIndex(q => q.question === sData.quiz.question);
          if (matchIdx >= 0) {
            state.quiz.currentIndex = matchIdx;
          }
          state.quiz.currentQuestion = {
            question: sData.quiz.question,
            category: sData.quiz.category || 'Ogólne',
            options: sData.quiz.options || [],
            correctAnswer: sData.quiz.correct_answer || 'A'
          };
          state.quiz.state = sData.quiz.state || 'idle';
          state.quiz.timerVal = sData.quiz.timer_val !== undefined ? sData.quiz.timer_val : 30;
          state.quiz.timerMax = sData.quiz.duration_seconds || 30;
          renderQuizUI();
        } else if (state.quiz.questionList.length > 0) {
          loadQuizQuestion(state.quiz.currentIndex);
        } else {
          renderQuizEmptyState();
        }

        // Adopt hangman state if present
        if (sData.hangman && sData.hangman.word) {
          state.hangman.word = sData.hangman.word;
          state.hangman.category = sData.hangman.category || 'Gry Komputerowe';
          state.hangman.hint = sData.hangman.hint || '';
          if (sData.hangman.state) state.hangman.state = sData.hangman.state;
          if (sData.hangman.lives_left !== undefined) state.hangman.livesLeft = sData.hangman.lives_left;
          if (sData.hangman.revealed_letters) state.hangman.revealedLetters = new Set(sData.hangman.revealed_letters);
          if (sData.hangman.wrong_letters) state.hangman.wrongLetters = new Set(sData.hangman.wrong_letters);
          renderHangmanUI();
        } else {
          setupHangmanWord(state.hangman.word, state.hangman.category, state.hangman.hint, false);
        }

        // Adopt giveaway state if present
        if (sData.giveaway) {
          if (sData.giveaway.keyword) state.giveaway.keyword = sData.giveaway.keyword;
          if (sData.giveaway.prize) state.giveaway.prize = sData.giveaway.prize;
          updateGiveawayUI();
        }
      } else {
        if (state.quiz.questionList.length > 0) {
          loadQuizQuestion(state.quiz.currentIndex);
        } else {
          renderQuizEmptyState();
        }
        setupHangmanWord(state.hangman.word, state.hangman.category, state.hangman.hint, false);
      }
    } catch (e) {
      if (state.quiz.questionList.length > 0) {
        loadQuizQuestion(state.quiz.currentIndex);
      } else {
        renderQuizEmptyState();
      }
      setupHangmanWord(state.hangman.word, state.hangman.category, state.hangman.hint, false);
    }

    ['input-custom-word', 'input-custom-cat', 'input-custom-hint'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('keyup', (e) => {
          if (e.key === 'Enter') applyCustomWord();
        });
      }
    });

    startChatPolling();
    // Do NOT push empty state to server on load!
  }
});

function handleSyncMessage(msg) {
  if (!msg) return;
  if (msg.type === 'STATE_SYNC') {
    applyServerState(msg.payload);
  } else if (msg.type === 'SWITCH_MODE') {
    const targetMode = msg.payload || msg.mode;
    if (targetMode && (!state.isOverlay || targetMode !== 'leaderboard')) {
      switchGameMode(targetMode, false);
    }
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

// Nawigacja miedzy grami
function switchGameMode(mode, doBroadcast = true) {
  if (!mode) return;
  if (state.isOverlay && mode === 'leaderboard') {
    return;
  }

  // If leaving hangman, stop chatter turn interval so it doesn't push hangman state in the background
  if (mode !== 'hangman' && state.hangman && state.hangman.turnInterval) {
    clearInterval(state.hangman.turnInterval);
    state.hangman.turnInterval = null;
  }

  if (mode !== 'leaderboard') {
    state.lastPlayableGame = mode;
  }
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

  if (doBroadcast && !state.isOverlay) {
    // Nie rozglaszaj trybu leaderboard do overlayu w OBS
    if (mode !== 'leaderboard') {
      broadcastSync('SWITCH_MODE', mode);
      pushStateToServer(true);
    }
  }
}

// Polling czatu Twitcha z bazy SQLite
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
  }, 500);
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

// Quiz Engine
async function loadSavedQuestions() {
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

  try {
    const res = await fetch(`${API_BASE}/games/quiz/questions?t=${Date.now()}`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        state.quiz.questionList = data;
        localStorage.setItem('tm_quiz_questions', JSON.stringify(data));
      }
    }
  } catch (e) {}

  updateQuestionManagerUI();
}

async function saveQuestions() {
  localStorage.setItem('tm_quiz_questions', JSON.stringify(state.quiz.questionList));
  updateQuestionManagerUI();

  try {
    await fetch(`${API_BASE}/games/quiz/questions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.quiz.questionList)
    });
  } catch (e) {}
}

function loadQuizQuestion(index) {
  if (!state.quiz.questionList || state.quiz.questionList.length === 0) {
    renderQuizEmptyState();
    pushStateToServer(true);
    return;
  }

  state.quiz.currentIndex = Math.max(0, Math.min(index, state.quiz.questionList.length - 1));
  const q = state.quiz.questionList[state.quiz.currentIndex];
  state.quiz.currentQuestion = q;
  state.quiz.state = 'idle';
  state.quiz.revealed = false;
  state.quiz.answers.clear();
  state.quiz.podium = [];
  state.quiz.remoteDistribution = { A: 0, B: 0, C: 0, D: 0 };
  state.quiz.remoteAnswersCount = 0;

  const log = document.getElementById('quiz-live-log');
  if (log) log.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 1rem;">Rozpocznij rundę, aby zbierać głosy z czatu.</div>';

  renderQuizUI();
  pushStateToServer(true);
}

function renderQuizEmptyState() {
  const indicator = document.getElementById('quiz-index-indicator');
  if (indicator && indicator.innerText !== '0 / 0') indicator.innerText = '0 / 0';
  const votes = document.getElementById('quiz-votes-counter');
  if (votes && votes.innerText !== '0') votes.innerText = '0';

  const qDisplay = document.getElementById('quiz-question-display');
  if (qDisplay) {
    if (state.isOverlay) {
      const emptyHtml = '<div style="padding: 1.5rem 0; color: var(--text-secondary);"><strong>Czekamy na pytanie streamerki...</strong></div>';
      if (qDisplay.innerHTML !== emptyHtml) qDisplay.innerHTML = emptyHtml;
    } else {
      const emptyText = 'Brak załadowanych pytań. Kliknij poniżej "Importuj Pytania", aby dodać swój quiz.';
      if (qDisplay.innerText !== emptyText) qDisplay.innerText = emptyText;
    }
  }

  ['A', 'B', 'C', 'D'].forEach(k => {
    const textEl = document.getElementById(`opt-text-${k}`);
    const expected = state.isOverlay ? '...' : '-';
    if (textEl && textEl.innerText !== expected) textEl.innerText = expected;
    const progEl = document.getElementById(`opt-prog-${k}`);
    if (progEl && progEl.style.width !== '0%') progEl.style.width = '0%';
    const countEl = document.getElementById(`opt-count-${k}`);
    if (countEl && countEl.innerText !== '0 odp.') countEl.innerText = '0 odp.';
  });

  const btnStart = document.getElementById('btn-quiz-start');
  if (btnStart) btnStart.disabled = true;
  const btnReveal = document.getElementById('btn-quiz-reveal');
  if (btnReveal) btnReveal.disabled = true;
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
  state.quiz.revealed = false;
  state.quiz.answers.clear();
  state.quiz.podium = [];
  state.quiz.remoteDistribution = { A: 0, B: 0, C: 0, D: 0 };
  state.quiz.remoteAnswersCount = 0;

  const timeSelect = document.getElementById('select-quiz-time');
  const duration = parseInt(timeSelect ? timeSelect.value : '30', 10);
  state.quiz.timerMax = duration;
  state.quiz.timerVal = duration;

  const log = document.getElementById('quiz-live-log');
  if (log) log.innerHTML = '';

  renderQuizUI();
  pushStateToServer(true);

  playSuccessChime();
  showToast('Głosowanie aktywne! Widzowie odpowiadają wpisując A, B, C lub D.', 'success');

  if (state.quiz.timerInterval) clearInterval(state.quiz.timerInterval);
  if (duration > 0) {
    state.quiz.timerInterval = setInterval(() => {
      state.quiz.timerVal--;
      if (state.quiz.timerVal <= 5 && state.quiz.timerVal > 0) playTickSound();
      updateQuizTimerUI();
      pushStateToServer(false);
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

  // Immediately render updated votes on Host
  renderQuizUI();

  // Push state to OBS Overlay (throttled)
  pushStateToServer(false);

  // Add to live incoming feed
  const log = document.getElementById('quiz-live-log');
  if (log) {
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.innerHTML = `<span><strong>@${username}</strong> oddał(a) głos na <strong>${chosenKey}</strong></span><span style="color: var(--accent-emerald); font-weight: 700; font-size: 0.75rem;">Oddano</span>`;
    log.prepend(entry);
    if (log.children.length > 30) log.lastElementChild.remove();
  }

  playTickSound(900);
}

function revealQuizAnswer() {
  if (state.quiz.timerInterval) clearInterval(state.quiz.timerInterval);
  state.quiz.state = 'revealed';

  const q = state.quiz.currentQuestion;
  const correctKey = q ? (q.correctAnswer || q.correct || 'A') : 'A';

  // Calculate vote percentages & correct chatters
  const counts = { A: 0, B: 0, C: 0, D: 0 };
  const correctChatters = [];

  state.quiz.answers.forEach((val, user) => {
    if (counts[val.answer] !== undefined) counts[val.answer]++;
    if (val.isCorrect) correctChatters.push({ user, timestamp: val.timestamp });
  });

  // Sort correct chatters by speed
  correctChatters.sort((a, b) => a.timestamp - b.timestamp);

  // Store podium and award points
  state.quiz.podium = correctChatters.slice(0, 5).map((c, i) => {
    const pts = 100 + (i === 0 ? 50 : (i === 1 ? 30 : (i === 2 ? 15 : 0)));
    addPointsToUser(c.user, pts, true, false);
    return { username: c.user, points: pts };
  });

  renderQuizUI();
  playFanfare();
  launchConfetti(3500);
  pushStateToServer(true);
}

function renderQuizUI() {
  const q = state.quiz.currentQuestion;
  if (!q || !q.question) {
    renderQuizEmptyState();
    return;
  }

  // Question & Category
  const catDisplay = document.getElementById('quiz-category-display');
  const total = (state.quiz.questionList && state.quiz.questionList.length) ? state.quiz.questionList.length : 1;
  const currentNum = state.quiz.currentIndex + 1;
  if (catDisplay) {
    const indexPart = state.isOverlay ? '' : ` <span id="quiz-index-indicator">${currentNum} / ${total}</span>`;
    const catHtml = `${q.category || 'Pytanie'}${indexPart}`;
    if (catDisplay.innerHTML !== catHtml) catDisplay.innerHTML = catHtml;
  }

  const qText = document.getElementById('quiz-question-display');
  if (qText && qText.innerText !== q.question) {
    qText.innerText = q.question;
  }

  // Options A, B, C, D text
  if (q.options) {
    q.options.forEach(opt => {
      const textEl = document.getElementById(`opt-text-${opt.key}`);
      if (textEl && textEl.innerText !== opt.text) {
        textEl.innerText = opt.text;
      }
    });
  }

  // Total Votes badge
  const votesCount = state.isOverlay ? (state.quiz.remoteAnswersCount || 0) : state.quiz.answers.size;
  const counter = document.getElementById('quiz-votes-counter');
  if (counter && counter.innerText != votesCount) {
    counter.innerText = votesCount;
  }

  const optionsGrid = document.getElementById('quiz-options-container');
  const podiumCard = document.getElementById('quiz-round-podium');

  // Calculate or use remote distribution
  let dist = state.quiz.remoteDistribution;
  if (!state.isOverlay || !dist) {
    dist = { A: 0, B: 0, C: 0, D: 0 };
    state.quiz.answers.forEach((val) => {
      if (dist[val.answer] !== undefined) dist[val.answer]++;
    });
  }

  const totalVotes = Object.values(dist).reduce((a, b) => a + b, 0);

  // Helper to update progress and counts on options
  const updateOptionBars = () => {
    ['A', 'B', 'C', 'D'].forEach(key => {
      const countEl = document.getElementById(`opt-count-${key}`);
      const progEl = document.getElementById(`opt-prog-${key}`);
      const c = dist[key] || 0;
      const pct = totalVotes > 0 ? Math.round((c / totalVotes) * 100) : 0;
      const countStr = `${c} odp. (${pct}%)`;
      const pctStr = `${pct}%`;
      if (countEl && countEl.innerText !== countStr) countEl.innerText = countStr;
      if (progEl && progEl.style.width !== pctStr) progEl.style.width = pctStr;
    });
  };

  // Handle ACTIVE vs REVEALED vs IDLE visual states
  if (state.quiz.state === 'active') {
    if (optionsGrid && !optionsGrid.classList.contains('voting-active')) {
      optionsGrid.classList.add('voting-active');
      document.querySelectorAll('.option-card').forEach(c => c.classList.remove('correct', 'wrong'));
    }
    if (podiumCard && podiumCard.style.display !== 'none') podiumCard.style.display = 'none';

    // Show live voting stats in real time on both Host and Overlay!
    updateOptionBars();

  } else if (state.quiz.state === 'revealed' || state.quiz.revealed) {
    if (optionsGrid && optionsGrid.classList.contains('voting-active')) {
      optionsGrid.classList.remove('voting-active');
    }

    const correctKey = q.correctAnswer || q.correct || 'A';
    document.querySelectorAll('.option-card').forEach(card => {
      const k = card.getAttribute('data-key');
      if (k === correctKey) {
        if (!card.classList.contains('correct')) {
          card.classList.add('correct');
          card.classList.remove('wrong');
        }
      } else {
        if (!card.classList.contains('wrong')) {
          card.classList.add('wrong');
          card.classList.remove('correct');
        }
      }
    });

    updateOptionBars();

    // Podium display
    const podiumItems = state.isOverlay ? (state.quiz.remotePodium || []) : state.quiz.podium;
    if (podiumCard) {
      if (podiumCard.style.display !== 'block') podiumCard.style.display = 'block';
      const podiumLetter = document.getElementById('podium-correct-letter');
      const podiumSub = document.getElementById('podium-stats-sub');
      const podiumList = document.getElementById('podium-list');

      if (podiumLetter && podiumLetter.innerText !== correctKey) podiumLetter.innerText = correctKey;
      const subText = `${podiumItems ? podiumItems.length : 0} poprawnych odpowiedzi (na ${votesCount} głosujących)`;
      if (podiumSub && podiumSub.innerText !== subText) podiumSub.innerText = subText;
      if (podiumList && podiumItems) {
        const podKey = podiumItems.map(c => `${c.username || c.user}:${c.points}`).join('|');
        if (podiumList._lastPodKey !== podKey) {
          podiumList._lastPodKey = podKey;
          podiumList.innerHTML = podiumItems.slice(0, 5).map((c, i) => `
            <div style="background: var(--twitch-base); padding: 0.35rem 0.75rem; border-radius: var(--radius-xs); border: 1px solid rgba(0,173,3,0.3); font-size: 0.825rem; display: flex; align-items: center; gap: 0.4rem;">
              <span style="font-weight: 700; color: var(--accent-amber);">#${i + 1}</span>
              <strong>@${c.username || c.user}</strong>
              <span style="color: var(--accent-emerald); font-weight: 700;">+${c.points || 100} pkt</span>
            </div>
          `).join('') || '<div style="color: var(--text-muted); font-size: 0.85rem;">Nikt nie odpowiedział poprawnie w tej rundzie!</div>';
        }
      }
    }
  } else {
    // Idle state
    if (optionsGrid && optionsGrid.classList.contains('voting-active')) {
      optionsGrid.classList.remove('voting-active');
      document.querySelectorAll('.option-card').forEach(c => {
        c.classList.remove('correct', 'wrong');
        const k = c.getAttribute('data-key');
        const prog = document.getElementById(`opt-prog-${k}`);
        const cnt = document.getElementById(`opt-count-${k}`);
        if (prog && prog.style.width !== '0%') prog.style.width = '0%';
        if (cnt && cnt.innerText !== '0 odp.') cnt.innerText = '0 odp.';
      });
    }
    if (podiumCard && podiumCard.style.display !== 'none') podiumCard.style.display = 'none';
  }

  const btnStart = document.getElementById('btn-quiz-start');
  const btnReveal = document.getElementById('btn-quiz-reveal');
  if (btnStart) btnStart.disabled = state.quiz.state === 'active';
  if (btnReveal) btnReveal.disabled = state.quiz.state !== 'active';

  updateQuizTimerUI();
}

function updateQuizTimerUI() {
  const sec = document.getElementById('quiz-timer-sec');
  const fill = document.getElementById('quiz-timer-fill');
  const badge = document.getElementById('quiz-timer-badge');

  if (sec && sec.innerText != state.quiz.timerVal) {
    sec.innerText = state.quiz.timerVal;
  }
  if (fill && state.quiz.timerMax > 0) {
    const pct = Math.max(0, (state.quiz.timerVal / state.quiz.timerMax) * 100);
    const pctStr = `${pct}%`;
    if (fill.style.width !== pctStr) fill.style.width = pctStr;
    const bg = pct < 25 ? 'var(--accent-red)' : (pct < 50 ? 'var(--accent-amber)' : 'linear-gradient(90deg, var(--twitch-purple), var(--accent-cyan))');
    if (fill.style.background !== bg) fill.style.background = bg;
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
  const bulkModal = document.getElementById('modal-bulk-import');
  if (bulkModal) {
    bulkModal.style.zIndex = '1200';
    bulkModal.classList.add('active');
    setTimeout(() => {
      const ta = document.getElementById('textarea-bulk-import');
      if (ta) ta.focus();
    }, 50);
  }
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

// -------------------------------------------------------------------------------------------
// W NIEKTÓRYCH CZĘŚCIACH BARDZO CIĘŻKO BYŁO OGARNĄĆ TEN PIERDOLNIK POZDRAWIAM ~ Pszemuś
// -------------------------------------------------------------------------------------------

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
  updateQuestionManagerUI();
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
            <button class="btn btn-secondary btn-icon" onclick="jumpToQuizQuestion(${idx})" title="Załaduj na planszę">Wybierz</button>
            <button class="btn btn-danger btn-icon" onclick="deleteQuizQuestion(${idx})" title="Usuń pytanie">Usuń</button>
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

async function deleteQuizQuestion(index) {
  const q = state.quiz.questionList[index];
  const qId = q ? q.id : null;
  state.quiz.questionList.splice(index, 1);
  saveQuestions();
  if (qId) {
    try {
      await fetch(`${API_BASE}/games/quiz/questions/${qId}`, { method: 'DELETE' });
    } catch (e) {}
  }
  if (state.quiz.questionList.length > 0) {
    state.quiz.currentIndex = Math.max(0, Math.min(index, state.quiz.questionList.length - 1));
    loadQuizQuestion(state.quiz.currentIndex);
  } else {
    state.quiz.currentQuestion = null;
    renderQuizEmptyState();
  }
  showToast('Usunięto pytanie.', 'info');
}

async function clearAllQuestions() {
  if (confirm("Czy na pewno chcesz usunąć wszystkie załadowane pytania?")) {
    state.quiz.questionList = [];
    state.quiz.currentIndex = 0;
    state.quiz.currentQuestion = null;
    localStorage.removeItem('tm_quiz_questions');
    try {
      await fetch(`${API_BASE}/games/quiz/questions`, { method: 'DELETE' });
    } catch (e) {}
    updateQuestionManagerUI();
    renderQuizEmptyState();
    closeModal('modal-question-manager');
    showToast("Wyczyszczono bazę pytań.", "info");
    pushStateToServer(true, true);
  }
}

// Giveaway Engine
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
  pushStateToServer(true);
  showToast(`Ustawiono słowo kluczowe: "${kw}"`, 'success');
}

function startGiveawayRegistration() {
  state.giveaway.isOpen = true;
  state.giveaway.winner = null;
  state.giveaway.isRolling = false;
  updateGiveawayUI();
  playSuccessChime();
  showToast(`Zapisy OTWARTE! Czat wpisuje "${state.giveaway.keyword}", aby wziąć udział.`, 'success');
  pushStateToServer(true);
}

function closeGiveawayRegistration() {
  state.giveaway.isOpen = false;
  updateGiveawayUI();
  playErrorBuzzer();
  showToast(`Zapisy ZAMKNIĘTE. Zapisano ${state.giveaway.participants.size} uczestników.`, 'info');
  pushStateToServer(true);
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
      pushStateToServer(false);
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
      pill.innerText = 'Zapisy Otwarte (Czat Dołącza)';
    } else {
      pill.className = 'giveaway-status-badge closed';
      pill.innerText = 'Zapisy Zamknięte';
    }
  }

  if (btnOpen) btnOpen.disabled = state.giveaway.isOpen;
  if (btnClose) btnClose.disabled = !state.giveaway.isOpen;

  updateGiveawayParticipantsUI();

  // Handle winner card / spinner display
  const winnerCard = document.getElementById('giveaway-winner-card');
  const winnerName = document.getElementById('giveaway-winner-name');
  const winnerDetails = document.getElementById('giveaway-winner-details');
  const spinnerBox = document.getElementById('giveaway-spinner-container');
  const spinnerText = document.getElementById('giveaway-spinner-text');
  const idleHint = document.getElementById('giveaway-idle-hint');

  if (state.giveaway.winner) {
    if (winnerCard) winnerCard.style.display = 'flex';
    if (winnerName) winnerName.innerText = `@${state.giveaway.winner}`;
    if (winnerDetails) {
      const prizeText = state.giveaway.prize ? `Nagroda: ${state.giveaway.prize} • ` : '';
      const count = state.isOverlay ? (state.giveaway.remoteCount || 0) : state.giveaway.participants.size;
      winnerDetails.innerText = `${prizeText}Wyłoniono spośród ${count} uczestników`;
    }
    const csprngBadge = document.getElementById('giveaway-winner-csprng');
    if (csprngBadge) {
      csprngBadge.style.display = 'inline-block';
      csprngBadge.innerText = state.giveaway.lastRollHash ? `Losowanie CSPRNG #${state.giveaway.lastRollHash}` : 'Losowanie CSPRNG';
    }
    if (spinnerBox) spinnerBox.classList.remove('rolling');
    if (spinnerText) spinnerText.style.display = 'none';
    if (idleHint) idleHint.style.display = 'none';
  } else if (state.giveaway.isRolling) {
    if (winnerCard) winnerCard.style.display = 'none';
    if (spinnerBox) spinnerBox.classList.add('rolling');
    if (spinnerText) spinnerText.style.display = 'block';
    if (idleHint) idleHint.style.display = 'none';
  } else {
    if (winnerCard) winnerCard.style.display = 'none';
    if (spinnerBox) spinnerBox.classList.remove('rolling');
    if (spinnerText) spinnerText.style.display = 'none';
    if (idleHint) {
      idleHint.style.display = 'block';
      const kw = state.giveaway.keyword || '!losowanie';
      const prize = state.giveaway.prize ? state.giveaway.prize.trim() : '';

      if (state.isOverlay) {
        if (state.giveaway.isOpen) {
          idleHint.innerHTML = `
            <div class="giveaway-overlay-hero">
              ${prize ? `<div class="giveaway-overlay-prize-badge">Do wygrania: <strong>${escapeHtml(prize)}</strong></div>` : ''}
              <div class="giveaway-overlay-inst">Wpisz na czacie:</div>
              <div class="giveaway-overlay-kw-box">
                <span class="giveaway-overlay-kw-text">${escapeHtml(kw)}</span>
              </div>
              <div class="giveaway-overlay-sub">aby dołączyć do losowania</div>
            </div>
          `;
        } else {
          idleHint.innerHTML = `
            <div class="giveaway-overlay-hero">
              ${prize ? `<div class="giveaway-overlay-prize-badge">Do wygrania: <strong>${escapeHtml(prize)}</strong></div>` : ''}
              <div class="giveaway-overlay-inst">Słowo kluczowe:</div>
              <div class="giveaway-overlay-kw-box closed">
                <span class="giveaway-overlay-kw-text">${escapeHtml(kw)}</span>
              </div>
              <div class="giveaway-overlay-sub">Wpisz na czacie, gdy wystartują zapisy</div>
            </div>
          `;
        }
      } else {
        if (state.giveaway.isOpen) {
          idleHint.innerHTML = `
            <div style="text-align: center; color: var(--text-secondary); padding: 0.5rem 0;">
              <div style="font-size: 1.15rem; color: #fff; font-weight: 700; margin-bottom: 0.35rem;">
                Zapisy na czacie są aktywne!
              </div>
              <div>Widzowie dołączają wpisując: <strong style="color: var(--accent-amber); font-size: 1.15rem;">${escapeHtml(kw)}</strong></div>
              ${prize ? `<div style="font-size: 0.85rem; color: var(--accent-cyan); margin-top: 0.35rem;">Nagroda: <strong>${escapeHtml(prize)}</strong></div>` : ''}
            </div>
          `;
        } else {
          idleHint.innerHTML = `
            <div style="text-align: center; color: var(--text-secondary); padding: 0.5rem 0;">
              <div style="font-size: 1.05rem; color: #fff; font-weight: 600; margin-bottom: 0.35rem;">
                Słowo kluczowe: <strong style="color: var(--accent-amber); font-size: 1.1rem;">${escapeHtml(kw)}</strong>
              </div>
              <div>Kliknij <strong>"Otwórz Zapisy na Czacie"</strong> poniżej, aby widzowie mogli dołączać.</div>
              ${prize ? `<div style="font-size: 0.85rem; color: var(--accent-cyan); margin-top: 0.35rem;">Nagroda: <strong>${escapeHtml(prize)}</strong></div>` : ''}
            </div>
          `;
        }
      }
    }
  }
}

// ============================================================================
// CSPRNG CRYPTOGRAPHIC RANDOMNESS ENGINE & GIVEAWAY ROULETTE
// Sprzetowa entropia Web Cryptography API, bezstronne probkowanie z odrzucaniem (rejection sampling),
// wieloprzebiegowy Fisher-Yates shuffle oraz zsynchronizowana ruletka z krzywa zwolnienia.
// ============================================================================

/**
 * Kryptograficznie bezpieczna liczba calkowita z zakresu [0, max - 1].
 * Rejection sampling eliminuje blad modulo (modulo bias) do dokladnie 0.000000%.
 */
function getSecureRandomInt(max) {
  if (max <= 1) return 0;
  const limit = 0xFFFFFFFF - (0xFFFFFFFF % max);
  const buffer = new Uint32Array(1);
  let rand;
  do {
    window.crypto.getRandomValues(buffer);
    rand = buffer[0];
  } while (rand >= limit);
  return rand % max;
}

/**
 * Wieloprzebiegowy Fisher-Yates (Knuth) Cryptographic Shuffle.
 * Maksymalna dyfuzja entropii i brak faworyzowania pozycji w tablicy.
 */
function secureShuffle(array) {
  const arr = array.slice();
  const passes = Math.max(2, Math.min(4, Math.ceil(30 / Math.max(1, arr.length))));
  for (let pass = 0; pass < passes; pass++) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = getSecureRandomInt(i + 1);
      const temp = arr[i];
      arr[i] = arr[j];
      arr[j] = temp;
    }
  }
  return arr;
}

/**
 * Generuje 8-znakowy skrot weryfikacyjny CSPRNG do historii i na karte zwyciezcy.
 */
function generateEntropyProof() {
  const bytes = new Uint8Array(4);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/**
 * Tworzy sekwencje losowania (trail), ktora plynnie zwalnia i konczy sie na wylosowanym zwyciezcy.
 */
function buildRollTrail(entrants, winner, steps = 30) {
  if (entrants.length <= 1) return [winner];
  const trail = [];
  for (let i = 0; i < steps - 1; i++) {
    trail.push(entrants[getSecureRandomInt(entrants.length)]);
  }
  trail.push(winner);
  return trail;
}

let hostRouletteCancel = null;
let overlayRouletteCancel = null;

/**
 * Kinematyczny silnik ruletki ze stopniowym wyhamowywaniem (krzywa szescienna).
 * Uzywany wspolnie przez panel Hosta i nakladke OBS Studio Browser Source.
 */
function runCinematicRoulette(trail, onStep, onFinish) {
  if (!trail || trail.length === 0) {
    if (onFinish) onFinish();
    return () => {};
  }

  let index = 0;
  let activeTimeout = null;
  let isCancelled = false;
  const total = trail.length;

  function step() {
    if (isCancelled) return;
    if (index >= total) {
      if (onFinish) onFinish();
      return;
    }

    const name = trail[index];
    if (onStep) onStep(name, index, total);

    // Dynamiczna krzywa opoznienia od 40ms do ~550ms
    const progress = index / Math.max(1, total - 1);
    const delay = Math.round(40 + Math.pow(progress, 3.2) * 520);

    index++;
    if (index < total) {
      activeTimeout = setTimeout(step, delay);
    } else {
      activeTimeout = setTimeout(() => {
        if (!isCancelled && onFinish) onFinish();
      }, 350);
    }
  }

  step();

  return () => {
    isCancelled = true;
    if (activeTimeout) clearTimeout(activeTimeout);
  };
}

function startOverlayRoulette(trailOrPool) {
  if (overlayRouletteCancel) {
    overlayRouletteCancel();
    overlayRouletteCancel = null;
  }

  const spinnerBox = document.getElementById('giveaway-spinner-container');
  const spinnerText = document.getElementById('giveaway-spinner-text');
  const idleHint = document.getElementById('giveaway-idle-hint');
  const winnerCard = document.getElementById('giveaway-winner-card');

  if (idleHint) idleHint.style.display = 'none';
  if (winnerCard) winnerCard.style.display = 'none';
  if (spinnerBox) spinnerBox.classList.add('rolling');
  if (spinnerText) spinnerText.style.display = 'block';

  let trail = (Array.isArray(trailOrPool) && trailOrPool.length > 0)
    ? trailOrPool
    : ['Czatujący', 'AktywnyWidz', 'Zwycięzca', 'TwitchViewer'];

  if (trail.length < 15 && state.giveaway.remoteParticipants && state.giveaway.remoteParticipants.length > 0) {
    trail = buildRollTrail(state.giveaway.remoteParticipants, state.giveaway.remoteParticipants[0], 25);
  }

  overlayRouletteCancel = runCinematicRoulette(
    trail,
    (name) => {
      if (spinnerText) spinnerText.innerText = `@${name}`;
    },
    () => {
      overlayRouletteCancel = null;
      if (state.giveaway.winner) {
        finishOverlayRoulette(state.giveaway.winner);
      }
    }
  );
}

function finishOverlayRoulette(winner) {
  if (overlayRouletteCancel) {
    overlayRouletteCancel();
    overlayRouletteCancel = null;
  }
  state.giveaway.isRolling = false;
  state.giveaway.winner = winner;

  const spinnerText = document.getElementById('giveaway-spinner-text');
  if (spinnerText) {
    spinnerText.innerText = `@${winner}`;
  }

  setTimeout(() => {
    updateGiveawayUI();
  }, 250);
}

function updateGiveawayParticipantsUI() {
  const countDisplay = document.getElementById('giveaway-participants-count');
  const sidebarCount = document.getElementById('sidebar-giveaway-count');
  const listEl = document.getElementById('giveaway-participants-list');

  const count = state.isOverlay ? (state.giveaway.remoteCount || 0) : state.giveaway.participants.size;
  if (countDisplay) countDisplay.innerText = count;
  if (sidebarCount) sidebarCount.innerText = count;

  if (listEl && !state.isOverlay) {
    if (count === 0) {
      listEl.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 1.5rem; font-size: 0.85rem;">Brak zapisanych uczestników.</div>';
    } else {
      listEl.innerHTML = Array.from(state.giveaway.participants).map((u, i) => `
        <div class="leader-item">
          <div class="leader-left">
            <span class="rank-badge">${i + 1}</span>
            <span class="leader-name">@${u}</span>
          </div>
          <span style="font-size: 0.75rem; color: var(--accent-emerald); font-weight: 600;">Zapisany</span>
        </div>
      `).join('');
    }
  }
}

function rollGiveawayWinner(isReroll = false) {
  const allEntrants = Array.from(state.giveaway.participants);
  if (allEntrants.length === 0) {
    showToast('Brak uczestników do losowania! Otwórz najpierw zapisy.', 'warning');
    return;
  }

  // Smart Anti-Repeat: Na rerollu wykluczamy poprzedniego gracza (jesli bylo >1 chetnych)
  let candidatePool = allEntrants;
  if (isReroll && allEntrants.length > 1 && state.giveaway.winner) {
    const prevWinnerLower = state.giveaway.winner.toLowerCase();
    const filtered = allEntrants.filter(u => u.toLowerCase() !== prevWinnerLower);
    if (filtered.length > 0) candidatePool = filtered;
  }

  // 1. Wieloprzebiegowy CSPRNG shuffle
  const shuffled = secureShuffle(candidatePool);

  // 2. Bezstronne probkowanie z odrzucaniem
  const winnerIndex = getSecureRandomInt(shuffled.length);
  const chosenWinner = shuffled[winnerIndex];

  // 3. Generowanie skrotu weryfikacyjnego CSPRNG
  const proofHash = generateEntropyProof();
  state.giveaway.lastRollHash = proofHash;

  // 4. Budowa zsynchronizowanej sekwencji ruletki
  const trail = buildRollTrail(allEntrants, chosenWinner, 30);
  state.giveaway.rollTrail = trail;

  // Zamkniecie zapisow i aktywacja stanu losowania
  state.giveaway.isOpen = false;
  state.giveaway.isRolling = true;
  state.giveaway.winner = null;

  updateGiveawayUI();
  pushStateToServer(true);

  const spinnerBox = document.getElementById('giveaway-spinner-container');
  const spinnerText = document.getElementById('giveaway-spinner-text');
  const idleHint = document.getElementById('giveaway-idle-hint');
  const winnerCard = document.getElementById('giveaway-winner-card');

  if (idleHint) idleHint.style.display = 'none';
  if (winnerCard) winnerCard.style.display = 'none';
  if (spinnerText) spinnerText.style.display = 'block';
  if (spinnerBox) spinnerBox.classList.add('rolling');

  if (hostRouletteCancel) {
    hostRouletteCancel();
    hostRouletteCancel = null;
  }

  hostRouletteCancel = runCinematicRoulette(
    trail,
    (name) => {
      if (spinnerText) spinnerText.innerText = `@${name}`;
    },
    () => {
      hostRouletteCancel = null;
      finishGiveawayRoll(chosenWinner);
    }
  );
}

function finishGiveawayRoll(winner) {
  state.giveaway.isRolling = false;
  state.giveaway.winner = winner;

  updateGiveawayUI();

  // Zapis do historii biezacej sesji
  state.giveaway.history.unshift({
    winner,
    time: new Date().toLocaleTimeString(),
    entrants: state.giveaway.participants.size,
    hash: state.giveaway.lastRollHash
  });
  updateGiveawayHistoryUI();

  launchConfetti(2500);
  showToast(`Wylosowano: @${winner}! (CSPRNG #${state.giveaway.lastRollHash})`, 'success');
  pushStateToServer(true);
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
        <span class="rank-badge">1</span>
        <span class="leader-name">@${h.winner}</span>
      </div>
      <span style="font-size: 0.75rem; color: var(--text-muted);">${h.time} (${h.entrants} os.) ${h.hash ? '• #' + h.hash : ''}</span>
    </div>
  `).join('');
}

function clearGiveawayParticipants() {
  if (confirm("Czy na pewno chcesz wyczyścić listę zapisanych osób?")) {
    state.giveaway.participants.clear();
    state.giveaway.winner = null;
    state.giveaway.lastRollHash = null;
    state.giveaway.rollTrail = [];

    const winnerCard = document.getElementById('giveaway-winner-card');
    const idleHint = document.getElementById('giveaway-idle-hint');
    if (winnerCard) winnerCard.style.display = 'none';
    if (idleHint) idleHint.style.display = 'block';

    updateGiveawayUI();
    showToast("Wyczyszczono listę uczestników losowania.", "info");
    pushStateToServer(true);
  }
}

// Hangman Engine
function setupHangmanWord(word, category = 'Gry Komputerowe', hint = '', notify = true) {
  state.hangman.word = (word || 'WIEDŹMIN DZIKI GON').toUpperCase().trim();
  state.hangman.category = category || 'Gry Komputerowe';
  state.hangman.hint = hint || '';
  state.hangman.revealedLetters.clear();
  state.hangman.wrongLetters.clear();
  state.hangman.livesLeft = state.hangman.maxLives;
  state.hangman.state = 'playing';

  saveHangmanCurrent(state.hangman.word, state.hangman.category, state.hangman.hint);

  for (const ch of state.hangman.word) {
    if (!ch.match(/[A-ZĄĆĘŁŃÓŚŹŻ]/i)) {
      state.hangman.revealedLetters.add(ch);
    }
  }

  renderHangmanUI();
  if (notify) {
    pushStateToServer(true);
    showToast(`Rozpoczęto hasło: ${state.hangman.category}`, 'info');
    if (state.hangman.turnMode === 'chatter' && !state.isOverlay) {
      rollActiveChatter();
    }
  }
}

function renderHangmanUI() {
  const catDisplay = document.getElementById('hangman-category-display');
  const hintDisplay = document.getElementById('hangman-hint-display');
  if (catDisplay && catDisplay.innerText !== state.hangman.category) {
    catDisplay.innerText = state.hangman.category;
  }
  const hintText = state.hangman.hint ? `Podpowiedź: ${state.hangman.hint}` : '';
  if (hintDisplay && hintDisplay.innerText !== hintText) {
    hintDisplay.innerText = hintText;
  }

  for (let i = 1; i <= state.hangman.maxLives; i++) {
    const heart = document.getElementById(`heart-${i}`);
    if (heart) {
      const targetClass = i <= state.hangman.livesLeft ? 'life-pip active' : 'life-pip lost';
      if (heart.className !== targetClass) heart.className = targetClass;
    }
  }

  const livesNum = document.getElementById('hangman-lives-num');
  const livesStr = `${state.hangman.livesLeft}/${state.hangman.maxLives}`;
  if (livesNum && livesNum.innerText !== livesStr) livesNum.innerText = livesStr;

  const board = document.getElementById('hangman-board');
  if (board) {
    const currentWordKey = `${state.hangman.word}__${Array.from(state.hangman.revealedLetters).sort().join('')}`;
    if (board._lastRenderedKey !== currentWordKey) {
      board._lastRenderedKey = currentWordKey;
      board.innerHTML = '';
      const words = state.hangman.word.split(' ');

      words.forEach((w) => {
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
      });
    }
  }

  const wrongContainer = document.getElementById('wrong-letters-chips');
  if (wrongContainer) {
    const wrongKey = Array.from(state.hangman.wrongLetters).sort().join(',');
    if (wrongContainer._lastRenderedKey !== wrongKey) {
      wrongContainer._lastRenderedKey = wrongKey;
      if (state.hangman.wrongLetters.size === 0) {
        wrongContainer.innerHTML = '<span style="font-size: 0.8rem; color: var(--text-muted); font-style: italic;">Brak</span>';
      } else {
        wrongContainer.innerHTML = Array.from(state.hangman.wrongLetters).map(ch => `
          <span class="wrong-letter-chip">${ch}</span>
        `).join('');
      }
    }
  }

  // Active Chatter Banner & Win/Loss Status Display
  const avatar = document.getElementById('chatter-avatar-initial');
  const nameDisplay = document.getElementById('chatter-name-display');
  const subHint = document.getElementById('chatter-sub-hint');
  const timerCircle = document.getElementById('chatter-turn-timer');
  const chatterBanner = document.getElementById('hangman-chatter-banner');

  if (chatterBanner) chatterBanner.style.display = 'flex';

  if (state.hangman.state === 'won') {
    if (nameDisplay) nameDisplay.innerHTML = `<span style="color: var(--accent-emerald); font-weight: 700;">HASŁO ODGADNIĘTE!</span>`;
    if (subHint) subHint.innerText = `Prawidłowe hasło: "${state.hangman.word}"`;
    if (avatar) avatar.innerText = '✓';
    if (timerCircle) timerCircle.innerText = 'GG';
  } else if (state.hangman.state === 'lost') {
    if (nameDisplay) nameDisplay.innerHTML = `<span style="color: var(--accent-red); font-weight: 700;">KONIEC SZANS!</span>`;
    if (subHint) subHint.innerText = `Prawidłowe hasło to: "${state.hangman.word}"`;
    if (avatar) avatar.innerText = '✕';
    if (timerCircle) timerCircle.innerText = '0';
  } else {
    if (state.hangman.turnMode === 'chatter') {
      const activeUser = state.hangman.activeChatter;
      if (activeUser) {
        if (nameDisplay) nameDisplay.innerText = `@${activeUser}`;
        if (avatar) avatar.innerText = activeUser.charAt(0).toUpperCase();
        if (subHint) subHint.innerText = 'Wpisz literkę lub całe hasło na czacie!';
      } else {
        if (nameDisplay) nameDisplay.innerText = state.isOverlay ? 'Oczekiwanie na gracza...' : 'Kliknij poniżej "Wylosuj Chatera"';
        if (avatar) avatar.innerText = '?';
        if (subHint) subHint.innerText = 'System wylosuje aktywnego chatera z ostatnich 1-2 minut.';
      }
      if (timerCircle) timerCircle.innerText = state.hangman.turnTimer !== undefined ? state.hangman.turnTimer : '45';
    } else {
      if (nameDisplay) nameDisplay.innerText = 'Czat Zgaduje Razem';
      if (avatar) avatar.innerText = '*';
      if (subHint) subHint.innerText = 'Każdy widz na czacie może podać literkę lub całe hasło!';
      if (timerCircle) timerCircle.innerText = `${state.hangman.livesLeft}`;
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

  const note = isFallback ? '<div style="font-size: 0.75rem; color: var(--accent-amber); padding: 0.35rem; margin-bottom: 0.4rem;">Tryb offline: Ostatni czatujący w bazie</div>' : '';

  container.innerHTML = note + state.activeChatters.map(c => `
    <div class="leader-item" style="cursor: pointer;" onclick="assignTurnToChatter('${c.username}')" title="Kliknij, aby przekazać turę">
      <div class="leader-left">
        <span class="rank-badge" style="background: rgba(145, 70, 255, 0.2); color: var(--twitch-purple-light); font-size: 0.7rem;">CHAT</span>
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
      pushStateToServer(true);
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
    pushStateToServer(false);
    if (state.hangman.turnTimer <= 0) {
      clearInterval(state.hangman.turnInterval);
      showToast(`Czas chatera @${username} minął! Losuję kolejną osobę.`, 'warning');
      rollActiveChatter();
    }
  }, 1000);

  showToast(`Tura chatera: @${username}! Czekam na literkę na czacie...`, 'info');
  pushStateToServer(true);
}

function skipActiveChatter() {
  if (state.hangman.turnInterval) clearInterval(state.hangman.turnInterval);
  showToast('Pominięto gracza (AFK). Losuję następnego...', 'info');
  rollActiveChatter();
}

function toggleTurnMode() {
  state.hangman.turnMode = state.hangman.turnMode === 'chatter' ? 'all' : 'chatter';
  updateTurnModeUI();
  showToast(`Zmieniono tryb na: ${state.hangman.turnMode === 'chatter' ? 'Chatter' : 'Czat Zgaduje Razem'}`, 'info');
  pushStateToServer(true);
}

function updateTurnModeUI() {
  const btn = document.getElementById('btn-turn-mode-toggle');
  const banner = document.getElementById('hangman-chatter-banner');

  if (state.hangman.turnMode === 'chatter') {
    if (btn) btn.innerText = 'Tryb: Chatter';
    if (banner) banner.style.display = 'flex';
  } else {
    if (btn) btn.innerText = 'Tryb: Czat Razem';
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
    launchConfetti(1500);
    showToast(`Trafienie! @${username} odgadł(a) całe hasło: "${state.hangman.word}"! (+500 pkt)`, 'success');
    state.hangman.state = 'won';
    pushStateToServer(true);
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
    showToast(`Trafienie! @${username} odsłonił(a) literę "${guess}"! (+100 pkt)`, 'success');

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
      launchConfetti(1500);
      showToast(`Brawo! Całe hasło zostało odgadnięte: "${state.hangman.word}"!`, 'success');
    }
  } else {
    state.hangman.wrongLetters.add(guess);
    state.hangman.livesLeft = Math.max(0, state.hangman.livesLeft - 1);
    playErrorBuzzer();
    showToast(`Pudło! Litery "${guess}" nie ma w haśle! (-1 życie)`, 'error');

    renderHangmanUI();

    if (state.hangman.livesLeft <= 0) {
      state.hangman.state = 'lost';
      revealHangmanWord();
      showToast(`Koniec szans! Prawidłowe hasło to: "${state.hangman.word}"`, 'error');
    } else {
      if (state.hangman.turnMode === 'chatter') {
        setTimeout(() => rollActiveChatter(), 1200);
      }
    }
  }

  pushStateToServer(true);
}

function revealHangmanWord() {
  for (const ch of state.hangman.word) state.hangman.revealedLetters.add(ch);
  renderHangmanUI();
  pushStateToServer(true);
  showToast(`Odsłonięto hasło: ${state.hangman.word}`, 'info');
}

function openCustomWordModal() {
  const wordInput = document.getElementById('input-custom-word');
  const catInput = document.getElementById('input-custom-cat');
  const hintInput = document.getElementById('input-custom-hint');

  if (wordInput) wordInput.value = '';
  if (catInput) catInput.value = 'Gry Komputerowe';
  if (hintInput) hintInput.value = '';

  updateHangmanManagerUI();
  document.getElementById('modal-custom-word').classList.add('active');
  setTimeout(() => {
    if (wordInput) wordInput.focus();
  }, 50);
}

async function saveCustomWordOnly() {
  const wordInput = document.getElementById('input-custom-word');
  const catInput = document.getElementById('input-custom-cat');
  const hintInput = document.getElementById('input-custom-hint');

  const word = (wordInput ? wordInput.value : '').trim().toUpperCase();
  const cat = (catInput ? catInput.value : '').trim() || 'Gry Komputerowe';
  const hint = (hintInput ? hintInput.value : '').trim();

  if (!word || word.length < 2) {
    showToast('Wpisz hasło o długości przynajmniej 2 liter!', 'error');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/games/hangman/words`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word, category: cat, hint })
    });
    if (res.ok) {
      const data = await res.json();
      if (data.words && Array.isArray(data.words)) {
        state.hangman.wordList = data.words;
      }
    } else {
      const existingIdx = state.hangman.wordList.findIndex(item => item.word.toUpperCase().trim() === word);
      if (existingIdx >= 0) {
        state.hangman.wordList[existingIdx] = { word, category: cat, hint };
      } else {
        state.hangman.wordList.unshift({ word, category: cat, hint });
      }
    }
  } catch (e) {
    const existingIdx = state.hangman.wordList.findIndex(item => item.word.toUpperCase().trim() === word);
    if (existingIdx >= 0) {
      state.hangman.wordList[existingIdx] = { word, category: cat, hint };
    } else {
      state.hangman.wordList.unshift({ word, category: cat, hint });
    }
  }

  saveHangmanWordsList();
  if (wordInput) wordInput.value = '';
  if (hintInput) hintInput.value = '';
  showToast(`Zapisano hasło "${word}" w bazie.`, 'success');
}

async function applyCustomWord() {
  const wordInput = document.getElementById('input-custom-word');
  const catInput = document.getElementById('input-custom-cat');
  const hintInput = document.getElementById('input-custom-hint');

  const word = (wordInput ? wordInput.value : '').trim().toUpperCase();
  const cat = (catInput ? catInput.value : '').trim() || 'Własne Hasło';
  const hint = (hintInput ? hintInput.value : '').trim();

  if (!word || word.length < 2) {
    showToast('Wpisz hasło o długości przynajmniej 2 liter!', 'error');
    return;
  }

  closeModal('modal-custom-word');

  try {
    const res = await fetch(`${API_BASE}/games/hangman/words`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word, category: cat, hint })
    });
    if (res.ok) {
      const data = await res.json();
      if (data.words && Array.isArray(data.words)) {
        state.hangman.wordList = data.words;
        saveHangmanWordsList();
      }
    }
  } catch (e) {}

  setupHangmanWord(word, cat, hint, true);
}

async function loadSavedHangman() {
  const savedList = localStorage.getItem('tm_hangman_words');
  if (savedList) {
    try {
      state.hangman.wordList = JSON.parse(savedList);
    } catch (e) {
      state.hangman.wordList = [];
    }
  }

  try {
    const res = await fetch(`${API_BASE}/games/hangman/words?t=${Date.now()}`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        state.hangman.wordList = data;
        localStorage.setItem('tm_hangman_words', JSON.stringify(data));
      }
    }
  } catch (e) {}

  if (!state.hangman.wordList || state.hangman.wordList.length === 0) {
    state.hangman.wordList = [
      { word: 'WIEDŹMIN DZIKI GON', category: 'Gry Komputerowe', hint: 'Kultowy RPG od CD Projekt Red' }
    ];
  }

  const savedCurrent = localStorage.getItem('tm_hangman_current');
  if (savedCurrent) {
    try {
      const cur = JSON.parse(savedCurrent);
      if (cur && cur.word) {
        state.hangman.word = cur.word.toUpperCase().trim();
        state.hangman.category = cur.category || 'Gry Komputerowe';
        state.hangman.hint = cur.hint || '';
      }
    } catch (e) {}
  } else if (!state.hangman.word && state.hangman.wordList.length > 0) {
    state.hangman.word = state.hangman.wordList[0].word.toUpperCase().trim();
    state.hangman.category = state.hangman.wordList[0].category || 'Gry Komputerowe';
    state.hangman.hint = state.hangman.wordList[0].hint || '';
  }

  updateHangmanManagerUI();
}

function saveHangmanCurrent(word, category, hint) {
  const normWord = (word || '').toUpperCase().trim();
  const cat = (category || 'Gry Komputerowe').trim();
  const h = (hint || '').trim();

  localStorage.setItem('tm_hangman_current', JSON.stringify({ word: normWord, category: cat, hint: h }));

  if (normWord.length >= 2) {
    if (!Array.isArray(state.hangman.wordList)) state.hangman.wordList = [];
    const existingIdx = state.hangman.wordList.findIndex(item => item.word.toUpperCase().trim() === normWord);
    if (existingIdx >= 0) {
      state.hangman.wordList[existingIdx] = { ...state.hangman.wordList[existingIdx], word: normWord, category: cat, hint: h };
    } else {
      state.hangman.wordList.unshift({ word: normWord, category: cat, hint: h });
    }
    saveHangmanWordsList();
  }
}

function saveHangmanWordsList() {
  localStorage.setItem('tm_hangman_words', JSON.stringify(state.hangman.wordList));
  updateHangmanManagerUI();
}

function updateHangmanManagerUI() {
  const count = (state.hangman.wordList && Array.isArray(state.hangman.wordList)) ? state.hangman.wordList.length : 0;
  const btnCount = document.getElementById('btn-count-loaded-words');
  if (btnCount) {
    btnCount.innerText = `Baza Haseł (${count})`;
  }
  const modalCount = document.getElementById('hangman-saved-count');
  if (modalCount) {
    modalCount.innerText = `${count} haseł`;
  }
  renderSavedHangmanWords();

  // Sidebar Quick List for Hangman
  const quickList = document.getElementById('quick-hangman-list');
  if (quickList) {
    if (count === 0) {
      quickList.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 1rem; font-size: 0.8rem;">Brak haseł. Kliknij "Zarządzaj" powyżej.</div>';
    } else {
      quickList.innerHTML = state.hangman.wordList.map((item, idx) => {
        const isCurrent = (item.word.toUpperCase().trim() === (state.hangman.word || '').toUpperCase().trim());
        return `
          <div class="leader-item ${isCurrent ? 'rank-1' : ''}" style="cursor: pointer;" onclick="loadHangmanWordFromBank(${idx})" title="Kliknij, aby natychmiast uruchomić to hasło">
            <div class="leader-left">
              <span class="rank-badge">${idx + 1}</span>
              <span class="leader-name" style="font-size: 0.825rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px;">
                ${escapeHtml(item.word)}
              </span>
            </div>
            <span style="font-size: 0.7rem; color: var(--text-muted); white-space: nowrap;">${escapeHtml(item.category || '')}</span>
          </div>
        `;
      }).join('');
    }
  }
}

function renderSavedHangmanWords() {
  const container = document.getElementById('hangman-saved-list');
  if (!container) return;

  if (!state.hangman.wordList || state.hangman.wordList.length === 0) {
    container.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 1.5rem; font-size: 0.85rem;">Brak zapisanych haseł w bazie serwera. Wpisz hasło powyżej i kliknij "Zapisz w Bazie".</div>';
    return;
  }

  container.innerHTML = state.hangman.wordList.map((item, idx) => {
    const isCurrent = (item.word.toUpperCase().trim() === (state.hangman.word || '').toUpperCase().trim());
    return `
      <div class="hangman-word-card ${isCurrent ? 'active' : ''}">
        <div style="flex: 1; min-width: 0;">
          <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.2rem; flex-wrap: wrap;">
            <span class="rank-badge" style="width: 22px; height: 22px; font-size: 0.72rem; display: inline-flex; align-items: center; justify-content: center;">${idx + 1}</span>
            <span class="category-tag" style="font-size: 0.68rem; padding: 0.15rem 0.45rem;">${escapeHtml(item.category || 'Ogólne')}</span>
            <span style="font-weight: 700; font-size: 0.925rem; color: #fff; font-family: 'Fredoka', 'Montserrat', sans-serif; letter-spacing: 0.03em;">
              ${escapeHtml(item.word)}
            </span>
            ${isCurrent ? '<span style="color: var(--twitch-purple-light); font-size: 0.72rem; font-weight: 700;">(AKTYWNE)</span>' : ''}
          </div>
          ${item.hint ? `<div style="font-size: 0.75rem; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-left: 1.85rem;">Podpowiedź: ${escapeHtml(item.hint)}</div>` : ''}
        </div>
        <div style="display: flex; gap: 0.45rem; align-items: center; flex-shrink: 0;">
          <button class="btn btn-secondary" onclick="loadHangmanWordFromBank(${idx})" title="Uruchom to hasło" style="font-size: 0.78rem; padding: 0.35rem 0.65rem;">
            Wybierz
          </button>
          <button class="btn btn-danger btn-icon" onclick="deleteSavedHangmanWord(${idx}, event)" title="Usuń z bazy" style="padding: 0.35rem 0.5rem;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function selectSavedHangmanWord(idx) {
  const item = state.hangman.wordList[idx];
  if (!item) return;

  const wordInput = document.getElementById('input-custom-word');
  const catInput = document.getElementById('input-custom-cat');
  const hintInput = document.getElementById('input-custom-hint');

  if (wordInput) wordInput.value = item.word;
  if (catInput) catInput.value = item.category || '';
  if (hintInput) hintInput.value = item.hint || '';

  showToast(`Wypełniono formularz hasłem: ${item.word}`, 'info');
}

function loadHangmanWordFromBank(idx) {
  const item = state.hangman.wordList[idx];
  if (!item) return;

  closeModal('modal-custom-word');
  setupHangmanWord(item.word, item.category || 'Gry Komputerowe', item.hint || '', true);
  updateHangmanManagerUI();
}

async function deleteSavedHangmanWord(idx, ev) {
  if (ev) ev.stopPropagation();
  if (idx < 0 || idx >= state.hangman.wordList.length) return;

  const item = state.hangman.wordList[idx];
  const wordName = item.word;
  const wordId = item.id;

  state.hangman.wordList.splice(idx, 1);
  saveHangmanWordsList();

  if (wordId) {
    try {
      const res = await fetch(`${API_BASE}/games/hangman/words/${wordId}`, { method: 'DELETE' });
      if (res.ok) {
        const data = await res.json();
        if (data.words && Array.isArray(data.words)) {
          state.hangman.wordList = data.words;
          saveHangmanWordsList();
        }
      }
    } catch (e) {}
  }

  showToast(`Usunięto hasło "${wordName}" z bazy.`, 'info');
}

async function clearAllHangmanWords() {
  if (confirm('Czy na pewno chcesz usunąć wszystkie zapisane hasła do Wisielca z bazy danych?')) {
    state.hangman.wordList = [];
    localStorage.removeItem('tm_hangman_words');
    saveHangmanWordsList();
    try {
      await fetch(`${API_BASE}/games/hangman/words`, { method: 'DELETE' });
    } catch (e) {}
    showToast('Wyczyszczono bazę haseł Wisielca.', 'info');
  }
}

// Leaderboard & CSV Export
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

  try {
    // Generate CSV directly on client with UTF-8 BOM and semicolon delimiter (Polish/European Excel friendly)
    let csvContent = '\uFEFF';
    csvContent += 'Pozycja;Widz (Nick);Punkty;Poprawne Odpowiedzi;Skuteczność (%)\r\n';
    entries.forEach((e, idx) => {
      const correct = (e.correctQuiz || 0) + (e.correctLetters || 0);
      const safeNick = (e.username || '').replace(/"/g, '""');
      csvContent += `${idx + 1};"${safeNick}";${e.score || 0};${correct};100%\r\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
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

    showToast("Plik CSV został pomyślnie wygenerowany i pobrany!", "success");
  } catch (err) {
    showToast(`Błąd eksportu: ${err.message}`, "error");
  }
}

// OBS Modals & URL Generator
function openOBSModal() {
  updateOBSUrls();
  document.getElementById('modal-obs').classList.add('active');
}

function updateOBSUrls() {
  const base = `${window.location.origin}${window.location.pathname}`;
  const pwdParam = state.authPassword ? `&password=${encodeURIComponent(state.authPassword)}` : '';

  const autoInput = document.getElementById('obs-url-auto');
  const quizInput = document.getElementById('obs-url-quiz');
  const giveawayInput = document.getElementById('obs-url-giveaway');
  const hangmanInput = document.getElementById('obs-url-hangman');

  if (autoInput) autoInput.value = `${base}?overlay=1${pwdParam}`;
  if (quizInput) quizInput.value = `${base}?overlay=1&game=quiz${pwdParam}`;
  if (giveawayInput) giveawayInput.value = `${base}?overlay=1&game=giveaway${pwdParam}`;
  if (hangmanInput) hangmanInput.value = `${base}?overlay=1&game=hangman${pwdParam}`;
}

function copyOBSUrl(gameType) {
  const inputMap = {
    auto: 'obs-url-auto',
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
  toast.className = `toast-message`;
  toast.innerHTML = `<span class="toast-dot ${type}"></span><span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 200);
  }, 3500);
}

// Simulator czatu do testow lokalnych bez odpalania Twitcha
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
