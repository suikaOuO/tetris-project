/* ==========================================
   TETRIS 遊戲核心邏輯 (All Clear + IJKL版 + 鎖定延遲修正版)
   ========================================== */

const COLS = 10;
const ROWS = 20;
const BLOCK_SIZE = 30;
const LOCK_DELAY = 500; // 0.5 秒鎖定延遲

const PIECES = {
    'I': [[0,0,0,0], [1,1,1,1], [0,0,0,0], [0,0,0,0]],
    'J': [[2,0,0], [2,2,2], [0,0,0]],
    'L': [[0,0,3], [3,3,3], [0,0,0]],
    'O': [[4,4], [4,4]],
    'S': [[0,5,5], [5,5,0], [0,0,0]],
    'T': [[0,6,0], [6,6,6], [0,0,0]],
    'Z': [[7,7,0], [0,7,7], [0,0,0]]
};

const COLORS = [
    null,
    '#22d3ee', // I
    '#3b82f6', // J
    '#f97316', // L
    '#eab308', // O
    '#22c55e', // S
    '#a855f7', // T
    '#ef4444'  // Z
];

let canvas, ctx, nextCanvas, nextCtx, holdCanvas, holdCtx;
let board = [];
let score = 0, lines = 0, level = 1;
let dropCounter = 0, dropInterval = 1000, lastTime = 0;
let isPaused = false, isGameOver = false, requestId = null;
let bag = [], nextQueue = [], holdPiece = null, canHold = true;
let isAnimating = false;
let HATCH_PATTERNS = [];

// 鎖定延遲變數
let lockStartTime = null;

let player = { pos: {x: 0, y: 0}, matrix: null, type: null };

window.onload = function() {
    canvas = document.getElementById('main-canvas');
    ctx = canvas.getContext('2d');
    nextCanvas = document.getElementById('next-canvas');
    nextCtx = nextCanvas.getContext('2d');
    holdCanvas = document.getElementById('hold-canvas');
    holdCtx = holdCanvas.getContext('2d');

    initPatterns();

    document.getElementById('btn-start').addEventListener('click', startGame);
    document.getElementById('btn-end').addEventListener('click', endGame);
    document.addEventListener('keydown', handleInput);

    resetBoard();
    draw(); 
};

function initPatterns() {
    HATCH_PATTERNS = [null];
    for (let i = 1; i < COLORS.length; i++) {
        const color = COLORS[i];
        const pCanvas = document.createElement('canvas');
        const size = 6; 
        pCanvas.width = size;
        pCanvas.height = size;
        const pCtx = pCanvas.getContext('2d');

        pCtx.strokeStyle = color;
        pCtx.lineWidth = 1.5;
        pCtx.lineCap = 'round';
        
        pCtx.beginPath();
        pCtx.moveTo(0, size);
        pCtx.lineTo(size, 0);
        pCtx.stroke();
        
        pCtx.beginPath();
        pCtx.moveTo(-1, 1);
        pCtx.lineTo(1, -1);
        pCtx.stroke();

        pCtx.beginPath();
        pCtx.moveTo(size - 1, size + 1);
        pCtx.lineTo(size + 1, size - 1);
        pCtx.stroke();

        const pattern = ctx.createPattern(pCanvas, 'repeat');
        HATCH_PATTERNS.push(pattern);
    }
}

function startGame() {
    if (requestId) cancelAnimationFrame(requestId);
    
    resetBoard();
    score = 0; lines = 0; level = 1;
    dropInterval = 1000;
    isPaused = false; isGameOver = false;
    isAnimating = false;
    
    bag = []; nextQueue = []; holdPiece = null; canHold = true;
    lockStartTime = null; // 重置鎖定計時
    
    updateScoreUI();
    toggleButtons(true);
    document.getElementById('pause-overlay').style.display = 'none';
    document.getElementById('all-clear-message').classList.remove('show');
    document.getElementById('game-over-dialog').close();

    fillNextQueue();
    playerReset();
    
    lastTime = performance.now();
    update();
}

function endGame() {
    if (isGameOver) return;
    isGameOver = true;
    cancelAnimationFrame(requestId);
    toggleButtons(false);
    
    document.getElementById('final-score').innerText = score;
    document.getElementById('game-over-dialog').showModal();
}

