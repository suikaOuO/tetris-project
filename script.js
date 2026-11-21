/* ==========================================
   TETRIS 遊戲核心邏輯
   (選單 + 設定 + 音效 + 特效 + SRS 旋轉 + DAS/ARR + 觸控)
   ========================================== */
(() => {
'use strict';

// ================= 常數 =================
const COLS = 10;
const VISIBLE_ROWS = 20;
const HIDDEN_ROWS = 2;                 // 盤面上方看不見的緩衝列
const ROWS = VISIBLE_ROWS + HIDDEN_ROWS;
const BLOCK_SIZE = 30;
const LOCK_DELAY = 500;                // 著地後多久鎖定 (毫秒)
const MAX_LOCK_RESETS = 15;            // 著地後最多可重置鎖定計時幾次 (防止無限轉圈)
const CLEAR_ANIM_MS = 200;
const NEXT_QUEUE_SIZE = 5;
const ULTRA_TIME_LIMIT = 120000;
const SPRINT_LINES = 40;
const LEADERBOARD_SIZE = 5;

const PIECES = {
    'I': [[0,0,0,0], [1,1,1,1], [0,0,0,0], [0,0,0,0]],
    'J': [[2,0,0], [2,2,2], [0,0,0]],
    'L': [[0,0,3], [3,3,3], [0,0,0]],
    'O': [[4,4], [4,4]],
    'S': [[0,5,5], [5,5,0], [0,0,0]],
    'T': [[0,6,0], [6,6,6], [0,0,0]],
    'Z': [[7,7,0], [0,7,7], [0,0,0]]
};

const COLORS = [null, '#22d3ee', '#3b82f6', '#f97316', '#eab308', '#22c55e', '#a855f7', '#ef4444'];

// SRS 踢牆表：key 為「原方向 + 新方向」(0=生成, 1=右, 2=倒, 3=左)，偏移量為 [x, y往上為正]
const KICKS_JLSTZ = {
    '01': [[0,0], [-1,0], [-1, 1], [0,-2], [-1,-2]],
    '10': [[0,0], [ 1,0], [ 1,-1], [0, 2], [ 1, 2]],
    '12': [[0,0], [ 1,0], [ 1,-1], [0, 2], [ 1, 2]],
    '21': [[0,0], [-1,0], [-1, 1], [0,-2], [-1,-2]],
    '23': [[0,0], [ 1,0], [ 1, 1], [0,-2], [ 1,-2]],
    '32': [[0,0], [-1,0], [-1,-1], [0, 2], [-1, 2]],
    '30': [[0,0], [-1,0], [-1,-1], [0, 2], [-1, 2]],
    '03': [[0,0], [ 1,0], [ 1, 1], [0,-2], [ 1,-2]]
};
const KICKS_I = {
    '01': [[0,0], [-2,0], [ 1,0], [-2,-1], [ 1, 2]],
    '10': [[0,0], [ 2,0], [-1,0], [ 2, 1], [-1,-2]],
    '12': [[0,0], [-1,0], [ 2,0], [-1, 2], [ 2,-1]],
    '21': [[0,0], [ 1,0], [-2,0], [ 1,-2], [-2, 1]],
    '23': [[0,0], [ 2,0], [-1,0], [ 2, 1], [-1,-2]],
    '32': [[0,0], [-2,0], [ 1,0], [-2,-1], [ 1, 2]],
    '30': [[0,0], [ 1,0], [-2,0], [ 1,-2], [-2, 1]],
    '03': [[0,0], [-1,0], [ 2,0], [-1, 2], [ 2,-1]]
};
const KICKS_180 = [[0,0], [0,1], [1,0], [-1,0], [1,1], [-1,1], [0,-1]];

const LINE_NAMES = ['', 'SINGLE', 'DOUBLE', 'TRIPLE', 'TETRIS'];

const MODES = {
    marathon: { name: '馬拉松模式', lowerIsBetter: false },
    sprint:   { name: '40行衝刺',   lowerIsBetter: true  },
    ultra:    { name: '2分鐘計時賽', lowerIsBetter: false }
};

const ACTIONS = ['left', 'right', 'softDrop', 'hardDrop', 'rotateCW', 'rotateCCW', 'rotate180', 'hold'];
const ACTION_LABELS = {
    left: '向左移動', right: '向右移動', softDrop: '軟降 (加速)', hardDrop: '直接落下',
    rotateCW: '順時針旋轉', rotateCCW: '逆時針旋轉', rotate180: '180度旋轉', hold: '方塊暫存'
};
const DEFAULT_KEYBINDS = {
    left: 'KeyJ', right: 'KeyL', softDrop: 'KeyK', hardDrop: 'Space',
    rotateCW: 'KeyI', rotateCCW: 'KeyU', rotate180: 'KeyO', hold: 'ShiftLeft'
};
// DAS：長按多久開始連續移動 / ARR：連續移動間隔 / SDF：軟降間隔 (皆為毫秒，0 = 瞬間)
const DEFAULT_HANDLING = { das: 150, arr: 30, sdf: 30 };
const HANDLING_LIMITS = { das: [0, 400], arr: [0, 200], sdf: [0, 200] };

// ================= 儲存 (localStorage 安全包裝) =================
function loadJSON(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        if (raw === null) return fallback;
        const value = JSON.parse(raw);
        return value ?? fallback;
    } catch {
        return fallback;
    }
}

function saveJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 隱私模式等情況下忽略 */ }
}

function loadKeybinds() {
    const saved = loadJSON('tetrisKeys', {});
    const merged = { ...DEFAULT_KEYBINDS };
    if (saved && typeof saved === 'object') {
        for (const action of ACTIONS) {
            const code = saved[action];
            if (typeof code === 'string' && code && code !== 'Escape') merged[action] = code;
        }
    }
    // 若存檔裡有重複按鍵，直接回到預設，避免兩個動作搶同一顆鍵
    const codes = Object.values(merged);
    return new Set(codes).size === codes.length ? merged : { ...DEFAULT_KEYBINDS };
}

