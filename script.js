/* ==========================================
   TETRIS 遊戲核心邏輯 (選單 + 設定 + 音效 + 特效 + 電競級按鍵判定)
   ========================================== */

const COLS = 10;
const ROWS = 20;
const BLOCK_SIZE = 30;
const LOCK_DELAY = 500;

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

let canvas, ctx, nextCanvas, nextCtx, holdCanvas, holdCtx;
let board = [];
let score = 0, lines = 0, level = 1;
let dropCounter = 0, dropInterval = 1000, lastTime = 0;
let isPaused = false, isGameOver = true, requestId = null;
let bag = [], nextQueue = [], holdPiece = null, canHold = true;
let isAnimating = false;
let HATCH_PATTERNS = [];
let lockStartTime = null;
let player = { pos: {x: 0, y: 0}, matrix: null, type: null };

// --- 遊戲模式與計時器 ---
let currentMode = 'marathon';
let gameStartTime = 0;
let timeElapsed = 0;
const ULTRA_TIME_LIMIT = 120000;

let particles = [];
let audioCtx, isMuted = false, bgmInterval = null;

// --- 按鍵設定與連續輸入系統 (DAS/ARR) ---
const defaultKeybinds = {
    left: 'KeyJ', right: 'KeyL', softDrop: 'KeyK', hardDrop: 'Space',
    rotateCW: 'KeyI', rotateCCW: 'KeyU', rotate180: 'KeyO', hold: 'ShiftLeft'
};
let keybinds = JSON.parse(localStorage.getItem('tetrisKeys')) || {...defaultKeybinds};
let listeningKeyAction = null;

let keysPressed = {};
let keyRepeatTimers = {};
const DAS = 150; // 初次長按延遲 (毫秒)，大幅縮短判定時間
const ARR = 30;  // 連續移動的間隔 (毫秒)，越小越快

window.onload = function() {
    canvas = document.getElementById('main-canvas');
    ctx = canvas.getContext('2d');
    nextCanvas = document.getElementById('next-canvas');
    nextCtx = nextCanvas.getContext('2d');
    holdCanvas = document.getElementById('hold-canvas');
    holdCtx = holdCanvas.getContext('2d');

    initPatterns();
    updateControlsUI(); // 更新遊戲左側的按鍵提示
    renderSettingsKeys(); // 繪製設定面板的按鈕

    // 全域鍵盤監聽
    document.addEventListener('keydown', handleInput);
    document.addEventListener('keyup', (event) => {
        keysPressed[event.code] = false;
    });
    
    // 初始化返回目錄狀態
    document.getElementById('main-menu').style.display = 'flex';
    document.getElementById('game-layout').style.display = 'none';
};

// ================= 畫面切換與排行榜 =================
function showMainMenu() {
    document.getElementById('main-menu').style.display = 'flex';
    document.getElementById('game-layout').style.display = 'none';
    document.getElementById('pause-overlay').style.display = 'none';
    document.getElementById('game-over-dialog').close();
    stopBGM();
}

function updateLeaderboardUI() {
    const data = JSON.parse(localStorage.getItem('tetrisLeaderboard')) || { marathon: 0, sprint: 999999, ultra: 0 };
    const modeNames = { marathon: '馬拉松模式', sprint: '40行衝刺', ultra: '2分鐘計時賽' };
    
    document.getElementById('current-mode-name').innerText = modeNames[currentMode];
    
    let recordText = '-';
    if (currentMode === 'marathon' && data.marathon > 0) recordText = `${data.marathon} 分`;
    else if (currentMode === 'sprint' && data.sprint < 999999) recordText = formatTime(data.sprint);
    else if (currentMode === 'ultra' && data.ultra > 0) recordText = `${data.ultra} 分`;

    document.getElementById('current-mode-record').innerText = recordText;
}

