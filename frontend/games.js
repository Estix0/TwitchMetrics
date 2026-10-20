/**
 * TwitchStreamGames - Frontend Engine
 * Real-time Twitch Chat Quiz, Word Guesser ("Wybraniec Czatu") & OBS Overlay
 */

// ============================================================================
// APP & GAME STATE
// ============================================================================
const state = {
  activeGame: 'quiz', // 'quiz' | 'hangman' | 'leaderboard'
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
    question: '',
    category: 'Gry',
    type: 'choice',
    options: [
      { key: 'A', text: '' },
      { key: 'B', text: '' },
      { key: 'C', text: '' },
      { key: 'D', text: '' }
    ],
    correctAnswer: 'A',
    state: 'idle', // 'idle' | 'active' | 'revealed'
    timerVal: 30,
    timerMax: 30,
    timerInterval: null,
    answers: new Map(), // username -> { answer, timestamp, isCorrect }
    packIndex: 0,
    activePack: 'gaming'
  },

  hangman: {
    word: 'WIEDŹMIN TRZY',
    category: 'Gry Komputerowe',
    hint: 'Kultowa polska produkcja RPG',
    revealedLetters: new Set(),
    wrongLetters: new Set(),
    livesLeft: 6,
    maxLives: 6,
    state: 'idle', // 'idle' | 'playing' | 'won' | 'lost'
    turnMode: 'chatter', // 'chatter' (Wybraniec) | 'all' (Czat Razem)
    activeChatter: null, // username of chosen active chatter
    activeChatterInfo: null,
    turnTimer: 45,
    turnInterval: null
  },

  leaderboard: new Map() // username -> { score, correctQuiz, correctLetters, lastActive }
};

const API_BASE = window.location.protocol === 'file:' ? 'http://localhost:8000/api' : '/api';

// ============================================================================
// AUDIO SYNTHESIZER (Web Audio API - Zero External Audio Files Required)
// ============================================================================
let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
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
    
    // 3-note ascending chime (C5 -> E5 -> G5)
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.09);
      gain.gain.setValueAtTime(0.18, now + idx * 0.09);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.09 + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.09);
      osc.stop(now + idx * 0.09 + 0.36);
    });
  } catch (e) {
    console.warn("Audio error:", e);
  }
}

function playErrorBuzzer() {
  if (!state.soundEnabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    
    // Low saw buzzer
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.setValueAtTime(110, now + 0.15);
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.36);
  } catch (e) {
    console.warn("Audio error:", e);
  }
}