function loadHandling() {
    const saved = loadJSON('tetrisHandling', {});
    const result = { ...DEFAULT_HANDLING };
    for (const [key, [min, max]] of Object.entries(HANDLING_LIMITS)) {
        const v = saved && Number(saved[key]);
        if (Number.isFinite(v)) result[key] = Math.min(max, Math.max(min, Math.round(v)));
    }
    return result;
}

function compareEntries(mode) {
    return MODES[mode].lowerIsBetter ? (a, b) => a.value - b.value : (a, b) => b.value - a.value;
}

function loadLeaderboard() {
    const raw = loadJSON('tetrisLeaderboard', {});
    const result = {};
    for (const mode of Object.keys(MODES)) {
        let list = raw && raw[mode];
        if (typeof list === 'number') {
            // 舊版只存一個數字，轉成新格式
            const valid = mode === 'sprint' ? list < 999999 : list > 0;
            list = valid ? [{ name: '???', value: list }] : [];
        }
        if (!Array.isArray(list)) list = [];
        result[mode] = list
            .filter(e => e && Number.isFinite(e.value))
            .map(e => ({ name: String(e.name || '???').slice(0, 10), value: e.value }))
            .sort(compareEntries(mode))
            .slice(0, LEADERBOARD_SIZE);
    }
    return result;
}

let keybinds = loadKeybinds();
let handling = loadHandling();
let leaderboard = loadLeaderboard();
let isMuted = loadJSON('tetrisMuted', false) === true;

// ================= 遊戲狀態 =================
const game = {
    state: 'menu',            // 'menu' | 'playing' | 'paused' | 'over'
    mode: 'marathon',
    board: [],
    player: null,             // { type, matrix, x, y, rot }
    bag: [], next: [], hold: null, canHold: true,
    score: 0, lines: 0, level: 1,
    combo: -1, b2b: false,
    clock: 0,                 // 遊戲時間 (暫停時不會前進)
    lastFrame: 0,
    dropCounter: 0,
    lock: { start: null, resets: 0, lowestY: 0 },
    lastMoveWasRotate: false,
    lastKickIndex: 0,
    clearing: null,           // { rows, until }
    particles: [],
    rafId: null,
    pendingRecord: null       // 等待輸入名字的排行榜紀錄
};

const input = {
    held: new Set(),
    hDir: 0,                  // 目前長按的水平方向 (-1 / 0 / 1)，後按的方向優先
    nextRepeat: 0,
    softHeld: false,
    nextSoft: 0
};

// ================= DOM 與畫布 =================
const $ = id => document.getElementById(id);
let mainCtx, nextCtx, holdCtx;
let hatchPatterns = [];
let currentDpr = 1;

function setupCanvas(canvas) {
    if (!canvas.dataset.cssWidth) {
        canvas.dataset.cssWidth = canvas.width;
        canvas.dataset.cssHeight = canvas.height;
    }
    const w = Number(canvas.dataset.cssWidth), h = Number(canvas.dataset.cssHeight);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.width = Math.round(w * currentDpr);
    canvas.height = Math.round(h * currentDpr);
    const context = canvas.getContext('2d');
    context.setTransform(currentDpr, 0, 0, currentDpr, 0, 0);
    context.cssWidth = w;
    context.cssHeight = h;
    return context;
}

function setupAllCanvases() {
    currentDpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    mainCtx = setupCanvas($('main-canvas'));
    nextCtx = setupCanvas($('next-canvas'));
    holdCtx = setupCanvas($('hold-canvas'));
    initPatterns();
}

function initPatterns() {
    hatchPatterns = [null];
    const size = 6;
    for (let i = 1; i < COLORS.length; i++) {
        const pCanvas = document.createElement('canvas');
        pCanvas.width = pCanvas.height = Math.round(size * currentDpr);
        const p = pCanvas.getContext('2d');
        p.scale(currentDpr, currentDpr);
        p.strokeStyle = COLORS[i]; p.lineWidth = 1.5;
        p.beginPath(); p.moveTo(0, 6); p.lineTo(6, 0); p.stroke();
        p.beginPath(); p.moveTo(-1, 1); p.lineTo(1, -1); p.stroke();
        p.beginPath(); p.moveTo(5, 7); p.lineTo(7, 5); p.stroke();
        const pattern = mainCtx.createPattern(pCanvas, 'repeat');
        if (pattern.setTransform) pattern.setTransform(new DOMMatrix().scale(1 / currentDpr));
        hatchPatterns.push(pattern);
    }
}

// ================= 音訊系統 =================
let audioCtx = null, bgmInterval = null;

function initAudio() {
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch { /* 不支援音訊就安靜地玩 */ }
}

