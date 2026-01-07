/* ==========================================
   TETRIS 遊戲核心邏輯
   ========================================== */

const COLS = 10;
const ROWS = 20;
const BLOCK_SIZE = 30; // 配合 CSS background-size: 30px

// 定義方塊 (I, J, L, O, S, T, Z)
// 這是原始定義，絕對不能被修改
const PIECES = {
    'I': [[0,0,0,0], [1,1,1,1], [0,0,0,0], [0,0,0,0]],
    'J': [[2,0,0], [2,2,2], [0,0,0]],
    'L': [[0,0,3], [3,3,3], [0,0,0]],
    'O': [[4,4], [4,4]],
    'S': [[0,5,5], [5,5,0], [0,0,0]],
    'T': [[0,6,0], [6,6,6], [0,0,0]],
    'Z': [[7,7,0], [0,7,7], [0,0,0]]
};

// 顏色定義
const COLORS = [
    null,
    '#06b6d4', // I - Cyan
    '#3b82f6', // J - Blue
    '#f97316', // L - Orange
    '#eab308', // O - Yellow
    '#22c55e', // S - Green
    '#a855f7', // T - Purple
    '#ef4444'  // Z - Red
];

// 遊戲狀態
let canvas, ctx, nextCanvas, nextCtx, holdCanvas, holdCtx;
let board = [];
let score = 0, lines = 0, level = 1;
let dropCounter = 0, dropInterval = 1000, lastTime = 0;
let isPaused = false, isGameOver = false, requestId = null;
let bag = [], nextQueue = [], holdPiece = null, canHold = true;

let player = { pos: {x: 0, y: 0}, matrix: null, type: null };

window.onload = function() {
    canvas = document.getElementById('main-canvas');
    ctx = canvas.getContext('2d');
    nextCanvas = document.getElementById('next-canvas');
    nextCtx = nextCanvas.getContext('2d');
    holdCanvas = document.getElementById('hold-canvas');
    holdCtx = holdCanvas.getContext('2d');

    document.getElementById('btn-start').addEventListener('click', startGame);
    document.getElementById('btn-end').addEventListener('click', endGame);
    document.addEventListener('keydown', handleInput);

    resetBoard();
    draw(); 
};