function playTickSound() {
  if (!state.soundEnabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(800, now);
    gain.gain.setValueAtTime(0.05, now);
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
    // Victorious fanfare: G4 -> C5 -> E5 -> G5 -> C6
    const freqs = [392.00, 523.25, 659.25, 783.99, 1046.50];
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, now + i * 0.12);
      gain.gain.setValueAtTime(0.2, now + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.12);
      osc.stop(now + i * 0.12 + 0.52);
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
// CANVAS CONFETTI EFFECT (Stream Victory & Round Win)
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
      y: Math.random() * -canvas.height * 0.5,
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
// PRESET QUESTION & WORD PACKS
// ============================================================================
const QUESTION_PACKS = {
  gaming: [
    {
      q: "W którym roku odbyła się oficjalna premiera gry Wiedźmin 3: Dziki Gon?",
      cat: "🎮 Gry & Gaming",
      options: [
        { key: "A", text: "2013" },
        { key: "B", text: "2014" },
        { key: "C", text: "2015" },
        { key: "D", text: "2016" }
      ],
      correct: "C"
    },
    {
      q: "Jak nazywa się główny protagonista serii gier GTA: San Andreas?",
      cat: "🎮 Gry & Gaming",
      options: [
        { key: "A", text: "Tommy Vercetti" },
        { key: "B", text: "Carl 'CJ' Johnson" },
        { key: "C", text: "Franklin Clinton" },
        { key: "D", text: "Niko Bellic" }
      ],
      correct: "B"
    },
    {
      q: "Z ilu graczy składa się standardowa drużyna na Summoner's Rift w League of Legends?",
      cat: "🎮 Gry & Gaming",
      options: [
        { key: "A", text: "4 graczy" },
        { key: "B", text: "5 graczy" },
        { key: "C", text: "6 graczy" },
        { key: "D", text: "3 graczy" }
      ],
      correct: "B"
    },
    {
      q: "W jakiej grze najwyższa ranga w trybie turniejowym to 'The Global Elite'?",
      cat: "🎮 Gry & Gaming",
      options: [
        { key: "A", text: "Valorant" },
        { key: "B", text: "Counter-Strike" },
        { key: "C", text: "Apex Legends" },
        { key: "D", text: "Rainbow Six Siege" }
      ],
      correct: "B"
    },
    {
      q: "Który blok w Minecraft jest wymagany do stworzenia portalu do Netheru?",
      cat: "🎮 Gry & Gaming",
      options: [
        { key: "A", text: "Obsydian" },
        { key: "B", text: "Bedrock" },
        { key: "C", text: "Bruk (Cobblestone)" },
        { key: "D", text: "Crying Obsidian" }
      ],
      correct: "A"
    }
  ],
  twitch: [
    {
      q: "Jaka emotka na Twitchu jest uniwersalnym symbolem sarkazmu i ironii?",
      cat: "📺 Twitch & Memy",
      options: [
        { key: "A", text: "Kappa" },
        { key: "B", text: "PogChamp" },
        { key: "C", text: "LUL" },
        { key: "D", text: "KEKW" }
      ],
      correct: "A"
    },
    {
      q: "Co oznacza popularny skrót 'AFK' używany w grach i na czacie?",
      cat: "📺 Twitch & Memy",
      options: [
        { key: "A", text: "Away From Keyboard" },
        { key: "B", text: "Always Fast Kill" },
        { key: "C", text: "All For Kings" },
        { key: "D", text: "Another Free Kill" }
      ],
      correct: "A"
    },
    {
      q: "Kto był bohaterem legendarnego hiszpańskiego mema i emotki 'KEKW'?",
      cat: "📺 Twitch & Memy",
      options: [
        { key: "A", text: "El Risitas" },
        { key: "B", text: "GigaChad" },
        { key: "C", text: "Hide The Pain Harold" },
        { key: "D", text: "Ricardo Milos" }
      ],
      correct: "A"
    },
    {
      q: "Jakiego koloru jest domyślna odznaka Moderatora na Twitchu?",
      cat: "📺 Twitch & Memy",
      options: [
        { key: "A", text: "Fioletowy" },
        { key: "B", text: "Zielony z mieczem" },
        { key: "C", text: "Złoty z koroną" },
        { key: "D", text: "Różowy diament" }
      ],
      correct: "B"
    }
  ],
  popculture: [
    {
      q: "Kto zagrał postać Tony'ego Starka (Iron Mana) w Marvel Cinematic Universe?",
      cat: "🎬 Popkultura",
      options: [
        { key: "A", text: "Chris Evans" },
        { key: "B", text: "Robert Downey Jr." },
        { key: "C", text: "Chris Hemsworth" },
        { key: "D", text: "Mark Ruffalo" }
      ],
      correct: "B"
    },
    {
      q: "Do którego domu w Hogwarcie należał Harry Potter?",
      cat: "🎬 Popkultura",
      options: [
        { key: "A", text: "Slytherin" },
        { key: "B", text: "Ravenclaw" },
        { key: "C", text: "Hufflepuff" },
        { key: "D", text: "Gryffindor" }
      ],
      correct: "D"
    },
    {
      q: "Jak miał na imię hobbit, który niósł Jedyny Pierścień do Mordoru?",
      cat: "🎬 Popkultura",
      options: [
        { key: "A", text: "Samwise Gamgee" },
        { key: "B", text: "Frodo Baggins" },
        { key: "C", text: "Peregrin Tuk" },
        { key: "D", text: "Bilbo Baggins" }
      ],
      correct: "B"
    }
  ],
  general: [
    {
      q: "Jaka jest stolica Australii?",
      cat: "🧠 Wiedza Ogólna",
      options: [
        { key: "A", text: "Sydney" },
        { key: "B", text: "Melbourne" },
        { key: "C", text: "Canberra" },
        { key: "D", text: "Brisbane" }
      ],
      correct: "C"
    },
    {
      q: "Ile minut trwa jedna połowa w standardowym meczu piłki nożnej?",
      cat: "🧠 Wiedza Ogólna",
      options: [
        { key: "A", text: "40 minut" },
        { key: "B", text: "45 minut" },
        { key: "C", text: "50 minut" },
        { key: "D", text: "60 minut" }
      ],
      correct: "B"
    },
    {
      q: "Który pierwiastek chemiczny ma symbol 'Au' w układzie okresowym?",
      cat: "🧠 Wiedza Ogólna",
      options: [
        { key: "A", text: "Srebro" },
        { key: "B", text: "Złoto" },
        { key: "C", text: "Aluminium" },
        { key: "D", text: "Miedź" }
      ],
      correct: "B"
    }
  ]
};

const WORD_PRESETS = {
  gry: [
    { word: "WIEDZMIN DZIKI GON", cat: "🎮 Gry Komputerowe", hint: "Geralt z Rivii i Ciri" },
    { word: "CYBERPUNK DWA TYSIACE", cat: "🎮 Gry Komputerowe", hint: "Night City i Keanu Reeves" },
    { word: "LEAGUE OF LEGENDS", cat: "🎮 Gry Komputerowe", hint: "Najpopularniejsza MOBA na świecie" },
    { word: "COUNTER STRIKE DWA", cat: "🎮 Gry Komputerowe", hint: "Terroryści kontra Antyterroryści" },
    { word: "MINECRAFT", cat: "🎮 Gry Komputerowe", hint: "Sześcienny świat i Creepery" },
    { word: "BALDURS GATE TRZY", cat: "🎮 Gry Komputerowe", hint: "Gra roku RPG od Larian Studios" }
  ],
  filmy: [
    { word: "WLADCA PIERSCIENI", cat: "🎬 Filmy & Kino", hint: "Drużyna Pierścienia i Mordor" },
    { word: "GWIEZDNE WOJNY", cat: "🎬 Filmy & Kino", hint: "Niech Moc będzie z Tobą" },
    { word: "INTERSTELLAR", cat: "🎬 Filmy & Kino", hint: "Czarna dziura i podróż kosmiczna" },
    { word: "PIRACI Z KARAIBOW", cat: "🎬 Filmy & Kino", hint: "Kapitan Jack Sparrow" }
  ],
  jedzenie: [
    { word: "PIEROGI RUSKIE", cat: "🍕 Jedzenie & Kuchnia", hint: "Klasyk z twarogiem i ziemniakami" },
    { word: "KOCIOLEK PANORAMIKSA", cat: "🍕 Jedzenie & Kuchnia", hint: "Daje nadludzką siłę Galom" },
    { word: "PIZZA MARGHERITA", cat: "🍕 Jedzenie & Kuchnia", hint: "Sos pomidorowy, mozzarella i bazylia" },
    { word: "SERNIK Z RODZYNKAMI", cat: "🍕 Jedzenie & Kuchnia", hint: "Odwieczny spór przy wigilijnym stole" }
  ],
  przyslowia: [
    { word: "BEZ PRACY NIE MA KOLACZY", cat: "🇵🇱 Polskie Przysłowia", hint: "O wysiłku i nagrodzie" },
    { word: "LEPSZY WROBEL W GARSCI", cat: "🇵🇱 Polskie Przysłowia", hint: "...niż gołąb na dachu" },
    { word: "KTO RANO WSTAJE", cat: "🇵🇱 Polskie Przysłowia", hint: "...temu Pan Bóg daje" }
  ],
  twitch: [
    { word: "MODERATOR CZATU", cat: "📺 Twitch & Społeczność", hint: "Pilnuje porządku zielonym mieczem" },
    { word: "RAID NA STREAMA", cat: "📺 Twitch & Społeczność", hint: "Przejście z widzami na inny kanał" },
    { word: "EMOTKA KANALOWA", cat: "📺 Twitch & Społeczność", hint: "Dostępna po wykupieniu suba" }
  ],
  zwierzeta: [
    { word: "PANDA WIELKA", cat: "🦁 Zwierzęta & Przyroda", hint: "Żywi się pędami bambusa" },
    { word: "ORZEL BIELIK", cat: "🦁 Zwierzęta & Przyroda", hint: "Symbol narodowy Polski" },
    { word: "DELFIN BUTLONOSY", cat: "🦁 Zwierzęta & Przyroda", hint: "Inteligentny ssak morski" }
  ]
};

// ============================================================================
// INITIALIZATION
// ============================================================================
window.addEventListener('DOMContentLoaded', async () => {
  // Setup BroadcastChannel for instant same-browser multi-tab sync
  if ('BroadcastChannel' in window) {
    state.syncChannel = new BroadcastChannel('twitch_games_sync');
    state.syncChannel.onmessage = (ev) => {
      handleSyncMessage(ev.data);
    };
  }

  // Check Overlay Mode
  if (state.isOverlay) {
    document.body.classList.add('overlay-mode');
    switchGameMode(state.targetGame);
  } else {
    updateOBSUrls();
  }

  // Load Status & Initial latest message ID
  await fetchStatusInfo();
  await initLatestMsgId();

  // Load Initial Quiz Question
  loadQuestionPack('gaming', 0);

  // Load Initial Hangman Word
  loadRandomWordPreset();

  // Start Real-Time Chat Polling
  startChatPolling();
});

function handleSyncMessage(msg) {
  if (!msg || !msg.type) return;
  if (msg.type === 'QUIZ_UPDATE') {
    Object.assign(state.quiz, msg.payload);
    renderQuizUI();
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
      const headers = {};
      if (state.authPassword) headers['X-Panel-Password'] = state.authPassword;

      const url = `${API_BASE}/games/recent-messages?since_id=${state.latestMsgId}&limit=100`;
      const res = await fetch(url, { headers });
      if (!res.ok) return;

      const data = await res.json();
      if (data.messages && data.messages.length > 0) {
        state.latestMsgId = data.max_id;
        for (const msg of data.messages) {
          processIncomingMessage(msg);
        }
      }
    } catch (e) {
      // Quiet background polling
    }
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

  // 2. Process for Active Hangman ("Wybraniec Czatu")
  if (state.activeGame === 'hangman' && state.hangman.state === 'playing') {
    handleHangmanMessage(user, rawText);
  }
}

// ============================================================================
// QUIZ ENGINE
// ============================================================================
function loadQuestionPack(packName, index = 0) {
  if (!QUESTION_PACKS[packName] || QUESTION_PACKS[packName].length === 0) return;
  state.quiz.activePack = packName;
  state.quiz.packIndex = index % QUESTION_PACKS[packName].length;
  const qData = QUESTION_PACKS[packName][state.quiz.packIndex];

  state.quiz.question = qData.q;
  state.quiz.category = qData.cat;
  state.quiz.options = JSON.parse(JSON.stringify(qData.options));
  state.quiz.correctAnswer = qData.correct.toUpperCase();
  state.quiz.state = 'idle';
  state.quiz.answers.clear();

  renderQuizUI();
  broadcastSync('QUIZ_UPDATE', state.quiz);
  showToast(`Załadowano pytanie ${state.quiz.packIndex + 1}/${QUESTION_PACKS[packName].length}`, 'info');
}

function loadNextPresetQuestion() {
  const pack = state.quiz.activePack || 'gaming';
  loadQuestionPack(pack, state.quiz.packIndex + 1);
}

function startQuizRound() {
  state.quiz.state = 'active';
  state.quiz.answers.clear();

  const timeSelect = document.getElementById('select-quiz-time');
  const duration = parseInt(timeSelect ? timeSelect.value : '30', 10);
  state.quiz.timerMax = duration;
  state.quiz.timerVal = duration;

  // Clear podium and logs
  const podium = document.getElementById('quiz-round-podium');
  if (podium) podium.style.display = 'none';

  const log = document.getElementById('quiz-live-log');
  if (log) log.innerHTML = '';

  renderQuizUI();
  broadcastSync('QUIZ_UPDATE', state.quiz);

  // Host buttons state
  document.getElementById('btn-quiz-start').disabled = true;
  document.getElementById('btn-quiz-reveal').disabled = false;

  playSuccessChime();
  showToast('Runda rozpoczęta! Czat może odpowiadać wpisując A, B, C lub D.', 'success');

  // Start countdown if not manual
  if (state.quiz.timerInterval) clearInterval(state.quiz.timerInterval);
  if (duration > 0) {
    state.quiz.timerInterval = setInterval(() => {
      state.quiz.timerVal--;
      if (state.quiz.timerVal <= 5 && state.quiz.timerVal > 0) {
        playTickSound();
      }

      updateQuizTimerUI();

      if (state.quiz.timerVal <= 0) {
        clearInterval(state.quiz.timerInterval);
        revealQuizAnswer();
      }
    }, 1000);
  }
}

function updateQuizTimerUI() {
  const badge = document.getElementById('quiz-timer-badge');
  const sec = document.getElementById('quiz-timer-sec');
  const fill = document.getElementById('quiz-timer-fill');

  if (sec) sec.innerText = state.quiz.timerVal;
  if (fill && state.quiz.timerMax > 0) {
    const pct = Math.max(0, (state.quiz.timerVal / state.quiz.timerMax) * 100);
    fill.style.width = `${pct}%`;
    if (pct < 25) {
      fill.style.background = 'var(--accent-red)';
    } else if (pct < 50) {
      fill.style.background = 'var(--accent-amber)';
    } else {
      fill.style.background = 'linear-gradient(90deg, var(--twitch-purple), var(--accent-cyan))';
    }
  }

  if (badge) {
    if (state.quiz.timerVal <= 5 && state.quiz.timerVal > 0) {
      badge.classList.add('danger');
    } else {
      badge.classList.remove('danger');
    }
  }
}

function handleQuizMessage(username, text) {
  // Only first answer counts!
  if (state.quiz.answers.has(username)) return;

  // Extract letter from message (e.g. "a", "Odp B", "C)", "d.")
  const clean = text.toUpperCase().replace(/[^A-D]/g, '');
  let chosenKey = null;

  if (clean.length > 0 && ['A', 'B', 'C', 'D'].includes(clean[0])) {
    chosenKey = clean[0];
  } else {
    // Check if chatter typed exact text of option
    for (const opt of state.quiz.options) {
      if (opt.text && text.toLowerCase().includes(opt.text.toLowerCase())) {
        chosenKey = opt.key;
        break;
      }
    }
  }

  if (!chosenKey) return;

  const isCorrect = chosenKey === state.quiz.correctAnswer;
  state.quiz.answers.set(username, {
    answer: chosenKey,
    timestamp: Date.now(),
    isCorrect
  });

  // Update live counter badge
  const totalBadge = document.getElementById('live-answers-total-badge');
  if (totalBadge) totalBadge.innerText = state.quiz.answers.size;

  // Add entry to live stream log
  const log = document.getElementById('quiz-live-log');
  if (log) {
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.innerHTML = `<span><strong>@${username}</strong> wybrał(a):</span><span style="font-weight: 800; color: var(--twitch-purple-light);">${chosenKey}</span>`;
    log.prepend(entry);
    if (log.children.length > 30) log.lastElementChild.remove();
  }

  // Update vote distribution counts
  updateOptionCounts();
  playTickSound();
}

function updateOptionCounts() {
  const counts = { A: 0, B: 0, C: 0, D: 0 };
  state.quiz.answers.forEach(val => {
    if (counts[val.answer] !== undefined) counts[val.answer]++;
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
}

function revealQuizAnswer() {
  if (state.quiz.timerInterval) clearInterval(state.quiz.timerInterval);
  state.quiz.state = 'revealed';

  // Highlight correct and wrong options
  const correctKey = state.quiz.correctAnswer;
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

  // Calculate scores & round podium
  const correctChatters = [];
  state.quiz.answers.forEach((val, user) => {
    if (val.isCorrect) {
      correctChatters.push({ user, timestamp: val.timestamp });
    }
  });

  // Sort by speed
  correctChatters.sort((a, b) => a.timestamp - b.timestamp);

  // Award Leaderboard Points
  correctChatters.forEach((item, idx) => {
    const bonus = idx === 0 ? 50 : (idx === 1 ? 30 : (idx === 2 ? 15 : 0));
    const roundPts = 100 + bonus;
    addPointsToUser(item.user, roundPts, true, false);
  });

  // Update Round Podium UI
  const podiumCard = document.getElementById('quiz-round-podium');
  const podiumLetter = document.getElementById('podium-correct-letter');
  const podiumSub = document.getElementById('podium-stats-sub');
  const podiumList = document.getElementById('podium-list');

  if (podiumCard && podiumList) {
    podiumCard.style.display = 'block';
    if (podiumLetter) podiumLetter.innerText = correctKey;
    if (podiumSub) podiumSub.innerText = `${correctChatters.length} poprawnych odpowiedzi (na ${state.quiz.answers.size} czatujących)`;

    podiumList.innerHTML = correctChatters.slice(0, 5).map((c, i) => `
      <div style="background: rgba(0,0,0,0.35); padding: 0.4rem 0.85rem; border-radius: var(--radius-md); border: 1px solid rgba(16,185,129,0.3); font-size: 0.85rem; display: flex; align-items: center; gap: 0.4rem;">
        <span>${i === 0 ? '🥇' : (i === 1 ? '🥈' : (i === 2 ? '🥉' : '🎖️'))}</span>
        <strong>@${c.user}</strong>
        <span style="color: var(--accent-emerald); font-weight: 700;">+${100 + (i === 0 ? 50 : (i === 1 ? 30 : (i === 2 ? 15 : 0)))} pkt</span>
      </div>
    `).join('') || '<div style="color: var(--text-muted); font-size: 0.85rem;">Nikt nie udzielił poprawnej odpowiedzi w tej rundzie!</div>';
  }

  // Host buttons state
  document.getElementById('btn-quiz-start').disabled = false;
  document.getElementById('btn-quiz-reveal').disabled = true;

  playFanfare();
  launchConfetti(3500);
  broadcastSync('QUIZ_UPDATE', state.quiz);
}

function renderQuizUI() {
  document.getElementById('quiz-category-display').innerText = state.quiz.category;
  document.getElementById('quiz-question-display').innerText = state.quiz.question;

  state.quiz.options.forEach(opt => {
    const textEl = document.getElementById(`opt-text-${opt.key}`);
    if (textEl) textEl.innerText = opt.text;
  });

  // Reset option cards highlight
  document.querySelectorAll('.option-card').forEach(card => {
    card.classList.remove('correct', 'wrong');
  });

  updateOptionCounts();
  updateQuizTimerUI();
}

function openAddQuestionModal() {
  document.getElementById('modal-add-question').classList.add('active');
}

function applyCustomQuestion() {
  const cat = document.getElementById('input-q-category').value.trim() || 'Własne Pytanie';
  const q = document.getElementById('input-q-text').value.trim();
  const a = document.getElementById('input-q-opt-A').value.trim();
  const b = document.getElementById('input-q-opt-B').value.trim();
  const c = document.getElementById('input-q-opt-C').value.trim();
  const d = document.getElementById('input-q-opt-D').value.trim();
  const correct = document.getElementById('input-q-correct').value;

  if (!q || !a || !b) {
    showToast('Wpisz treść pytania oraz przynajmniej opcje A i B!', 'error');
    return;
  }

  state.quiz.question = q;
  state.quiz.category = cat;
  state.quiz.options = [
    { key: 'A', text: a },
    { key: 'B', text: b },
    { key: 'C', text: c || '-' },
    { key: 'D', text: d || '-' }
  ];
  state.quiz.correctAnswer = correct;
  state.quiz.state = 'idle';
  state.quiz.answers.clear();

  closeModal('modal-add-question');
  renderQuizUI();
  broadcastSync('QUIZ_UPDATE', state.quiz);
  showToast('Pomyślnie ustawiono nowe pytanie!', 'success');
}

// ============================================================================
// WISIELEC / ZGADYWANKA SŁOWNA ("WYBRANIEC CZATU")
// ============================================================================
function loadRandomWordPreset() {
  const categories = Object.keys(WORD_PRESETS);
  const cat = categories[Math.floor(Math.random() * categories.length)];
  loadWordFromCategory(cat);
}

function loadWordFromCategory(catKey) {
  const list = WORD_PRESETS[catKey];
  if (!list || list.length === 0) return;
  const item = list[Math.floor(Math.random() * list.length)];

  setupHangmanWord(item.word, item.cat, item.hint);
}

function setupHangmanWord(word, category = 'Gry', hint = '') {
  state.hangman.word = word.toUpperCase().trim();
  state.hangman.category = category;
  state.hangman.hint = hint;
  state.hangman.revealedLetters.clear();
  state.hangman.wrongLetters.clear();
  state.hangman.livesLeft = state.hangman.maxLives;
  state.hangman.state = 'playing';

  // Automatically reveal spaces, hyphens and punctuation
  for (const ch of state.hangman.word) {
    if (!ch.match(/[A-ZĄĆĘŁŃÓŚŹŻ]/i)) {
      state.hangman.revealedLetters.add(ch);
    }
  }

  renderHangmanUI();
  broadcastSync('HANGMAN_UPDATE', state.hangman);
  showToast(`Rozpoczęto hasło z kategorii: ${category}`, 'info');

  // Automatically roll active chatter if in Wybraniec mode
  if (state.hangman.turnMode === 'chatter') {
    rollActiveChatter();
  }
}

function renderHangmanUI() {
  // Category & Hint
  const catDisplay = document.getElementById('hangman-category-display');
  const hintDisplay = document.getElementById('hangman-hint-display');
  if (catDisplay) catDisplay.innerText = state.hangman.category;
  if (hintDisplay) hintDisplay.innerText = state.hangman.hint ? `💡 Podpowiedź: ${state.hangman.hint}` : '';

  // Hearts / Lives
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

  // Word Board Tiles (Segmented by words for clean line breaks)
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

      // Add space tile between words
      if (wIdx < words.length - 1) {
        const spaceTile = document.createElement('div');
        spaceTile.className = 'letter-tile space';
        board.appendChild(spaceTile);
      }
    });
  }

  // Wrong letters chips
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

// -------------------------------------------------------------
// FEATURE: WYBRANIEC CZATU (Active Chatter Roller)
// -------------------------------------------------------------
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
    if (!res.ok) throw new Error("Błąd pobierania aktywnych widzów");
    const data = await res.json();
    state.activeChatters = data.active_chatters || [];

    let chosen = data.random_pick;
    if (!chosen && state.activeChatters.length > 0) {
      chosen = state.activeChatters[0].username;
    }

    if (!chosen) {
      showToast('Brak aktywnych osób na czacie w ostatnich 1-2 minutach! Przełączam w tryb otwarty.', 'warning');
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
  
  // Find stats
  const info = state.activeChatters.find(c => c.username.toLowerCase() === username.toLowerCase());
  state.hangman.activeChatterInfo = info;

  // Update Banner UI
  const avatar = document.getElementById('chatter-avatar-initial');
  const nameDisplay = document.getElementById('chatter-name-display');
  const subHint = document.getElementById('chatter-sub-hint');

  if (avatar) avatar.innerText = username.charAt(0).toUpperCase();
  if (nameDisplay) nameDisplay.innerText = `@${username}`;
  if (subHint) {
    const msgCount = info ? `${info.msg_count} wiadomości w ostatnich minutach` : 'Aktywny widz';
    subHint.innerText = `${msgCount} • Wpisz literkę lub całe hasło na czacie!`;
  }

  // Turn timer 45s
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
  // If turn-based, only allow messages from the designated chatter!
  if (state.hangman.turnMode === 'chatter') {
    if (!state.hangman.activeChatter || username.toLowerCase() !== state.hangman.activeChatter) {
      return;
    }
  }

  const clean = text.toUpperCase().trim();
  if (!clean) return;

  // Case A: Chatter guessed the entire phrase!
  const targetNormalized = state.hangman.word.replace(/\s+/g, ' ');
  if (clean === targetNormalized || clean.replace(/\s+/g, '') === targetNormalized.replace(/\s+/g, '')) {
    // WINNER GUESS!
    for (const ch of state.hangman.word) {
      state.hangman.revealedLetters.add(ch);
    }
    renderHangmanUI();
    addPointsToUser(username, 500, false, true);

    playFanfare();
    launchConfetti(4500);
    showToast(`🎉 NIESAMOWITE! @${username} odgadł(a) całe hasło: "${state.hangman.word}"! (+500 pkt)`, 'success');
    state.hangman.state = 'won';
    broadcastSync('HANGMAN_UPDATE', state.hangman);
    return;
  }

  // Case B: Chatter guessed a single letter
  // Take first alphabetical character (Polish characters supported: A-Z, Ą, Ć, Ę, Ł, Ń, Ó, Ś, Ź, Ż)
  const letters = clean.match(/[A-ZĄĆĘŁŃÓŚŹŻ]/gi);
  if (!letters || letters.length === 0) return;
  const guess = letters[0].toUpperCase();

  // Already revealed or already marked wrong?
  if (state.hangman.revealedLetters.has(guess) || state.hangman.wrongLetters.has(guess)) {
    return;
  }

  if (state.hangman.word.includes(guess)) {
    // CORRECT LETTER!
    state.hangman.revealedLetters.add(guess);
    addPointsToUser(username, 100, false, true);
    playSuccessChime();
    showToast(`✅ Trafienie! @${username} odsłonił(a) literę "${guess}"! (+100 pkt)`, 'success');

    renderHangmanUI();

    // Check if word is fully solved
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
    } else {
      // In Wybraniec mode, chatter keeps their turn or streamer rolls next
      showToast(`Gracz @${username} zachowuje turę lub możesz wylosować nowego gracza!`, 'info');
    }
  } else {
    // WRONG LETTER!
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
      // Automatically roll next active chatter!
      if (state.hangman.turnMode === 'chatter') {
        setTimeout(() => rollActiveChatter(), 1200);
      }
    }
  }

  broadcastSync('HANGMAN_UPDATE', state.hangman);
}