function playTone(freq, type, duration, vol = 0.1) {
    if (isMuted || !audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(vol, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.start(); osc.stop(audioCtx.currentTime + duration);
}

function playSFX(type) {
    if (isMuted) return;
    initAudio();
    switch (type) {
        case 'move': playTone(400, 'sine', 0.08, 0.04); break;
        case 'rotate': playTone(600, 'square', 0.08, 0.04); break;
        case 'hold': playTone(500, 'sine', 0.1, 0.05); break;
        case 'lock': playTone(350, 'square', 0.03, 0.15); break;
        case 'hardDrop':
            playTone(250, 'triangle', 0.05, 0.2);
            setTimeout(() => playTone(450, 'square', 0.03, 0.3), 30);
            break;
        case 'clear':
            playTone(800, 'sine', 0.1, 0.1);
            setTimeout(() => playTone(1200, 'sine', 0.3, 0.1), 100);
            break;
        case 'tetris':
            playTone(500, 'square', 0.1, 0.1);
            setTimeout(() => playTone(800, 'square', 0.1, 0.1), 100);
            setTimeout(() => playTone(1200, 'square', 0.4, 0.15), 200);
            break;
        case 'gameover':
            playTone(300, 'sawtooth', 0.5, 0.2);
            setTimeout(() => playTone(250, 'sawtooth', 0.8, 0.2), 300);
            break;
    }
}

function startBGM() {
    if (isMuted || bgmInterval) return;
    initAudio();
    const notes = [261.63, 329.63, 392.00, 523.25];
    let step = 0;
    bgmInterval = setInterval(() => {
        if (isMuted || game.state !== 'playing') return;
        playTone(notes[step % notes.length] / 2, 'triangle', 0.2, 0.03);
        step++;
    }, 250);
}

function stopBGM() {
    if (bgmInterval) { clearInterval(bgmInterval); bgmInterval = null; }
}

function updateMuteUI() {
    const txt = isMuted ? '🔈 聲音: 關' : '🔊 聲音: 開';
    $('btn-mute-menu').textContent = txt;
    $('btn-mute-game').textContent = txt;
}

function toggleMute() {
    isMuted = !isMuted;
    saveJSON('tetrisMuted', isMuted);
    updateMuteUI();
    if (isMuted) stopBGM();
    else if (game.state === 'playing') startBGM();
}

// ================= 方塊與盤面 =================
function createBoard() {
    return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
}

function getPieceMatrix(type) {
    return PIECES[type].map(row => [...row]);
}

function generatePiece() {
    if (game.bag.length === 0) {
        game.bag = Object.keys(PIECES);
        for (let i = game.bag.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [game.bag[i], game.bag[j]] = [game.bag[j], game.bag[i]];
        }
    }
    return game.bag.pop();
}

function fillNext() {
    while (game.next.length < NEXT_QUEUE_SIZE) game.next.push(generatePiece());
}

function collides(matrix, x, y) {
    for (let r = 0; r < matrix.length; r++) {
        for (let c = 0; c < matrix[r].length; c++) {
            if (!matrix[r][c]) continue;
            const bx = x + c, by = y + r;
            if (bx < 0 || bx >= COLS || by < 0 || by >= ROWS) return true;
            if (game.board[by][bx] !== 0) return true;
        }
    }
    return false;
}

function rotateMatrix(m, dir) {
    const n = m.length;
    const out = Array.from({ length: n }, () => Array(n).fill(0));
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            if (dir === 1) out[c][n - 1 - r] = m[r][c];
            else if (dir === -1) out[n - 1 - c][r] = m[r][c];
            else out[n - 1 - r][n - 1 - c] = m[r][c];
        }
    }
    return out;
}

function isGrounded() {
    const p = game.player;
    return collides(p.matrix, p.x, p.y + 1);
}

function resetLockState() {
    game.lock = { start: null, resets: 0, lowestY: game.player ? game.player.y : 0 };
}

// 生成方塊；生成位置被擋住就是 Game Over (block out)
function spawn(type) {
    const matrix = getPieceMatrix(type);
    const p = { type, matrix, rot: 0, x: Math.floor((COLS - matrix[0].length) / 2), y: 0 };
    game.player = p;
    if (collides(p.matrix, p.x, p.y)) {
        endGame('topout');
        return false;
    }
    if (!collides(p.matrix, p.x, p.y + 1)) p.y++;   // 生成後立刻下降一格，讓方塊露出來
    resetLockState();
    game.lastMoveWasRotate = false;
    game.dropCounter = 0;
    return true;
}

function spawnNext() {
    const type = game.next.shift();
    fillNext();
    game.canHold = true;
    return spawn(type);
}

// 方塊成功移動或旋轉後，處理鎖定計時重置
function onPieceMoved() {
    const p = game.player, lock = game.lock;
    if (p.y > lock.lowestY) {
        // 掉到新的最低點：重置次數歸零
        lock.lowestY = p.y;
        lock.resets = 0;
        lock.start = null;
        return;
    }
    if (lock.start !== null && lock.resets < MAX_LOCK_RESETS) {
        lock.resets++;
        lock.start = isGrounded() ? game.clock : null;
    }
}

function tryMove(dx, dy) {
    const p = game.player;
    if (collides(p.matrix, p.x + dx, p.y + dy)) return false;
    p.x += dx; p.y += dy;
    game.lastMoveWasRotate = false;
    onPieceMoved();
    return true;
}

function tryRotate(dir) {
    const p = game.player;
    if (p.type === 'O') return false;
    const from = p.rot;
    const to = (from + (dir === 2 ? 2 : dir) + 4) % 4;
    const rotated = rotateMatrix(p.matrix, dir);
    const kicks = dir === 2 ? KICKS_180 : (p.type === 'I' ? KICKS_I : KICKS_JLSTZ)[`${from}${to}`];
    for (let i = 0; i < kicks.length; i++) {
        const nx = p.x + kicks[i][0], ny = p.y - kicks[i][1];
        if (!collides(rotated, nx, ny)) {
            p.matrix = rotated; p.x = nx; p.y = ny; p.rot = to;
            game.lastMoveWasRotate = true;
            game.lastKickIndex = i;
            onPieceMoved();
            return true;
        }
    }
    return false;
}

