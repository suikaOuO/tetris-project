/* ==========================================
   TETRIS 遊戲核心邏輯 (美化版)
   ========================================== */

const COLS = 10;
const ROWS = 20;
const BLOCK_SIZE = 30;

const PIECES = {
    'I': [[0,0,0,0], [1,1,1,1], [0,0,0,0], [0,0,0,0]],
    'J': [[2,0,0], [2,2,2], [0,0,0]],
    'L': [[0,0,3], [3,3,3], [0,0,0]],
    'O': [[4,4], [4,4]],
    'S': [[0,5,5], [5,5,0], [0,0,0]],
    'T': [[0,6,0], [6,6,6], [0,0,0]],
    'Z': [[7,7,0], [0,7,7], [0,0,0]]
};

// 顏色更鮮豔一點，像麥克筆
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
// 新增：動畫狀態標記
let isAnimating = false;

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
    isAnimating = false;
    
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
        arenaSweep(); // 這裡會處理消除動畫
        if (!isAnimating) playerReset(); // 如果有動畫，等待動畫結束再生成
    }
    dropCounter = 0;
}

// 觸發震動特效
function triggerShake() {
    const layout = document.getElementById('game-layout');
    layout.classList.remove('shake');
    void layout.offsetWidth; // 觸發重繪
    layout.classList.add('shake');
}

function playerHardDrop() {
    while (!collide(board, player)) {
        player.pos.y++;
    }
    player.pos.y--;
    merge(board, player);
    score += 20;
    triggerShake(); // Hard Drop 加入震動
    arenaSweep();
    if (!isAnimating) playerReset();
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

// 修改：加入簡單的消除閃爍邏輯
function arenaSweep() {
    let rowsToClear = [];
    
    // 1. 找出需要消除的行
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
        
        // 2. 閃爍效果：暫時把這些行變白色 (color index 0 or special)
        // 為了簡單，我們直接在 drawMatrix 裡動手腳，或是短暫停止更新
        // 這裡用一個簡單的 timeout 模擬動畫
        
        // 標記這些行 (用特殊數字，例如 9 代表閃爍)
        rowsToClear.forEach(y => {
            board[y].fill(9); 
        });
        draw(); // 重繪顯示白色行

        setTimeout(() => {
            // 3. 實際消除資料
            rowsToClear.forEach(() => {
                // 由於我們剛才把行變成 9 了，現在要刪除這些行
                // 注意：因為 rowsToClear 紀錄的是原始索引，但我們用 splice 會改變索引
                // 所以最簡單的方法是重新掃描一次 board 移除所有包含 9 的行
                for(let y = board.length - 1; y >= 0; y--) {
                    if (board[y][0] === 9) { // 檢查是否為標記行
                        board.splice(y, 1);
                        board.unshift(new Array(COLS).fill(0));
                        y++; // 保持索引正確
                    }
                }
            });

            // 4. 計算分數
            const lineScores = [0, 100, 300, 500, 800];
            score += lineScores[rowsToClear.length] * level;
            lines += rowsToClear.length;
            level = Math.floor(lines / 10) + 1;
            dropInterval = Math.max(100, 1000 - (level - 1) * 100);
            updateScoreUI();

            isAnimating = false;
            playerReset(); // 動畫結束後生成新方塊
            draw();
        }, 150); // 150ms 閃爍時間
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
        if (collide(board, player)) endGame();
    }
    canHold = false;
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawMatrix(board, {x: 0, y: 0}, ctx);
    
    if (!isGameOver && !isAnimating && player.matrix) {
        drawGhost();
        drawMatrix(player.matrix, player.pos, ctx);
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
                
                // 9 代表消除動畫中的白色閃爍
                if (value === 9) {
                    context.fillStyle = '#ffffff';
                    context.fillRect(px, py, BLOCK_SIZE, BLOCK_SIZE);
                    return;
                }

                context.fillStyle = COLORS[value];
                context.fillRect(px, py, BLOCK_SIZE, BLOCK_SIZE);
                
                context.strokeStyle = 'rgba(0,0,0,0.2)'; // 加深邊框
                context.lineWidth = 1;
                context.strokeRect(px, py, BLOCK_SIZE, BLOCK_SIZE);

                // 亮面細節 (讓它看起來像有厚度的紙或貼紙)
                context.fillStyle = 'rgba(255,255,255,0.4)';
                context.fillRect(px, py, BLOCK_SIZE, 3); // Top highlight
                context.fillRect(px, py, 3, BLOCK_SIZE); // Left highlight
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
                // 虛線風格
                context.setLineDash([4, 2]);
                context.lineWidth = 2;
                context.strokeStyle = COLORS[value];
                context.strokeRect(px, py, BLOCK_SIZE, BLOCK_SIZE);
                context.setLineDash([]); // Reset
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

    // 如果正在播放動畫，不執行落下邏輯
    if (!isAnimating) {
        dropCounter += deltaTime;
        if (dropCounter > dropInterval) {
            playerDrop();
        }
    }
    
    draw();
    requestId = requestAnimationFrame(update);
}

function handleInput(event) {
    // 動畫期間鎖定操作
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