function checkHighScore() {
    let data = JSON.parse(localStorage.getItem('tetrisLeaderboard')) || { marathon: 0, sprint: 999999, ultra: 0 };
    let isHigh = false;
    let recordStr = "";

    if (currentMode === 'marathon' && score > data.marathon) {
        isHigh = true; data.marathon = score; recordStr = `${score} 分`;
    } else if (currentMode === 'sprint' && lines >= 40 && timeElapsed < data.sprint) {
        isHigh = true; data.sprint = timeElapsed; recordStr = formatTime(timeElapsed);
    } else if (currentMode === 'ultra' && score > data.ultra) {
        isHigh = true; data.ultra = score; recordStr = `${score} 分`;
    }

    if (isHigh) {
        localStorage.setItem('tetrisLeaderboard', JSON.stringify(data));
        document.getElementById('new-record-box').style.display = 'block';
        document.getElementById('go-desc').innerText = `🔥 新的高分紀錄：${recordStr} 🔥`;
        updateLeaderboardUI();
    } else {
        document.getElementById('new-record-box').style.display = 'none';
        let desc = currentMode === 'sprint' ? `時間: ${formatTime(timeElapsed)}` : `分數: ${score}`;
        document.getElementById('go-desc').innerText = `最終${desc}`;
    }
}

function saveAndReset() {
    isPaused = false;
    keysPressed = {};
    showMainMenu();
}

// ================= 按鍵設定系統 =================
const actionLabels = {
    left: '向左移動', right: '向右移動', softDrop: '軟降 (加速)', hardDrop: '直接落下',
    rotateCW: '順時針旋轉', rotateCCW: '逆時針旋轉', rotate180: '180度旋轉', hold: '方塊暫存'
};

function formatKeyName(code) {
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    if (code.startsWith('Arrow')) {
        const arr = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
        return arr[code];
    }
    if (code === 'Space') return 'Space';
    if (code.includes('Shift')) return 'Shift';
    if (code.includes('Control')) return 'Ctrl';
    if (code.includes('Alt')) return 'Alt';
    return code;
}

function updateControlsUI() {
    for (const [action, code] of Object.entries(keybinds)) {
        const el = document.getElementById(`kb-${action}`);
        if (el) el.innerText = formatKeyName(code);
    }
}

function openSettings() {
    renderSettingsKeys();
    document.getElementById('settings-dialog').showModal();
}

function closeSettings() {
    listeningKeyAction = null;
    localStorage.setItem('tetrisKeys', JSON.stringify(keybinds));
    updateControlsUI();
    document.getElementById('settings-dialog').close();
}

function resetDefaultKeys() {
    keybinds = {...defaultKeybinds};
    renderSettingsKeys();
}

function renderSettingsKeys() {
    const container = document.getElementById('keybinds-container');
    container.innerHTML = '';
    
    for (const [action, code] of Object.entries(keybinds)) {
        const div = document.createElement('div');
        div.className = 'keybind-item';
        div.innerHTML = `
            <label>${actionLabels[action]}</label>
            <button id="btn-key-${action}" class="keybind-btn" onclick="listenForKey('${action}')">
                ${formatKeyName(code)}
            </button>
        `;
        container.appendChild(div);
    }
}

function listenForKey(action) {
    document.querySelectorAll('.keybind-btn').forEach(b => b.classList.remove('listening'));
    
    listeningKeyAction = action;
    const btn = document.getElementById(`btn-key-${action}`);
    btn.classList.add('listening');
    btn.innerText = '請按下按鍵...';
}

// ================= 音訊系統 =================
function initAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
}

function toggleMute() {
    isMuted = !isMuted;
    const txt = isMuted ? '🔈 聲音: 關' : '🔊 聲音: 開';
    document.getElementById('btn-mute-menu').innerText = txt;
    document.getElementById('btn-mute-game').innerText = txt;
    if (isMuted) stopBGM();
    else if (!isGameOver && !isPaused && document.getElementById('game-layout').style.display !== 'none') startBGM();
}

function playTone(freq, type, duration, vol=0.1) {
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
    if(isMuted) return;
    initAudio();
    switch(type) {
        case 'move': playTone(400, 'sine', 0.1, 0.05); break;
        case 'rotate': playTone(600, 'square', 0.1, 0.05); break;
        case 'lock': 
            // 清脆的短促機械敲擊聲
            playTone(350, 'square', 0.03, 0.15); 
            break;
        case 'hardDrop': 
            // 結合下墜感與更強烈的清脆定位聲
            playTone(250, 'triangle', 0.05, 0.2); 
            setTimeout(() => playTone(450, 'square', 0.03, 0.3), 30); 
            break;
        case 'clear': playTone(800, 'sine', 0.1, 0.1); setTimeout(() => playTone(1200, 'sine', 0.3, 0.1), 100); break;
        case 'tetris': playTone(500, 'square', 0.1, 0.1); setTimeout(() => playTone(800, 'square', 0.1, 0.1), 100); setTimeout(() => playTone(1200, 'square', 0.4, 0.15), 200); break;
        case 'gameover': playTone(300, 'sawtooth', 0.5, 0.2); setTimeout(() => playTone(250, 'sawtooth', 0.8, 0.2), 300); break;
    }
}