// T-Spin 判定 (三角判定法)：最後動作是旋轉、且 T 中心四角至少三格被佔
function detectTSpin() {
    const p = game.player;
    if (p.type !== 'T' || !game.lastMoveWasRotate) return null;
    const isFilled = ([c, r]) => {
        const bx = p.x + c, by = p.y + r;
        if (bx < 0 || bx >= COLS || by >= ROWS) return true;
        return by >= 0 && game.board[by][bx] !== 0;
    };
    const corners = [[0, 0], [2, 0], [0, 2], [2, 2]];
    if (corners.filter(isFilled).length < 3) return null;
    const front = { 0: [[0, 0], [2, 0]], 1: [[2, 0], [2, 2]], 2: [[0, 2], [2, 2]], 3: [[0, 0], [0, 2]] }[p.rot];
    const frontFull = front.every(isFilled);
    return (frontFull || game.lastKickIndex === 4) ? 'full' : 'mini';
}

function gravityInterval(level) {
    // 參考常見的重力曲線：等級越高掉得越快
    return Math.max(1, Math.pow(0.8 - (level - 1) * 0.007, level - 1) * 1000);
}

function lockPiece() {
    const p = game.player;
    const tspin = detectTSpin();
    let lockedOut = true;

    p.matrix.forEach((row, r) => row.forEach((value, c) => {
        if (!value) return;
        const by = p.y + r;
        game.board[by][p.x + c] = value;
        if (by >= HIDDEN_ROWS) lockedOut = false;
    }));
    game.player = null;
    playSFX('lock');

    // 整個方塊都鎖在看不見的緩衝區 → Game Over (lock out)
    if (lockedOut) { endGame('topout'); return; }

    const rows = [];
    for (let y = 0; y < ROWS; y++) {
        if (game.board[y].every(v => v !== 0)) rows.push(y);
    }
    const perfectClear = rows.length > 0 &&
        game.board.every((row, y) => rows.includes(y) || row.every(v => v === 0));

    applyScore(rows.length, tspin, perfectClear);

    if (rows.length > 0) {
        triggerShake('normal');
        playSFX(rows.length >= 4 || tspin ? 'tetris' : 'clear');
        rows.forEach(y => {
            for (let x = 0; x < COLS; x++) spawnParticles(y, x, game.board[y][x]);
            game.board[y].fill(0);
        });
        game.clearing = { rows, until: game.clock + CLEAR_ANIM_MS };

        if (game.mode === 'sprint' && game.lines >= SPRINT_LINES) {
            endGame('cleared');
            return;
        }
    } else {
        spawnNext();
    }
}

function finishClear() {
    const { rows } = game.clearing;
    game.board = game.board.filter((_, y) => !rows.includes(y));
    while (game.board.length < ROWS) game.board.unshift(Array(COLS).fill(0));
    game.clearing = null;
    spawnNext();
}

function applyScore(cleared, tspin, perfectClear) {
    const level = game.level;
    const labels = [];
    let base;
    if (tspin === 'full') base = [400, 800, 1200, 1600][cleared];
    else if (tspin === 'mini') base = [100, 200, 400][cleared] ?? 400;
    else base = [0, 100, 300, 500, 800][cleared];

    if (tspin) labels.push((tspin === 'mini' ? 'T-SPIN MINI' : 'T-SPIN') + (cleared ? ' ' + LINE_NAMES[cleared] : ''));
    else if (cleared >= 2) labels.push(LINE_NAMES[cleared]);

    let comboBonus = 0;
    if (cleared > 0) {
        const difficult = cleared >= 4 || !!tspin;
        if (difficult && game.b2b) {
            base = Math.floor(base * 1.5);
            labels.push('BACK-TO-BACK');
        }
        game.b2b = difficult;
        game.combo++;
        if (game.combo > 0) {
            comboBonus = 50 * game.combo;
            labels.push(`${game.combo} COMBO`);
        }
    } else {
        game.combo = -1;
    }

    let points = (base + comboBonus) * level;
    if (perfectClear) {
        points += [0, 800, 1200, 1800, 2000][cleared] * level;
        popText($('all-clear-message'));
    }

    game.score += points;
    game.lines += cleared;
    if (game.mode === 'marathon') game.level = Math.floor(game.lines / 10) + 1;

    if (labels.length) {
        const el = $('action-text');
        el.textContent = labels.join('\n');
        popText(el);
    }
}

function hardDrop() {
    const p = game.player;
    let cells = 0;
    while (!collides(p.matrix, p.x, p.y + 1)) { p.y++; cells++; }
    if (cells > 0) game.lastMoveWasRotate = false;
    game.score += cells * 2;
    playSFX('hardDrop');
    triggerShake('hard');
    lockPiece();
}

function softDropStep() {
    if (tryMove(0, 1)) { game.score += 1; game.dropCounter = 0; return true; }
    return false;
}

function doHold() {
    if (!game.canHold) return;
    const current = game.player.type;
    playSFX('hold');
    if (game.hold === null) {
        game.hold = current;
        spawnNext();
    } else {
        const swap = game.hold;
        game.hold = current;
        spawn(swap);
    }
    game.canHold = false;
}

// ================= 輸入 (鍵盤與觸控共用) =================
const canAct = () => game.state === 'playing' && !game.clearing && game.player !== null;

function pressAction(action) {
    if (game.state !== 'playing' || input.held.has(action)) return;
    input.held.add(action);

    switch (action) {
        case 'left':
        case 'right': {
            const dir = action === 'left' ? -1 : 1;
            input.hDir = dir;
            input.nextRepeat = game.clock + handling.das;
            if (canAct() && tryMove(dir, 0)) playSFX('move');
            break;
        }
        case 'softDrop':
            input.softHeld = true;
            input.nextSoft = game.clock + handling.sdf;
            if (canAct()) {
                if (handling.sdf === 0) { while (softDropStep()); }
                else softDropStep();
            }
            break;
        case 'hardDrop': if (canAct()) hardDrop(); break;
        case 'rotateCW': if (canAct() && tryRotate(1)) playSFX('rotate'); break;
        case 'rotateCCW': if (canAct() && tryRotate(-1)) playSFX('rotate'); break;
        case 'rotate180': if (canAct() && tryRotate(2)) playSFX('rotate'); break;
        case 'hold': if (canAct()) doHold(); break;
    }
}