function resetGame() {
    document.getElementById('game-over-dialog').close();
    startGame();
}

function toggleButtons(isPlaying) {
    document.getElementById('btn-start').disabled = isPlaying;
    document.getElementById('btn-end').disabled = !isPlaying;
}

function updateScoreUI() {
    document.getElementById('score').innerText = score;
    document.getElementById('lines').innerText = lines;
    document.getElementById('level').innerText = level;
}

function resetBoard() {
    board = Array.from({length: ROWS}, () => Array(COLS).fill(0));
}

function generatePiece() {
    if (bag.length === 0) {
        bag = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];
        // Fisher-Yates Shuffle
        for (let i = bag.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [bag[i], bag[j]] = [bag[j], bag[i]];
        }
    }
    return bag.pop();
}

function fillNextQueue() {
    while (nextQueue.length < 4) {
        nextQueue.push(generatePiece());
    }
}

function getPieceMatrix(type) {
    return PIECES[type].map(row => [...row]);
}

function playerReset() {
    if (nextQueue.length === 0) fillNextQueue();
    const type = nextQueue.shift();
    fillNextQueue();

    player.matrix = getPieceMatrix(type);
    player.type = type;
    player.pos.y = 0;
    player.pos.x = (COLS / 2 | 0) - (Math.ceil(player.matrix[0].length / 2));

    lockStartTime = null; // 新方塊開始時重置鎖定計時

    if (collide(board, player)) {
        endGame();
    }
    canHold = true;
}

function collide(arena, player) {
    const [m, o] = [player.matrix, player.pos];
    for (let y = 0; y < m.length; ++y) {
        for (let x = 0; x < m[y].length; ++x) {
            if (m[y][x] !== 0 &&
               (arena[y + o.y] && arena[y + o.y][x + o.x]) !== 0) {
                return true;
            }
        }
    }
    return false;
}

// 矩陣旋轉演算法
function rotate(matrix, dir) {
    if (dir === 2) {
        rotate(matrix, 1);
        rotate(matrix, 1);
        return;
    }
    for (let y = 0; y < matrix.length; ++y) {
        for (let x = 0; x < y; ++x) {
            [matrix[x][y], matrix[y][x]] = [matrix[y][x], matrix[x][y]];
        }
    }
    if (dir > 0) matrix.forEach(row => row.reverse());
    else matrix.reverse();
}

// 重置鎖定計時器 (修正版：加入 else 清除邏輯)
function resetLockTimer() {
    // 預先檢查下方是否有碰撞 (是否著地)
    player.pos.y++;
    if (collide(board, player)) {
        // 如果著地，重置鎖定時間 (延長鎖定)
        lockStartTime = Date.now();
    } else {
        // 如果懸空 (例如滑出邊緣)，必須清除鎖定時間！
        // 否則系統會以為還在地面，導致半空中鎖定
        lockStartTime = null; 
    }
    player.pos.y--;
}

function playerRotate(dir) {
    const pos = player.pos.x;
    const row = player.pos.y;
    rotate(player.matrix, dir);
    
    // Wall Kick & Floor Kick
    const kicks = [
        [0, 0],   // 原地
        [1, 0],   // 右移
        [-1, 0],  // 左移
        [0, -1],  // 上移 (踢地)
        [1, -1],  // 右上
        [-1, -1], // 左上
        [2, 0],   // 右移2格
        [-2, 0]   // 左移2格
    ];

    for (const [ox, oy] of kicks) {
        player.pos.x = pos + ox;
        player.pos.y = row + oy;
        if (!collide(board, player)) {
            resetLockTimer(); // 旋轉成功，依據是否著地重置/清除計時
            return;
        }
    }

    // 全部失敗則轉回去
    rotate(player.matrix, dir === 2 ? 2 : -dir);
    player.pos.x = pos;
    player.pos.y = row;
}

function playerDrop() {
    player.pos.y++;
    if (collide(board, player)) {
        player.pos.y--; // 退回上方
        
        // --- 鎖定延遲邏輯 ---
        if (lockStartTime === null) {
            lockStartTime = Date.now(); // 開始計時
        }
        return; 
    }
    
    // 成功下落，重置鎖定狀態
    lockStartTime = null; 
    dropCounter = 0;
}