function startBGM() {
    if(isMuted || bgmInterval) return;
    initAudio();
    const notes = [261.63, 329.63, 392.00, 523.25];
    let step = 0;
    bgmInterval = setInterval(() => {
        if(isMuted || isPaused || isGameOver) return;
        playTone(notes[step % notes.length] / 2, 'triangle', 0.2, 0.03);
        step++;
    }, 250);
}

function stopBGM() {
    if(bgmInterval) { clearInterval(bgmInterval); bgmInterval = null; }
}

// ================= 特效與遊戲繪製 =================
function spawnParticles(y, x, colorIndex) {
    const color = COLORS[colorIndex] || '#fff';
    for(let i=0; i<8; i++) {
        particles.push({
            x: x * BLOCK_SIZE + BLOCK_SIZE/2, y: y * BLOCK_SIZE + BLOCK_SIZE/2,
            vx: (Math.random() - 0.5) * 15, vy: (Math.random() - 1) * 10,
            life: 1.0, color: color
        });
    }
}

function updateAndDrawParticles() {
    if(particles.length === 0) return;
    for(let i=particles.length-1; i>=0; i--) {
        let p = particles[i];
        p.x += p.vx; p.y += p.vy; p.vy += 0.8; p.life -= 0.03;
        if(p.life <= 0) { particles.splice(i, 1); continue; }
        ctx.globalAlpha = p.life; ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, 8, 8);
    }
    ctx.globalAlpha = 1.0;
}

function initPatterns() {
    HATCH_PATTERNS = [null];
    for (let i = 1; i < COLORS.length; i++) {
        const pCanvas = document.createElement('canvas');
        pCanvas.width = 6; pCanvas.height = 6;
        const pCtx = pCanvas.getContext('2d');
        pCtx.strokeStyle = COLORS[i]; pCtx.lineWidth = 1.5;
        pCtx.beginPath(); pCtx.moveTo(0, 6); pCtx.lineTo(6, 0); pCtx.stroke();
        pCtx.beginPath(); pCtx.moveTo(-1, 1); pCtx.lineTo(1, -1); pCtx.stroke();
        pCtx.beginPath(); pCtx.moveTo(5, 7); pCtx.lineTo(7, 5); pCtx.stroke();
        HATCH_PATTERNS.push(ctx.createPattern(pCanvas, 'repeat'));
    }
}

// ================= 遊戲核心邏輯 =================
function startGame(mode) {
    initAudio();
    currentMode = mode;
    
    // 切換畫面
    document.getElementById('main-menu').style.display = 'none';
    document.getElementById('game-layout').style.display = 'flex';
    document.getElementById('pause-overlay').style.display = 'none';
    
    if (requestId) cancelAnimationFrame(requestId);
    
    resetBoard();
    score = 0; lines = 0; level = 1; timeElapsed = 0;
    dropInterval = 1000;
    isPaused = false; isGameOver = false; isAnimating = false;
    particles = []; bag = []; nextQueue = []; holdPiece = null; canHold = true; lockStartTime = null;
    keysPressed = {}; keyRepeatTimers = {}; // 清空按鍵狀態
    
    // UI 調整
    document.getElementById('time-box').style.display = (mode === 'sprint' || mode === 'ultra') ? 'block' : 'none';
    document.getElementById('level-box').style.display = (mode === 'sprint' || mode === 'ultra') ? 'none' : 'block';
    document.getElementById('all-clear-message').classList.remove('show');
    
    updateLeaderboardUI();
    updateScoreUI();
    fillNextQueue();
    playerReset();
    
    gameStartTime = performance.now();
    lastTime = gameStartTime;
    startBGM();
    update(performance.now());
}