function releaseAction(action) {
    input.held.delete(action);
    if (action === 'left' || action === 'right') {
        const dir = action === 'left' ? -1 : 1;
        if (input.hDir === dir) {
            const other = dir === -1 ? 'right' : 'left';
            if (input.held.has(other)) {
                input.hDir = -dir;
                input.nextRepeat = game.clock + handling.das;
            } else {
                input.hDir = 0;
            }
        }
    } else if (action === 'softDrop') {
        input.softHeld = false;
    }
}

function releaseAllInputs() {
    input.held.clear();
    input.hDir = 0;
    input.softHeld = false;
    document.querySelectorAll('.tc-btn.active').forEach(b => b.classList.remove('active'));
}

// 長按連續移動 (DAS / ARR) 與軟降
function processHeldInputs() {
    if (input.hDir !== 0 && game.clock >= input.nextRepeat) {
        if (handling.arr === 0) {
            while (tryMove(input.hDir, 0));
        } else {
            let guard = COLS;
            while (game.clock >= input.nextRepeat && guard-- > 0) {
                if (!tryMove(input.hDir, 0)) { input.nextRepeat = game.clock; break; }
                input.nextRepeat += handling.arr;
            }
        }
    }
    if (input.softHeld && game.clock >= input.nextSoft) {
        if (handling.sdf === 0) {
            while (softDropStep());
        } else {
            let guard = ROWS;
            while (game.clock >= input.nextSoft && guard-- > 0) {
                if (!softDropStep()) { input.nextSoft = game.clock; break; }
                input.nextSoft += handling.sdf;
            }
        }
    }
}

function codeToAction(code) {
    return ACTIONS.find(a => keybinds[a] === code) || null;
}

let listeningAction = null;
let suppressSettingsCancel = false;

function onKeyDown(event) {
    if (listeningAction) {
        event.preventDefault();
        if (event.code === 'Escape') {
            suppressSettingsCancel = true;   // 只取消聆聽，不要關掉設定視窗
            setTimeout(() => { suppressSettingsCancel = false; }, 50);
            stopListening();
        } else {
            bindKey(listeningAction, event.code);
        }
        return;
    }

    if (document.querySelector('dialog[open]')) return;  // 對話框開著時交給對話框處理
    if (game.state === 'menu' || game.state === 'over') return;

    if (event.code === 'Escape') {
        event.preventDefault();
        if (game.state === 'playing') pauseGame();
        else if (game.state === 'paused') resumeGame();
        return;
    }

    const action = codeToAction(event.code);
    if (!action) return;
    event.preventDefault();       // 避免空白鍵捲動網頁等預設行為
    if (event.repeat) return;
    initAudio();
    pressAction(action);
}

function onKeyUp(event) {
    const action = codeToAction(event.code);
    if (action) releaseAction(action);
}

function setupTouchControls() {
    const markTouch = () => document.body.classList.add('touch');
    if (window.matchMedia('(pointer: coarse)').matches) markTouch();
    window.addEventListener('touchstart', () => { markTouch(); fitLayout(); }, { once: true, passive: true });

    document.querySelectorAll('#touch-controls .tc-btn').forEach(btn => {
        const action = btn.dataset.action;
        const release = () => { btn.classList.remove('active'); releaseAction(action); };
        btn.addEventListener('pointerdown', e => {
            e.preventDefault();
            initAudio();
            btn.setPointerCapture?.(e.pointerId);
            btn.classList.add('active');
            pressAction(action);
        });
        btn.addEventListener('pointerup', release);
        btn.addEventListener('pointercancel', release);
        btn.addEventListener('lostpointercapture', release);
        btn.addEventListener('contextmenu', e => e.preventDefault());
    });

    $('tc-pause').addEventListener('click', () => {
        if (game.state === 'playing') pauseGame();
        else if (game.state === 'paused') resumeGame();
    });
}

// ================= 主迴圈 =================
function frame(now) {
    game.rafId = null;
    if (game.state !== 'playing') return;

    const dt = Math.min(now - game.lastFrame, 1000);
    game.lastFrame = now;
    game.clock += dt;

    if (game.mode === 'ultra' && game.clock >= ULTRA_TIME_LIMIT) {
        game.clock = ULTRA_TIME_LIMIT;
        endGame('timeup');
        return;
    }

    if (game.clearing && game.clock >= game.clearing.until) finishClear();

    if (game.state === 'playing' && canAct()) {
        processHeldInputs();
    }

    if (game.state === 'playing' && canAct()) {
        // 重力
        game.dropCounter += dt;
        const interval = gravityInterval(game.level);
        let guard = ROWS;
        while (game.dropCounter >= interval && guard-- > 0) {
            game.dropCounter -= interval;
            if (!tryMove(0, 1)) { game.dropCounter = 0; break; }
        }

        // 鎖定判定
        const lock = game.lock;
        if (isGrounded()) {
            if (lock.start === null) {
                // 重置次數用完後再著地就直接鎖定
                lock.start = lock.resets >= MAX_LOCK_RESETS ? game.clock - LOCK_DELAY : game.clock;
            }
            if (game.clock - lock.start >= LOCK_DELAY) lockPiece();
        } else {
            lock.start = null;
        }
    }

    render(dt);
    updateStatsUI();
    if (game.state === 'playing') game.rafId = requestAnimationFrame(frame);
}

function startLoop() {
    if (game.rafId) cancelAnimationFrame(game.rafId);
    game.lastFrame = performance.now();
    game.rafId = requestAnimationFrame(frame);
}

function stopLoop() {
    if (game.rafId) cancelAnimationFrame(game.rafId);
    game.rafId = null;
}