// 執行真正的鎖定
function finalizeMove() {
    merge(board, player);
    arenaSweep();
    if (!isAnimating) playerReset();
    lockStartTime = null;
}

function triggerShake() {
    const layout = document.getElementById('game-layout');
    layout.classList.remove('shake');
    void layout.offsetWidth;
    layout.classList.add('shake');
}

function showAllClear() {
    const msg = document.getElementById('all-clear-message');
    msg.classList.remove('show');
    void msg.offsetWidth;
    msg.classList.add('show');
    score += 2000 * level;
    updateScoreUI();
}

function playerHardDrop() {
    while (!collide(board, player)) {
        player.pos.y++;
    }
    player.pos.y--;
    
    // 硬降直接忽略延遲
    finalizeMove();
    score += 20;
    dropCounter = 0;
}

function merge(arena, player) {
    player.matrix.forEach((row, y) => {
        row.forEach((value, x) => {
            if (value !== 0) {
                if (arena[y + player.pos.y] && arena[y + player.pos.y][x + player.pos.x] !== undefined) {
                    arena[y + player.pos.y][x + player.pos.x] = value;
                }
            }
        });
    });
}

function arenaSweep() {
    let rowsToClear = [];
    
    for (let y = ROWS - 1; y >= 0; --y) {
        let isFull = true;
        for (let x = 0; x < COLS; ++x) {
            if (board[y][x] === 0) {
                isFull = false;
                break;
            }
        }
        if (isFull) {
            rowsToClear.push(y);
        }
    }

    if (rowsToClear.length > 0) {
        isAnimating = true;
        triggerShake();

        rowsToClear.forEach(y => {
            board[y].fill(9); 
        });
        draw(); 

        setTimeout(() => {
            // 移除行
            rowsToClear.forEach(() => {
                for(let y = board.length - 1; y >= 0; y--) {
                    if (board[y][0] === 9) {
                        board.splice(y, 1);
                        board.unshift(new Array(COLS).fill(0));
                        y++;
                    }
                }
            });

            let isAllClear = true;
            for (let y = 0; y < ROWS; y++) {
                for (let x = 0; x < COLS; x++) {
                    if (board[y][x] !== 0) {
                        isAllClear = false;
                        break;
                    }
                }
                if (!isAllClear) break;
            }
            
            if (isAllClear) {
                showAllClear();
            }

            const lineScores = [0, 100, 300, 500, 800];
            score += lineScores[rowsToClear.length] * level;
            lines += rowsToClear.length;
            level = Math.floor(lines / 10) + 1;
            dropInterval = Math.max(100, 1000 - (level - 1) * 100);
            updateScoreUI();

            isAnimating = false;
            playerReset();
            draw();
        }, 150);
    }
}

function playerHold() {
    if (!canHold || isPaused || isGameOver || isAnimating) return;
    
    if (holdPiece === null) {
        holdPiece = player.type;
        playerReset();
    } else {
        const temp = player.type;
        player.type = holdPiece;
        holdPiece = temp;
        player.matrix = getPieceMatrix(player.type);
        player.pos.y = 0;
        player.pos.x = (COLS / 2 | 0) - (Math.ceil(player.matrix[0].length / 2));
        
        lockStartTime = null; // Hold 後重置鎖定
        if (collide(board, player)) endGame();
    }
    canHold = false;
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawMatrix(board, {x: 0, y: 0}, ctx);
    
    if (!isGameOver && !isAnimating && player.matrix) {
        drawGhost();
        
        // 視覺提示：如果快要鎖定了，可以改變透明度
        if (lockStartTime !== null) {
            ctx.globalAlpha = 0.8; 
        }
        drawMatrix(player.matrix, player.pos, ctx);
        ctx.globalAlpha = 1.0;
    }

    drawNext();
    drawHold();
}