function endGame(isWin = false) {
    if (isGameOver) return;
    isGameOver = true;
    keysPressed = {}; // 結束時清空按鍵判定
    stopBGM(); playSFX('gameover');
    cancelAnimationFrame(requestId);
    
    let title = "GAME OVER";
    if (isWin) title = currentMode === 'sprint' ? "SPRINT CLEARED!" : "TIME'S UP!";
    document.getElementById('go-title').innerText = title;
    
    document.getElementById('final-score').innerText = (currentMode === 'sprint') ? formatTime(timeElapsed) : score;
    checkHighScore();
    document.getElementById('game-over-dialog').showModal();
}

function formatTime(ms) {
    let totalSeconds = Math.floor(ms / 1000);
    let minutes = Math.floor(totalSeconds / 60);
    let seconds = totalSeconds % 60;
    let millis = Math.floor((ms % 1000) / 10);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${millis.toString().padStart(2, '0')}`;
}

function updateScoreUI() {
    document.getElementById('score').innerText = score;
    document.getElementById('lines').innerText = currentMode === 'sprint' ? `${lines}/40` : lines;
    document.getElementById('level').innerText = level;
    
    if (currentMode === 'sprint') document.getElementById('time').innerText = formatTime(timeElapsed);
    else if (currentMode === 'ultra') document.getElementById('time').innerText = formatTime(Math.max(0, ULTRA_TIME_LIMIT - timeElapsed));
}

function resetBoard() { board = Array.from({length: ROWS}, () => Array(COLS).fill(0)); }

function generatePiece() {
    if (bag.length === 0) {
        bag = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];
        for (let i = bag.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [bag[i], bag[j]] = [bag[j], bag[i]];
        }
    }
    return bag.pop();
}

function fillNextQueue() { while (nextQueue.length < 4) nextQueue.push(generatePiece()); }
function getPieceMatrix(type) { return PIECES[type].map(row => [...row]); }

function playerReset() {
    if (nextQueue.length === 0) fillNextQueue();
    player.type = nextQueue.shift(); fillNextQueue();
    player.matrix = getPieceMatrix(player.type);
    player.pos.y = 0; player.pos.x = (COLS / 2 | 0) - (Math.ceil(player.matrix[0].length / 2));
    lockStartTime = null; 

    if (collide(board, player)) endGame(false);
    canHold = true;
}

function collide(arena, player) {
    const [m, o] = [player.matrix, player.pos];
    for (let y = 0; y < m.length; ++y) {
        for (let x = 0; x < m[y].length; ++x) {
            if (m[y][x] !== 0 && (arena[y + o.y] && arena[y + o.y][x + o.x]) !== 0) return true;
        }
    }
    return false;
}

function rotate(matrix, dir) {
    if (dir === 2) { rotate(matrix, 1); rotate(matrix, 1); return; }
    for (let y = 0; y < matrix.length; ++y) {
        for (let x = 0; x < y; ++x) [matrix[x][y], matrix[y][x]] = [matrix[y][x], matrix[x][y]];
    }
    if (dir > 0) matrix.forEach(row => row.reverse());
    else matrix.reverse();
}

function resetLockTimer() {
    player.pos.y++; lockStartTime = collide(board, player) ? Date.now() : null; player.pos.y--;
}

function playerRotate(dir) {
    const pos = player.pos.x; const row = player.pos.y;
    rotate(player.matrix, dir);
    const kicks = [[0, 0], [1, 0], [-1, 0], [0, -1], [1, -1], [-1, -1], [2, 0], [-2, 0]];
    for (const [ox, oy] of kicks) {
        player.pos.x = pos + ox; player.pos.y = row + oy;
        if (!collide(board, player)) { playSFX('rotate'); resetLockTimer(); return; }
    }
    rotate(player.matrix, dir === 2 ? 2 : -dir);
    player.pos.x = pos; player.pos.y = row;
}

function playerDrop() {
    player.pos.y++;
    if (collide(board, player)) {
        player.pos.y--; 
        if (lockStartTime === null) lockStartTime = Date.now();
        return; 
    }
    lockStartTime = null; dropCounter = 0;
}

function finalizeMove() {
    playSFX('lock'); merge(board, player); arenaSweep();
    if (!isAnimating) playerReset();
    lockStartTime = null;
}

function triggerShake(type = 'normal') {
    const layout = document.getElementById('game-layout');
    layout.classList.remove('shake', 'hard-drop-shake'); void layout.offsetWidth;
    layout.classList.add(type === 'hard' ? 'hard-drop-shake' : 'shake');
}

function playerHardDrop() {
    while (!collide(board, player)) player.pos.y++;
    player.pos.y--; playSFX('hardDrop'); triggerShake('hard'); finalizeMove();
    score += 20; dropCounter = 0;
}

function merge(arena, player) {
    player.matrix.forEach((row, y) => {
        row.forEach((value, x) => {
            if (value !== 0 && arena[y + player.pos.y] && arena[y + player.pos.y][x + player.pos.x] !== undefined) {
                arena[y + player.pos.y][x + player.pos.x] = value;
            }
        });
    });
}

function arenaSweep() {
    let rowsToClear = [];
    for (let y = ROWS - 1; y >= 0; --y) {
        if (board[y].every(value => value !== 0)) rowsToClear.push(y);
    }

    if (rowsToClear.length > 0) {
        isAnimating = true; triggerShake('normal');
        if (rowsToClear.length >= 4) playSFX('tetris'); else playSFX('clear');

        rowsToClear.forEach(y => {
            for(let x=0; x<COLS; x++) spawnParticles(y, x, board[y][x]);
            board[y].fill(0);
        });
        
        setTimeout(() => {
            board = board.filter((row, y) => !rowsToClear.includes(y));
            while (board.length < ROWS) board.unshift(new Array(COLS).fill(0));

            if (board.every(row => row.every(val => val === 0))) {
                const msg = document.getElementById('all-clear-message');
                msg.classList.remove('show'); void msg.offsetWidth; msg.classList.add('show');
                score += 2000 * level;
            }

            const lineScores = [0, 100, 300, 500, 800];
            const count = rowsToClear.length;
            score += (lineScores[count] || 800) * level;
            lines += count;
            level = Math.floor(lines / 10) + 1;
            dropInterval = Math.max(100, 1000 - (level - 1) * 100);
            
            updateScoreUI();
            if (currentMode === 'sprint' && lines >= 40) endGame(true);

            isAnimating = false; playerReset();
        }, 200);
    }
}

function playerHold() {
    if (!canHold || isPaused || isGameOver || isAnimating) return;
    playSFX('move');
    if (holdPiece === null) {
        holdPiece = player.type; playerReset();
    } else {
        const temp = player.type; player.type = holdPiece; holdPiece = temp;
        player.matrix = getPieceMatrix(player.type);
        player.pos.y = 0; player.pos.x = (COLS / 2 | 0) - (Math.ceil(player.matrix[0].length / 2));
        lockStartTime = null; 
        if (collide(board, player)) endGame(false);
    }
    canHold = false;
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawMatrix(board, {x: 0, y: 0}, ctx);
    
    if (!isGameOver && !isAnimating && player.matrix) {
        drawGhost();
        if (lockStartTime !== null) ctx.globalAlpha = 0.8; 
        drawMatrix(player.matrix, player.pos, ctx);
        ctx.globalAlpha = 1.0;
    }

    updateAndDrawParticles(); drawNext(); drawHold();
}

function drawMatrix(matrix, offset, context) {
    matrix.forEach((row, y) => {
        row.forEach((value, x) => {
            if (value !== 0) {
                const px = (x + offset.x) * BLOCK_SIZE; const py = (y + offset.y) * BLOCK_SIZE;
                context.fillStyle = COLORS[value] + '44'; context.fillRect(px, py, BLOCK_SIZE, BLOCK_SIZE);
                if (HATCH_PATTERNS[value]) {
                    context.fillStyle = HATCH_PATTERNS[value];
                    context.save(); context.translate(px, py); context.fillRect(0, 0, BLOCK_SIZE, BLOCK_SIZE); context.restore();
                }
                context.strokeStyle = 'rgba(0,0,0,0.3)'; context.lineWidth = 1; context.strokeRect(px, py, BLOCK_SIZE, BLOCK_SIZE);
                context.fillStyle = 'rgba(255,255,255,0.3)'; context.fillRect(px, py, BLOCK_SIZE, 2);
            }
        });
    });
}

function drawGhost() {
    const ghost = { pos: {...player.pos}, matrix: player.matrix };
    while(!collide(board, ghost)) ghost.pos.y++;  ghost.pos.y--;
    ghost.matrix.forEach((row, y) => {
        row.forEach((value, x) => {
            if (value !== 0) {
                const px = (x + ghost.pos.x) * BLOCK_SIZE; const py = (y + ghost.pos.y) * BLOCK_SIZE;
                ctx.setLineDash([4, 2]); ctx.lineWidth = 2; ctx.strokeStyle = COLORS[value];
                ctx.strokeRect(px, py, BLOCK_SIZE, BLOCK_SIZE); ctx.setLineDash([]);
            }
        });
    });
}

function drawNext() {
    nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
    for(let i=0; i<3; i++) {
        if(nextQueue[i]) {
            const m = PIECES[nextQueue[i]];
            drawMatrix(m, {x: (4 - m[0].length) / 2, y: i * 4 + 1}, nextCtx);
        }
    }
}

function drawHold() {
    holdCtx.clearRect(0, 0, holdCanvas.width, holdCanvas.height);
    if (holdPiece) {
        const m = PIECES[holdPiece]; drawMatrix(m, {x: (4 - m[0].length) / 2, y: (4 - m.length) / 2}, holdCtx);
    }
}

// 執行指定按鍵的動作
function executeAction(code) {
    let moved = false;
    switch(code) {
        case keybinds.left:
            player.pos.x--; if (collide(board, player)) player.pos.x++; else { resetLockTimer(); moved=true; } break;
        case keybinds.right:
            player.pos.x++; if (collide(board, player)) player.pos.x--; else { resetLockTimer(); moved=true; } break;
        case keybinds.softDrop:
            playerDrop(); moved=true; break;
        case keybinds.rotateCW:
            playerRotate(1); break;
        case keybinds.rotateCCW:
            playerRotate(-1); break;
        case keybinds.rotate180:
            playerRotate(2); break;
        case keybinds.hardDrop:
            playerHardDrop(); break;
        case keybinds.hold:
            playerHold(); break;
    }
    if(moved) playSFX('move');
    draw();
}

function update(time = performance.now()) {
    if (isPaused || isGameOver || document.getElementById('game-layout').style.display === 'none') return;
    const deltaTime = time - lastTime;
    lastTime = time;

    // --- 處理長按連續移動 (DAS/ARR 系統) ---
    for (let code in keysPressed) {
        if (keysPressed[code]) {
            // 只有左右跟軟降需要連續觸發
            if (code === keybinds.left || code === keybinds.right || code === keybinds.softDrop) {
                if (time >= keyRepeatTimers[code]) {
                    executeAction(code);
                    keyRepeatTimers[code] = time + ARR; // 更新為下一次重複觸發的時間
                }
            }
        }
    }

    timeElapsed = performance.now() - gameStartTime;
    updateScoreUI();

    if (currentMode === 'ultra' && timeElapsed >= ULTRA_TIME_LIMIT) {
        endGame(true); return;
    }

    if (!isAnimating) {
        dropCounter += deltaTime;
        if (dropCounter > dropInterval) playerDrop();
        if (lockStartTime !== null && Date.now() - lockStartTime > LOCK_DELAY) finalizeMove();
    }
    
    draw();
    requestId = requestAnimationFrame(update);
}

function handleInput(event) {
    if (listeningKeyAction) {
        event.preventDefault();
        keybinds[listeningKeyAction] = event.code;
        renderSettingsKeys();
        listeningKeyAction = null;
        return;
    }

    if (document.getElementById('game-layout').style.display === 'none') return;
    if (isAnimating || (isGameOver && event.code !== 'Escape')) return;

    if (event.code === 'Escape') {
        isPaused = !isPaused;
        const overlay = document.getElementById('pause-overlay');
        if (isPaused) {
            overlay.style.display = 'flex'; stopBGM(); cancelAnimationFrame(requestId);
            keysPressed = {}; // 暫停時清空按鍵
        } else {
            overlay.style.display = 'none'; startBGM();
            gameStartTime += performance.now() - lastTime;
            lastTime = performance.now();
            update(performance.now());
        }
        return;
    }

    if (isPaused) return;

    // 阻擋所有綁定按鍵的預設瀏覽器行為 (避免空白鍵捲動網頁等)
    if (Object.values(keybinds).includes(event.code)) {
        event.preventDefault();
    }

    // 當按鍵被「第一次」按下時立刻觸發，並啟動延遲計時器 (DAS)
    if (!keysPressed[event.code]) {
        keysPressed[event.code] = true;
        keyRepeatTimers[event.code] = performance.now() + DAS;
        executeAction(event.code);
    }
}