// ================= 繪製 =================
function drawCells(context, matrix, ox, oy, alpha = 1) {
    context.globalAlpha = alpha;
    matrix.forEach((row, y) => {
        row.forEach((value, x) => {
            if (!value) return;
            const px = (x + ox) * BLOCK_SIZE, py = (y + oy) * BLOCK_SIZE;
            context.fillStyle = COLORS[value] + '44';
            context.fillRect(px, py, BLOCK_SIZE, BLOCK_SIZE);
            context.save();
            context.translate(px, py);
            context.fillStyle = hatchPatterns[value];
            context.fillRect(0, 0, BLOCK_SIZE, BLOCK_SIZE);
            context.restore();
            context.strokeStyle = 'rgba(0,0,0,0.3)'; context.lineWidth = 1;
            context.strokeRect(px, py, BLOCK_SIZE, BLOCK_SIZE);
            context.fillStyle = 'rgba(255,255,255,0.3)';
            context.fillRect(px, py, BLOCK_SIZE, 2);
        });
    });
    context.globalAlpha = 1;
}

function drawGhost(context) {
    const p = game.player;
    let gy = p.y;
    while (!collides(p.matrix, p.x, gy + 1)) gy++;
    context.setLineDash([4, 2]);
    context.lineWidth = 2;
    p.matrix.forEach((row, y) => row.forEach((value, x) => {
        if (!value) return;
        context.strokeStyle = COLORS[value];
        context.strokeRect((x + p.x) * BLOCK_SIZE, (y + gy - HIDDEN_ROWS) * BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
    }));
    context.setLineDash([]);
}

// 把方塊裁成實際佔用的範圍，方便在小視窗置中
function trimMatrix(m) {
    const rows = m.filter(row => row.some(v => v));
    const cols = m[0].map((_, c) => c).filter(c => m.some(row => row[c]));
    return rows.map(row => cols.map(c => row[c]));
}

function drawPreview(context, type, slotTop, alpha = 1) {
    const m = trimMatrix(PIECES[type]);
    drawCells(context, m, (4 - m[0].length) / 2, slotTop + (4 - m.length) / 2, alpha);
}

function spawnParticles(row, col, colorIndex) {
    const color = COLORS[colorIndex] || '#fff';
    for (let i = 0; i < 8; i++) {
        game.particles.push({
            x: col * BLOCK_SIZE + BLOCK_SIZE / 2,
            y: (row - HIDDEN_ROWS) * BLOCK_SIZE + BLOCK_SIZE / 2,
            vx: (Math.random() - 0.5) * 15, vy: (Math.random() - 1) * 10,
            life: 1.0, color
        });
    }
}

function updateAndDrawParticles(context, dt) {
    const k = dt / (1000 / 60);   // 以 60fps 為基準，高更新率螢幕也一樣速度
    for (let i = game.particles.length - 1; i >= 0; i--) {
        const p = game.particles[i];
        p.x += p.vx * k; p.y += p.vy * k; p.vy += 0.8 * k; p.life -= 0.03 * k;
        if (p.life <= 0) { game.particles.splice(i, 1); continue; }
        context.globalAlpha = p.life;
        context.fillStyle = p.color;
        context.fillRect(p.x, p.y, 8, 8);
    }
    context.globalAlpha = 1;
}

function render(dt = 0) {
    const c = mainCtx;
    c.clearRect(0, 0, c.cssWidth, c.cssHeight);
    drawCells(c, game.board, 0, -HIDDEN_ROWS);

    if (game.player && !game.clearing && (game.state === 'playing' || game.state === 'paused')) {
        drawGhost(c);
        let alpha = 1;
        if (game.lock.start !== null) {
            const progress = Math.min(1, (game.clock - game.lock.start) / LOCK_DELAY);
            alpha = 1 - 0.4 * progress;   // 快鎖定時方塊會逐漸變淡
        }
        drawCells(c, game.player.matrix, game.player.x, game.player.y - HIDDEN_ROWS, alpha);
    }
    updateAndDrawParticles(c, dt);

    nextCtx.clearRect(0, 0, nextCtx.cssWidth, nextCtx.cssHeight);
    for (let i = 0; i < 3; i++) {
        if (game.next[i]) drawPreview(nextCtx, game.next[i], i * 4);
    }

    holdCtx.clearRect(0, 0, holdCtx.cssWidth, holdCtx.cssHeight);
    if (game.hold) drawPreview(holdCtx, game.hold, 0, game.canHold ? 1 : 0.35);
}

// ================= UI =================
const textCache = new Map();
function setText(id, value) {
    const str = String(value);
    if (textCache.get(id) === str) return;
    textCache.set(id, str);
    $(id).textContent = str;
}

function formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const centis = Math.floor((ms % 1000) / 10);
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centis).padStart(2, '0')}`;
}

function formatRecord(mode, value) {
    return mode === 'sprint' ? formatTime(value) : `${value} 分`;
}

function updateStatsUI() {
    setText('score', game.score);
    setText('lines', game.mode === 'sprint' ? `${game.lines}/${SPRINT_LINES}` : game.lines);
    setText('level', game.level);
    if (game.mode === 'sprint') setText('time', formatTime(game.clock));
    else if (game.mode === 'ultra') setText('time', formatTime(Math.max(0, ULTRA_TIME_LIMIT - game.clock)));
}

function updateLeaderboardUI() {
    setText('current-mode-name', MODES[game.mode].name);
    const list = leaderboard[game.mode];
    const ol = $('leaderboard-list');
    ol.replaceChildren();
    if (list.length === 0) {
        const li = document.createElement('li');
        li.className = 'lb-empty';
        li.textContent = '還沒有紀錄';
        ol.appendChild(li);
        return;
    }
    list.slice(0, 3).forEach(entry => {
        const li = document.createElement('li');
        const name = document.createElement('span');
        name.className = 'lb-name';
        name.textContent = entry.name;
        const value = document.createElement('span');
        value.className = 'lb-value';
        value.textContent = game.mode === 'sprint' ? formatTime(entry.value) : entry.value;
        li.append(name, value);
        ol.appendChild(li);
    });
}

function popText(el) {
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
}

function triggerShake(type) {
    const layout = $('game-layout');
    layout.classList.remove('shake', 'hard-drop-shake');
    void layout.offsetWidth;
    layout.classList.add(type === 'hard' ? 'hard-drop-shake' : 'shake');
}

function showScreen(name) {
    $('main-menu').hidden = name !== 'menu';
    $('game-layout').hidden = name !== 'game';
    document.body.classList.toggle('in-game', name === 'game');
    if (name === 'game') fitLayout();
}

// 視窗太小 (例如手機) 時，等比例縮小整個遊戲畫面
function fitLayout() {
    const layout = $('game-layout');
    if (layout.hidden) return;
    layout.style.scale = '';
    layout.style.translate = '';
    const touchBar = document.body.classList.contains('touch') ? $('touch-controls').offsetHeight + 12 : 0;
    const w = layout.offsetWidth, h = layout.offsetHeight;
    const scale = Math.min(1, (window.innerWidth - 16) / w, (window.innerHeight - touchBar - 16) / h);
    if (scale < 1) layout.style.scale = String(scale);
    if (touchBar) layout.style.translate = `-50% calc(-50% - ${touchBar / 2}px)`;
}

// ================= 遊戲流程 =================
function startGame(mode) {
    initAudio();
    stopLoop();
    $('game-over-dialog').open && $('game-over-dialog').close();

    Object.assign(game, {
        state: 'playing',
        mode,
        board: createBoard(),
        player: null,
        bag: [], next: [], hold: null, canHold: true,
        score: 0, lines: 0, level: 1,
        combo: -1, b2b: false,
        clock: 0, dropCounter: 0,
        lastMoveWasRotate: false, lastKickIndex: 0,
        clearing: null,
        particles: [],
        pendingRecord: null
    });
    releaseAllInputs();

    $('pause-overlay').hidden = true;
    $('time-box').hidden = mode === 'marathon';
    $('level-box').hidden = mode !== 'marathon';
    $('all-clear-message').classList.remove('show');
    $('action-text').classList.remove('show');

    showScreen('game');
    updateLeaderboardUI();
    fillNext();
    spawnNext();
    updateStatsUI();
    render();
    startBGM();
    startLoop();
}

function pauseGame() {
    if (game.state !== 'playing') return;
    game.state = 'paused';
    stopLoop();
    stopBGM();
    releaseAllInputs();
    $('pause-overlay').hidden = false;
}

function resumeGame() {
    if (game.state !== 'paused') return;
    game.state = 'playing';
    $('pause-overlay').hidden = true;
    startBGM();
    startLoop();
}

function goToMenu() {
    stopLoop();
    stopBGM();
    releaseAllInputs();
    game.state = 'menu';
    $('pause-overlay').hidden = true;
    if ($('game-over-dialog').open) $('game-over-dialog').close();
    showScreen('menu');
}

function endGame(reason) {
    if (game.state === 'over' || game.state === 'menu') return;
    // 補上距離上一幀的時間，讓衝刺成績更精準
    if (reason === 'cleared') game.clock += Math.max(0, performance.now() - game.lastFrame);
    game.state = 'over';
    stopLoop();
    stopBGM();
    releaseAllInputs();
    playSFX(reason === 'topout' ? 'gameover' : 'tetris');
    updateStatsUI();
    render();

    const mode = game.mode;
    const titles = { topout: 'GAME OVER', cleared: 'SPRINT CLEARED!', timeup: "TIME'S UP!" };
    $('go-title').textContent = titles[reason];

    let value, eligible;
    if (mode === 'sprint') {
        value = Math.round(game.clock);
        eligible = reason === 'cleared';
        $('final-score').textContent = eligible ? formatTime(value) : `${game.lines}/${SPRINT_LINES} 行`;
    } else {
        value = game.score;
        eligible = value > 0;
        $('final-score').textContent = value;
    }

    const list = leaderboard[mode];
    const better = compareEntries(mode);
    const rank = list.filter(e => better(e, { value }) <= 0).length + 1;
    const qualifies = eligible && rank <= LEADERBOARD_SIZE;

    if (qualifies) {
        game.pendingRecord = { mode, value };
        $('new-record-title').textContent = rank === 1 ? '新紀錄！' : `進入排行榜第 ${rank} 名！`;
        $('go-desc').textContent = `成績：${formatRecord(mode, value)}`;
        $('new-record-box').hidden = false;
        $('player-name').value = loadJSON('tetrisLastName', '') || '';
    } else {
        game.pendingRecord = null;
        $('new-record-box').hidden = true;
        $('go-desc').textContent = mode === 'sprint' && !eligible ? '沒有完成 40 行' : '最終成績';
    }

    // 結束瞬間玩家可能還在連按空白鍵/Enter，先鎖住輸入框與按鈕一下，避免誤觸
    const nameInput = $('player-name');
    const actions = [$('btn-replay'), $('btn-to-menu')];
    nameInput.readOnly = true;
    actions.forEach(b => { b.disabled = true; });
    $('game-over-dialog').showModal();
    setTimeout(() => {
        nameInput.readOnly = false;
        actions.forEach(b => { b.disabled = false; });
        if (qualifies) { nameInput.focus(); nameInput.select(); }
        else $('btn-replay').focus();
    }, 600);
}

function commitRecord() {
    const pending = game.pendingRecord;
    if (!pending) return;
    game.pendingRecord = null;
    const name = $('player-name').value.trim().slice(0, 10) || '無名氏';
    saveJSON('tetrisLastName', name);
    const list = leaderboard[pending.mode];
    list.push({ name, value: pending.value });
    list.sort(compareEntries(pending.mode));
    leaderboard[pending.mode] = list.slice(0, LEADERBOARD_SIZE);
    saveJSON('tetrisLeaderboard', leaderboard);
    updateLeaderboardUI();
}

// ================= 按鍵設定 =================
function formatKeyName(code) {
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    if (code.startsWith('Numpad')) return 'Num' + code.slice(6);
    const map = {
        ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
        Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: 'Back',
        Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'",
        BracketLeft: '[', BracketRight: ']', Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`'
    };
    if (map[code]) return map[code];
    if (code.includes('Shift')) return 'Shift';
    if (code.includes('Control')) return 'Ctrl';
    if (code.includes('Alt')) return 'Alt';
    if (code.includes('Meta')) return 'Meta';
    return code;
}