function revealHangmanWord() {
  for (const ch of state.hangman.word) {
    state.hangman.revealedLetters.add(ch);
  }
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
// GLOBAL LEADERBOARD & EXCEL/CSV EXPORT
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
          Brak zarejestrowanych punktów w bieżącej sesji. Rozpocznij quiz lub wisielca na czacie!
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
// OBS OVERLAY MODAL & UTILS
// ============================================================================
function openOBSModal() {
  updateOBSUrls();
  document.getElementById('modal-obs').classList.add('active');
}

function updateOBSUrls() {
  const base = `${window.location.origin}${window.location.pathname}`;
  const pwdParam = state.authPassword ? `&password=${encodeURIComponent(state.authPassword)}` : '';

  const quizInput = document.getElementById('obs-url-quiz');
  const hangmanInput = document.getElementById('obs-url-hangman');

  if (quizInput) quizInput.value = `${base}?overlay=1&game=quiz${pwdParam}`;
  if (hangmanInput) hangmanInput.value = `${base}?overlay=1&game=hangman${pwdParam}`;
}

function copyOBSUrl(gameType) {
  const inputId = gameType === 'quiz' ? 'obs-url-quiz' : 'obs-url-hangman';
  const input = document.getElementById(inputId);
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

// Close modals on clicking overlay background
window.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('active');
  }
});

// Toast Notifications
function showToast(message, type = 'info') {
  if (state.isOverlay) return; // Silent in OBS stream overlay
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