function drawMatrix(matrix, offset, context) {
    matrix.forEach((row, y) => {
        row.forEach((value, x) => {
            if (value !== 0) {
                const px = (x + offset.x) * BLOCK_SIZE;
                const py = (y + offset.y) * BLOCK_SIZE;
                
                if (value === 9) {
                    context.fillStyle = '#ffffff';
                    context.fillRect(px, py, BLOCK_SIZE, BLOCK_SIZE);
                    return;
                }

                context.fillStyle = COLORS[value] + '44'; 
                context.fillRect(px, py, BLOCK_SIZE, BLOCK_SIZE);

                if (HATCH_PATTERNS[value]) {
                    context.fillStyle = HATCH_PATTERNS[value];
                    context.save();
                    context.translate(px, py); 
                    context.fillRect(0, 0, BLOCK_SIZE, BLOCK_SIZE);
                    context.restore();
                }

                context.strokeStyle = 'rgba(0,0,0,0.3)';
                context.lineWidth = 1;
                context.strokeRect(px, py, BLOCK_SIZE, BLOCK_SIZE);

                context.fillStyle = 'rgba(255,255,255,0.3)';
                context.fillRect(px, py, BLOCK_SIZE, 2);
            }
        });
    });
}

function drawGhost() {
    const ghost = { pos: {...player.pos}, matrix: player.matrix };
    while(!collide(board, ghost)) { ghost.pos.y++; }
    ghost.pos.y--;

    ghost.matrix.forEach((row, y) => {
        row.forEach((value, x) => {
            if (value !== 0) {
                const px = (x + ghost.pos.x) * BLOCK_SIZE;
                const py = (y + ghost.pos.y) * BLOCK_SIZE;
                context = ctx;
                context.setLineDash([4, 2]);
                context.lineWidth = 2;
                context.strokeStyle = COLORS[value];
                context.strokeRect(px, py, BLOCK_SIZE, BLOCK_SIZE);
                context.setLineDash([]);
            }
        });
    });
}

function drawNext() {
    nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
    for(let i=0; i<3; i++) {
        if(nextQueue[i]) {
            const m = PIECES[nextQueue[i]];
            const offsetX = (4 - m[0].length) / 2;
            const targetY = i * 4 + 1; 
            drawMatrix(m, {x: offsetX, y: targetY}, nextCtx);
        }
    }
}

function drawHold() {
    holdCtx.clearRect(0, 0, holdCanvas.width, holdCanvas.height);
    if (holdPiece) {
        const m = PIECES[holdPiece];
        const offsetX = (4 - m[0].length) / 2;
        const offsetY = (4 - m.length) / 2; 
        drawMatrix(m, {x: offsetX, y: offsetY}, holdCtx);
    }
}

function update(time = 0) {
    if (isPaused || isGameOver) return;
    const deltaTime = time - lastTime;
    lastTime = time;

    if (!isAnimating) {
        dropCounter += deltaTime;
        if (dropCounter > dropInterval) {
            playerDrop();
        }

        // --- 獨立檢查鎖定延遲 ---
        if (lockStartTime !== null) {
            if (Date.now() - lockStartTime > LOCK_DELAY) {
                finalizeMove();
            }
        }
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
                overlay.style.display = 'flex';
                cancelAnimationFrame(requestId);
            } else {
                overlay.style.display = 'none';
                lastTime = performance.now();
                update();
            }
        }
        return;
    }

    if (isPaused) return;

    if([32, 73, 74, 75, 76, 79, 85].includes(event.keyCode)) event.preventDefault();

    switch(event.keyCode) {
        case 74: // J (Left)
            player.pos.x--;
            if (collide(board, player)) player.pos.x++;
            else resetLockTimer(); // 移動成功重置時間
            break;
        case 76: // L (Right)
            player.pos.x++;
            if (collide(board, player)) player.pos.x--;
            else resetLockTimer(); // 移動成功重置時間
            break;
        case 75: // K (Down/Soft Drop)
            playerDrop();
            break;
        case 73: // I (Rotate CW)
            playerRotate(1);
            break;
        case 85: // U (Rotate CCW)
            playerRotate(-1);
            break;
        case 79: // O (Rotate 180)
            playerRotate(2);
            break;
        case 32: // Space (Hard Drop)
            playerHardDrop();
            break;
        case 16: // Shift
        case 67: // C
            playerHold();
            break;
    }
    draw();
}