function updateControlsUI() {
    for (const action of ACTIONS) {
        const el = $(`kb-${action}`);
        if (el) el.textContent = formatKeyName(keybinds[action]);
    }
}

function renderSettingsKeys() {
    const container = $('keybinds-container');
    container.replaceChildren();
    for (const action of ACTIONS) {
        const item = document.createElement('div');
        item.className = 'keybind-item';
        const label = document.createElement('label');
        label.textContent = ACTION_LABELS[action];
        label.htmlFor = `btn-key-${action}`;
        const btn = document.createElement('button');
        btn.id = `btn-key-${action}`;
        btn.type = 'button';
        btn.className = 'keybind-btn';
        btn.textContent = formatKeyName(keybinds[action]);
        btn.addEventListener('click', () => startListening(action));
        item.append(label, btn);
        container.appendChild(item);
    }
}

function renderHandling() {
    for (const key of Object.keys(HANDLING_LIMITS)) {
        $(`set-${key}`).value = handling[key];
        $(`val-${key}`).textContent = handling[key] === 0 ? '瞬間' : `${handling[key]} ms`;
    }
}

function setSettingsHint(text) {
    $('settings-hint').textContent = text || '點擊按鈕後，按下你想要設定的新按鍵（ESC 取消）';
}

function startListening(action) {
    stopListening();
    listeningAction = action;
    const btn = $(`btn-key-${action}`);
    btn.classList.add('listening');
    btn.textContent = '請按下按鍵...';
    setSettingsHint();
}

