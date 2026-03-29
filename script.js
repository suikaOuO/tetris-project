/* ==========================================
   TETRIS 遊戲核心邏輯 (音效 + 特效 + 模式 + 排行榜)
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

// --- 新增：遊戲模式與計時器 ---
let currentMode = 'marathon'; // marathon, sprint, ultra
let gameStartTime = 0;
let timeElapsed = 0;
const ULTRA_TIME_LIMIT = 120000; // 2分鐘 = 120,000 毫秒

// --- 新增：視覺特效 (VFX) ---
let particles = [];

// --- 新增：音訊系統 (Web Audio API) ---
let audioCtx;
let isMuted = false;
let bgmOscillator = null;
let bgmGain = null;
let bgmInterval = null;

window.onload = function() {
    canvas = document.getElementById('main-canvas');
    ctx = canvas.getContext('2d');
    nextCanvas = document.getElementById('next-canvas');
    nextCtx = nextCanvas.getContext('2d');
    holdCanvas = document.getElementById('hold-canvas');
    holdCtx = holdCanvas.getContext('2d');

    initPatterns();
    loadLeaderboard();

    document.getElementById('btn-mute').addEventListener('click', toggleMute);
    document.getElementById('btn-end').addEventListener('click', () => endGame(false));
    document.addEventListener('keydown', handleInput);

    resetBoard();
    draw(); 
};

// ================= 排行榜系統 =================
function loadLeaderboard() {
    const data = JSON.parse(localStorage.getItem('tetrisLeaderboard')) || { marathon: 0, sprint: 999999, ultra: 0 };
    
    document.getElementById('lb-marathon').innerText = data.marathon > 0 ? data.marathon + ' 分' : '-';
    document.getElementById('lb-sprint').innerText = data.sprint < 999999 ? formatTime(data.sprint) : '-';
    document.getElementById('lb-ultra').innerText = data.ultra > 0 ? data.ultra + ' 分' : '-';
    return data;
}

function checkHighScore() {
    const data = loadLeaderboard();
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
        loadLeaderboard();
    } else {
        document.getElementById('new-record-box').style.display = 'none';
        let desc = currentMode === 'sprint' ? `時間: ${formatTime(timeElapsed)}` : `分數: ${score}`;
        document.getElementById('go-desc').innerText = `最終${desc}`;
    }
}

function saveAndReset() {
    document.getElementById('game-over-dialog').close();
    document.getElementById('start-menu-dialog').showModal();
    resetBoard();
    draw();
}

// ================= 音訊系統 =================
function initAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
}

function toggleMute() {
    isMuted = !isMuted;
    document.getElementById('btn-mute').innerText = isMuted ? '🔈 聲音: 關' : '🔊 聲音: 開';
    if (isMuted) stopBGM();
    else if (!isGameOver && !isPaused) startBGM();
}

function playTone(freq, type, duration, vol=0.1) {
    if (isMuted || !audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(vol, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
}

function playSFX(type) {
    if(isMuted) return;
    initAudio();
    switch(type) {
        case 'move': playTone(400, 'sine', 0.1, 0.05); break;
        case 'rotate': playTone(600, 'square', 0.1, 0.05); break;
        case 'lock': playTone(150, 'triangle', 0.15, 0.2); break;
        case 'hardDrop': playTone(100, 'sawtooth', 0.2, 0.3); break;
        case 'clear': 
            playTone(800, 'sine', 0.1, 0.1); 
            setTimeout(() => playTone(1200, 'sine', 0.3, 0.1), 100); 
            break;
        case 'tetris': // 4行消除
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

// 簡易 8-bit 背景音樂琶音器
function startBGM() {
    if(isMuted || bgmInterval) return;
    initAudio();
    const notes = [261.63, 329.63, 392.00, 523.25]; // C E G C
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

// ================= 特效系統 =================
function spawnParticles(y, x, colorIndex) {
    const color = COLORS[colorIndex] || '#fff';
    for(let i=0; i<8; i++) {
        particles.push({
            x: x * BLOCK_SIZE + BLOCK_SIZE/2,
            y: y * BLOCK_SIZE + BLOCK_SIZE/2,
            vx: (Math.random() - 0.5) * 15,
            vy: (Math.random() - 1) * 10,
            life: 1.0,
            color: color
        });
    }
}

function updateAndDrawParticles() {
    if(particles.length === 0) return;
    for(let i=particles.length-1; i>=0; i--) {
        let p = particles[i];
        p.x += p.vx; p.y += p.vy;
        p.vy += 0.8; // 重力
        p.life -= 0.03;
        
        if(p.life <= 0) { particles.splice(i, 1); continue; }
        
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, 8, 8);
    }
    ctx.globalAlpha = 1.0;
}

// ================= 遊戲主邏輯 =================
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

// 由開始選單呼叫
function startGame(mode) {
    initAudio();
    currentMode = mode;
    document.getElementById('start-menu-dialog').close();
    
    if (requestId) cancelAnimationFrame(requestId);
    
    resetBoard();
    score = 0; lines = 0; level = 1; timeElapsed = 0;
    dropInterval = 1000;
    isPaused = false; isGameOver = false; isAnimating = false;
    particles = [];
    bag = []; nextQueue = []; holdPiece = null; canHold = true; lockStartTime = null;
    
    // UI 調整
    document.getElementById('time-box').style.display = (mode === 'sprint' || mode === 'ultra') ? 'block' : 'none';
    document.getElementById('level-box').style.display = (mode === 'sprint' || mode === 'ultra') ? 'none' : 'block';
    document.getElementById('btn-end').disabled = false;
    document.getElementById('pause-overlay').style.display = 'none';
    document.getElementById('all-clear-message').classList.remove('show');
    
    updateScoreUI();
    fillNextQueue();
    playerReset();
    
    gameStartTime = performance.now();
    lastTime = gameStartTime;
    startBGM();
    update();
}

function endGame(isWin = false) {
    if (isGameOver) return;
    isGameOver = true;
    stopBGM();
    playSFX('gameover');
    cancelAnimationFrame(requestId);
    document.getElementById('btn-end').disabled = true;
    
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
    
    if (currentMode === 'sprint') {
        document.getElementById('time').innerText = formatTime(timeElapsed);
    } else if (currentMode === 'ultra') {
        let timeLeft = Math.max(0, ULTRA_TIME_LIMIT - timeElapsed);
        document.getElementById('time').innerText = formatTime(timeLeft);
    }
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
    const type = nextQueue.shift();
    fillNextQueue();
    player.matrix = getPieceMatrix(type);
    player.type = type;
    player.pos.y = 0;
    player.pos.x = (COLS / 2 | 0) - (Math.ceil(player.matrix[0].length / 2));
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
    player.pos.y++;
    lockStartTime = collide(board, player) ? Date.now() : null;
    player.pos.y--;
}

function playerRotate(dir) {
    const pos = player.pos.x; const row = player.pos.y;
    rotate(player.matrix, dir);
    const kicks = [[0, 0], [1, 0], [-1, 0], [0, -1], [1, -1], [-1, -1], [2, 0], [-2, 0]];
    for (const [ox, oy] of kicks) {
        player.pos.x = pos + ox; player.pos.y = row + oy;
        if (!collide(board, player)) {
            playSFX('rotate'); resetLockTimer(); return;
        }
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
    lockStartTime = null; 
    dropCounter = 0;
}

function finalizeMove() {
    playSFX('lock');
    merge(board, player);
    arenaSweep();
    if (!isAnimating) playerReset();
    lockStartTime = null;
}

function triggerShake(type = 'normal') {
    const layout = document.getElementById('game-layout');
    layout.classList.remove('shake', 'hard-drop-shake');
    void layout.offsetWidth;
    layout.classList.add(type === 'hard' ? 'hard-drop-shake' : 'shake');
}

function playerHardDrop() {
    while (!collide(board, player)) player.pos.y++;
    player.pos.y--;
    playSFX('hardDrop');
    triggerShake('hard');
    finalizeMove();
    score += 20;
    dropCounter = 0;
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
        isAnimating = true;
        triggerShake('normal');
        
        // 音效與特效
        if (rowsToClear.length >= 4) playSFX('tetris');
        else playSFX('clear');

        rowsToClear.forEach(y => {
            for(let x=0; x<COLS; x++) spawnParticles(y, x, board[y][x]);
            board[y].fill(0); // 直接挖空讓粒子顯示
        });
        
        // 延遲讓粒子飛一下再補齊方塊
        setTimeout(() => {
            board = board.filter((row, y) => !rowsToClear.includes(y));
            while (board.length < ROWS) board.unshift(new Array(COLS).fill(0));

            let isAllClear = board.every(row => row.every(val => val === 0));
            if (isAllClear) {
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
            
            // 檢查衝刺模式勝利條件
            if (currentMode === 'sprint' && lines >= 40) {
                endGame(true);
            }

            isAnimating = false;
            playerReset();
        }, 200);
    }
}

function playerHold() {
    if (!canHold || isPaused || isGameOver || isAnimating) return;
    playSFX('move');
    if (holdPiece === null) {
        holdPiece = player.type;
        playerReset();
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

    updateAndDrawParticles();
    drawNext(); drawHold();
}

function drawMatrix(matrix, offset, context) {
    matrix.forEach((row, y) => {
        row.forEach((value, x) => {
            if (value !== 0) {
                const px = (x + offset.x) * BLOCK_SIZE;
                const py = (y + offset.y) * BLOCK_SIZE;
                context.fillStyle = COLORS[value] + '44'; 
                context.fillRect(px, py, BLOCK_SIZE, BLOCK_SIZE);
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
    while(!collide(board, ghost)) ghost.pos.y++; 
    ghost.pos.y--;
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
        const m = PIECES[holdPiece];
        drawMatrix(m, {x: (4 - m[0].length) / 2, y: (4 - m.length) / 2}, holdCtx);
    }
}

function update(time = 0) {
    if (isPaused || isGameOver) return;
    const deltaTime = time - lastTime;
    lastTime = time;

    // 更新計時器
    timeElapsed = performance.now() - gameStartTime;
    updateScoreUI();

    // 檢查計時賽結束條件
    if (currentMode === 'ultra' && timeElapsed >= ULTRA_TIME_LIMIT) {
        endGame(true);
        return;
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
    if (isAnimating) return;
    if (isGameOver && event.keyCode !== 27) return;

    if (event.keyCode === 27) { // ESC
        if (!document.getElementById('btn-end').disabled) {
            isPaused = !isPaused;
            const overlay = document.getElementById('pause-overlay');
            if (isPaused) {
                overlay.style.display = 'flex'; stopBGM(); cancelAnimationFrame(requestId);
            } else {
                overlay.style.display = 'none'; startBGM();
                // 暫停恢復時，校正時間避免計時器亂跳
                gameStartTime += performance.now() - lastTime;
                lastTime = performance.now();
                update();
            }
        }
        return;
    }

    if (isPaused) return;
    if([32, 73, 74, 75, 76, 79, 85].includes(event.keyCode)) event.preventDefault();

    let moved = false;
    switch(event.keyCode) {
        case 74: // J (Left)
            player.pos.x--;
            if (collide(board, player)) player.pos.x++; else { resetLockTimer(); moved=true; }
            break;
        case 76: // L (Right)
            player.pos.x++;
            if (collide(board, player)) player.pos.x--; else { resetLockTimer(); moved=true; }
            break;
        case 75: // K (Down/Soft Drop)
            playerDrop(); moved=true; break;
        case 73: // I (Rotate CW)
            playerRotate(1); break;
        case 85: // U (Rotate CCW)
            playerRotate(-1); break;
        case 79: // O (Rotate 180)
            playerRotate(2); break;
        case 32: // Space (Hard Drop)
            playerHardDrop(); break;
        case 16: // Shift
        case 67: // C
            playerHold(); break;
    }
    if(moved) playSFX('move');
    draw();
}