function startGame() {
    if (requestId) cancelAnimationFrame(requestId);
    
    resetBoard();
    score = 0; lines = 0; level = 1;
    dropInterval = 1000;
    isPaused = false; isGameOver = false;
    
    bag = []; nextQueue = []; holdPiece = null; canHold = true;
    
    updateScoreUI();
    toggleButtons(true);
    document.getElementById('pause-overlay').style.display = 'none';
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

// 7-Bag Randomizer
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

function fillNextQueue() {
    while (nextQueue.length < 4) {
        nextQueue.push(generatePiece());
    }
}

// === 核心修正處：取得方塊矩陣的複本 ===
function getPieceMatrix(type) {
    // 使用 map 進行深拷貝 (Deep Copy)，確保不修改原始 PIECES 定義
    return PIECES[type].map(row => [...row]);
}

function playerReset() {
    if (nextQueue.length === 0) fillNextQueue();
    const type = nextQueue.shift();
    fillNextQueue();

    // 修正：這裡改用 getPieceMatrix 取得複本
    player.matrix = getPieceMatrix(type);
    player.type = type;
    
    player.pos.y = 0;
    player.pos.x = (COLS / 2 | 0) - (Math.ceil(player.matrix[0].length / 2));

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

function rotate(matrix, dir) {
    for (let y = 0; y < matrix.length; ++y) {
        for (let x = 0; x < y; ++x) {
            [matrix[x][y], matrix[y][x]] = [matrix[y][x], matrix[x][y]];
        }
    }
    if (dir > 0) matrix.forEach(row => row.reverse());
    else matrix.reverse();
}

function playerRotate(dir) {
    const pos = player.pos.x;
    let offset = 1;
    
    // 這裡旋轉的是 player.matrix (複本)，所以不會影響 PIECES
    rotate(player.matrix, dir);
    
    while (collide(board, player)) {
        player.pos.x += offset;
        offset = -(offset + (offset > 0 ? 1 : -1));
        if (offset > player.matrix[0].length) {
            rotate(player.matrix, -dir);
            player.pos.x = pos;
            return;
        }
    }
}

function playerDrop() {
    player.pos.y++;
    if (collide(board, player)) {
        player.pos.y--;
        merge(board, player);
        arenaSweep();
        playerReset();
    }
    dropCounter = 0;
}

function playerHardDrop() {
    while (!collide(board, player)) {
        player.pos.y++;
    }
    player.pos.y--;
    merge(board, player);
    score += 20;
    arenaSweep();
    playerReset();
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
    let rowCount = 0;
    outer: for (let y = ROWS - 1; y >= 0; --y) {
        for (let x = 0; x < COLS; ++x) {
            if (board[y][x] === 0) continue outer;
        }
        const row = board.splice(y, 1)[0].fill(0);
        board.unshift(row);
        ++y;
        rowCount++;
    }
    if (rowCount > 0) {
        const lineScores = [0, 100, 300, 500, 800];
        score += lineScores[rowCount] * level;
        lines += rowCount;
        level = Math.floor(lines / 10) + 1;
        dropInterval = Math.max(100, 1000 - (level - 1) * 100);
        updateScoreUI();
    }
}

function playerHold() {
    if (!canHold || isPaused || isGameOver) return;
    
    if (holdPiece === null) {
        holdPiece = player.type;
        playerReset();
    } else {
        const temp = player.type;
        player.type = holdPiece;
        holdPiece = temp;
        
        // 修正：交換出來的方塊也要使用複本
        player.matrix = getPieceMatrix(player.type);
        
        player.pos.y = 0;
        player.pos.x = (COLS / 2 | 0) - (Math.ceil(player.matrix[0].length / 2));
        if (collide(board, player)) endGame();
    }
    canHold = false;
}

/* --- 渲染 --- */

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawMatrix(board, {x: 0, y: 0}, ctx);
    
    if (!isGameOver && player.matrix) drawGhost();
    if (!isGameOver && player.matrix) drawMatrix(player.matrix, player.pos, ctx);

    drawNext();
    drawHold();
}

function drawMatrix(matrix, offset, context) {
    matrix.forEach((row, y) => {
        row.forEach((value, x) => {
            if (value !== 0) {
                const px = (x + offset.x) * BLOCK_SIZE;
                const py = (y + offset.y) * BLOCK_SIZE;
                
                context.fillStyle = COLORS[value];
                context.fillRect(px, py, BLOCK_SIZE, BLOCK_SIZE);
                
                context.strokeStyle = 'rgba(0,0,0,0.15)';
                context.lineWidth = 1;
                context.strokeRect(px, py, BLOCK_SIZE, BLOCK_SIZE);

                context.fillStyle = 'rgba(255,255,255,0.3)';
                context.fillRect(px, py, BLOCK_SIZE, 3);
                context.fillRect(px, py, 3, BLOCK_SIZE);
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
                context.lineWidth = 2;
                context.strokeStyle = COLORS[value];
                context.strokeRect(px, py, BLOCK_SIZE, BLOCK_SIZE);
            }
        });
    });
}

function drawNext() {
    nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
    let offsetY = 1;
    for(let i=0; i<3; i++) {
        if(nextQueue[i]) {
            // 這裡直接讀取 PIECES (原始定義)，因為 player 已經用複本操作，所以這裡永遠是初始狀態
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
        // 同理，讀取 PIECES 原始定義
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

    dropCounter += deltaTime;
    if (dropCounter > dropInterval) {
        playerDrop();
    }
    draw();
    requestId = requestAnimationFrame(update);
}

function handleInput(event) {
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

    if([32, 37, 38, 39, 40].includes(event.keyCode)) event.preventDefault();

    switch(event.keyCode) {
        case 37: // Left
            player.pos.x--;
            if (collide(board, player)) player.pos.x++;
            break;
        case 39: // Right
            player.pos.x++;
            if (collide(board, player)) player.pos.x--;
            break;
        case 40: // Down
            playerDrop();
            break;
        case 38: // Up
            playerRotate(1);
            break;
        case 32: // Space
            playerHardDrop();
            break;
        case 16: // Shift
        case 67: // C
            playerHold();
            break;
    }
    draw();
}