function stopListening() {
    listeningAction = null;
    renderSettingsKeys();
}

function bindKey(action, code) {
    const other = ACTIONS.find(a => a !== action && keybinds[a] === code);
    if (other) {
        keybinds[other] = keybinds[action];   // 按鍵重複時兩個動作互換
        setSettingsHint(`「${formatKeyName(code)}」原本是「${ACTION_LABELS[other]}」，已互換`);
    } else {
        setSettingsHint();
    }
    keybinds[action] = code;
    stopListening();
    persistSettings();
}

function openSettings() {
    setSettingsHint();
    renderSettingsKeys();
    renderHandling();
    $('settings-dialog').showModal();
}

// 每次變更都立刻存檔，不依賴視窗怎麼被關掉
function persistSettings() {
    saveJSON('tetrisKeys', keybinds);
    saveJSON('tetrisHandling', handling);
    updateControlsUI();
}

function onSettingsClosed() {
    listeningAction = null;
    persistSettings();
}

function resetDefaults() {
    keybinds = { ...DEFAULT_KEYBINDS };
    handling = { ...DEFAULT_HANDLING };
    setSettingsHint('已恢復預設值');
    stopListening();
    renderHandling();
    persistSettings();
}

// ================= 初始化 =================
function bindUI() {
    document.querySelectorAll('[data-mode]').forEach(btn =>
        btn.addEventListener('click', () => startGame(btn.dataset.mode)));

    $('btn-settings').addEventListener('click', openSettings);
    $('btn-mute-menu').addEventListener('click', toggleMute);
    $('btn-mute-game').addEventListener('click', toggleMute);

    $('btn-resume').addEventListener('click', resumeGame);
    $('btn-restart').addEventListener('click', () => startGame(game.mode));
    $('btn-quit').addEventListener('click', goToMenu);

    $('btn-replay').addEventListener('click', () => { commitRecord(); startGame(game.mode); });
    $('btn-to-menu').addEventListener('click', () => { commitRecord(); goToMenu(); });
    $('player-name').addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); $('btn-replay').click(); }
    });
    // 遊戲結束視窗不能用 ESC 關掉，避免卡在遊戲畫面
    $('game-over-dialog').addEventListener('cancel', e => e.preventDefault());

    const settings = $('settings-dialog');
    settings.addEventListener('cancel', e => {
        if (suppressSettingsCancel) { e.preventDefault(); suppressSettingsCancel = false; }
    });
    settings.addEventListener('close', onSettingsClosed);
    $('btn-reset-keys').addEventListener('click', resetDefaults);
    $('btn-close-settings').addEventListener('click', () => settings.close());

    for (const key of Object.keys(HANDLING_LIMITS)) {
        $(`set-${key}`).addEventListener('input', e => {
            handling[key] = Number(e.target.value);
            renderHandling();
            persistSettings();
        });
    }

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);

    // 切換分頁或視窗失焦時自動暫停，計時也不會偷跑
    document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });
    window.addEventListener('blur', pauseGame);

    window.addEventListener('resize', () => {
        const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
        if (dpr !== currentDpr) { setupAllCanvases(); render(); }
        fitLayout();
    });
}

window.addEventListener('DOMContentLoaded', () => {
    setupAllCanvases();
    bindUI();
    setupTouchControls();
    updateControlsUI();
    updateMuteUI();
    showScreen('menu');
});

})();
