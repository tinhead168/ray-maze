(() => {
  "use strict";

  const TILE = 24;
  const COLS = 21;
  const ROWS = 23;
  const DPR = 2;
  const WIDTH = COLS * TILE;
  const HEIGHT = ROWS * TILE;

  const canvas = document.querySelector("#game");
  const ctx = canvas.getContext("2d");
  const overlay = document.querySelector("#overlay");
  const overlayEyebrow = document.querySelector("#overlayEyebrow");
  const overlayTitle = document.querySelector("#overlayTitle");
  const overlayText = document.querySelector("#overlayText");
  const overlayButton = document.querySelector("#overlayButton");
  const scoreNode = document.querySelector("#score");
  const highScoreNode = document.querySelector("#highScore");
  const livesNode = document.querySelector("#lives");
  const toast = document.querySelector("#toast");
  const soundButton = document.querySelector("#soundButton");

  canvas.width = WIDTH * DPR;
  canvas.height = HEIGHT * DPR;
  ctx.imageSmoothingEnabled = false;

  const MAP = [
    "#####################",
    "#o........#........o#",
    "#.###.###.#.###.###.#",
    "#...................#",
    "#.###.#.#####.#.###.#",
    "#.....#...#...#.....#",
    "#####.###.#.###.#####",
    "#.........#.........#",
    "#.###.##.....##.###.#",
    "#.....#..1234..#....#",
    "#####.#.#####.#.#####",
    " ......... ......... ",
    "#####.#.#####.#.#####",
    "#.....#...P...#.....#",
    "#.###.###.#.###.###.#",
    "#o..#.....#.....#..o#",
    "###.#.#.#####.#.#.###",
    "#.....#...#...#.....#",
    "#.#######.#.#######.#",
    "#...................#",
    "#.###.###.#.###.###.#",
    "#o.................o#",
    "#####################"
  ];

  const DIRECTIONS = {
    left:  { x: -1, y: 0, angle: Math.PI },
    right: { x: 1, y: 0, angle: 0 },
    up:    { x: 0, y: -1, angle: -Math.PI / 2 },
    down:  { x: 0, y: 1, angle: Math.PI / 2 }
  };
  const OPPOSITE = { left: "right", right: "left", up: "down", down: "up" };
  const GHOST_COLORS = ["#ff5470", "#60d6cf", "#b178ff", "#ffb44c"];
  const CORNERS = [{x:19,y:1}, {x:1,y:1}, {x:19,y:21}, {x:1,y:21}];

  const spriteAtlas = new Image();
  let spriteFailed = false;
  spriteAtlas.addEventListener("error", () => { spriteFailed = true; });
  spriteAtlas.src = "assets/ray-sprites.png";

  // Offscreen layer for the static maze: background, walls, uneaten regular pellets.
  // Re-rendered only on board reset or pellet pickup — never per frame.
  const mazeLayer = document.createElement("canvas");
  mazeLayer.width = WIDTH * DPR;
  mazeLayer.height = HEIGHT * DPR;
  const mazeCtx = mazeLayer.getContext("2d");

  let grid = [];
  let player;
  let ghosts = [];
  let playerSpawn = { x: 10, y: 13 };
  let ghostSpawns = [];
  let pelletsLeft = 0;
  let score = 0;
  let highScore = readHighScore();
  let lives = 3;
  let state = "ready";
  let nextDirection = "left";
  let frightenedUntil = 0;
  let frightenedChain = 0;
  let modeClock = 0;
  let deathUntil = 0;
  let lastTime = performance.now();
  let soundOn = true;
  let audioContext = null;
  let touchStart = null;
  let chompFlip = false;
  let lastChomp = 0;

  function readHighScore() {
    try { return Number(localStorage.getItem("ray-maze-high-score")) || 0; }
    catch { return 0; }
  }

  function saveHighScore() {
    try { localStorage.setItem("ray-maze-high-score", String(highScore)); }
    catch { /* Local play still works when storage is blocked. */ }
  }

  function resetBoard() {
    grid = MAP.map((row, y) => row.split("").map((cell, x) => {
      if (cell === "P") { playerSpawn = {x, y}; return " "; }
      if (/[1-4]/.test(cell)) { ghostSpawns[Number(cell) - 1] = {x, y}; return " "; }
      return cell;
    }));
    pelletsLeft = grid.flat().filter(cell => cell === "." || cell === "o").length;
    renderMazeLayer();
    score = 0;
    lives = 3;
    frightenedUntil = 0;
    frightenedChain = 0;
    modeClock = 0;
    resetActors();
    updateHud();
  }

  function makeActor(spawn, dir, speed) {
    return { x: spawn.x, y: spawn.y, tx: spawn.x, ty: spawn.y, t: 0, dir, speed, spawn: {...spawn} };
  }

  function resetActors() {
    player = makeActor(playerSpawn, "left", 7.1);
    nextDirection = "left";
    ghosts = ghostSpawns.map((spawn, index) => ({
      ...makeActor(spawn, index % 2 ? "left" : "right", 5.25 + index * .08),
      index
    }));
  }

  function normalizeX(x) { return (x + COLS) % COLS; }

  function isWall(x, y) {
    if (y < 0 || y >= ROWS) return true;
    return grid[y][normalizeX(x)] === "#";
  }

  function canMove(actor, direction) {
    const d = DIRECTIONS[direction];
    return !isWall(actor.x + d.x, actor.y + d.y);
  }

  function targetActor(actor, direction) {
    const d = DIRECTIONS[direction];
    actor.dir = direction;
    actor.tx = actor.x + d.x;
    actor.ty = actor.y + d.y;
  }

  function actorPosition(actor) {
    let x = actor.x + (actor.tx - actor.x) * actor.t;
    const y = actor.y + (actor.ty - actor.y) * actor.t;
    if (x < -.5) x += COLS;
    if (x > COLS - .5) x -= COLS;
    return {x, y};
  }

  function advance(actor, dt, chooseDirection, onArrival) {
    let distance = actor.speed * dt;
    let guard = 0;
    while (distance > 0 && guard++ < 4) {
      if (actor.x === actor.tx && actor.y === actor.ty) {
        const direction = chooseDirection(actor);
        if (!direction || !canMove(actor, direction)) return;
        targetActor(actor, direction);
      }

      const remaining = 1 - actor.t;
      const step = Math.min(distance, remaining);
      actor.t += step;
      distance -= step;

      if (actor.t >= .999999) {
        actor.x = normalizeX(actor.tx);
        actor.y = actor.ty;
        actor.tx = actor.x;
        actor.ty = actor.y;
        actor.t = 0;
        onArrival?.(actor);
      }
    }
  }

  function choosePlayerDirection(actor) {
    if (canMove(actor, nextDirection)) return nextDirection;
    if (canMove(actor, actor.dir)) return actor.dir;
    return null;
  }

  function validGhostDirections(ghost) {
    let options = Object.keys(DIRECTIONS).filter(direction => canMove(ghost, direction));
    if (options.length > 1) options = options.filter(direction => direction !== OPPOSITE[ghost.dir]);
    return options;
  }

  function ghostTarget(ghost) {
    const pos = actorPosition(player);
    const playerTile = { x: Math.round(pos.x), y: Math.round(pos.y) };
    const chase = modeClock % 27 > 7;
    if (!chase) return CORNERS[ghost.index];
    if (ghost.index === 0) return playerTile;
    if (ghost.index === 1) {
      const d = DIRECTIONS[player.dir];
      return { x: playerTile.x + d.x * 4, y: playerTile.y + d.y * 4 };
    }
    if (ghost.index === 2) {
      const d = DIRECTIONS[player.dir];
      const lead = { x: playerTile.x + d.x * 2, y: playerTile.y + d.y * 2 };
      const red = actorPosition(ghosts[0]);
      return { x: lead.x * 2 - red.x, y: lead.y * 2 - red.y };
    }
    const here = actorPosition(ghost);
    const distance = Math.abs(here.x - playerTile.x) + Math.abs(here.y - playerTile.y);
    return distance > 7 ? playerTile : CORNERS[ghost.index];
  }

  function chooseGhostDirection(ghost, now) {
    const options = validGhostDirections(ghost);
    if (!options.length) return OPPOSITE[ghost.dir];
    if (now < frightenedUntil) return options[Math.floor(Math.random() * options.length)];
    const target = ghostTarget(ghost);
    return options.sort((a, b) => {
      const da = DIRECTIONS[a];
      const db = DIRECTIONS[b];
      const ax = ghost.x + da.x;
      const ay = ghost.y + da.y;
      const bx = ghost.x + db.x;
      const by = ghost.y + db.y;
      return (ax-target.x) ** 2 + (ay-target.y) ** 2 - ((bx-target.x) ** 2 + (by-target.y) ** 2);
    })[0];
  }

  function eatCell(actor, now) {
    const cell = grid[actor.y][actor.x];
    if (cell !== "." && cell !== "o") return;
    grid[actor.y][actor.x] = " ";
    pelletsLeft--;
    renderMazeLayer();
    addScore(cell === "o" ? 50 : 10);
    chompFlip = !chompFlip;
    if (now - lastChomp > 62) {
      beep(cell === "o" ? 180 : (chompFlip ? 420 : 510), cell === "o" ? .16 : .035, cell === "o" ? .08 : .025);
      lastChomp = now;
    }
    if (cell === "o") {
      frightenedUntil = now + 7000;
      frightenedChain = 0;
      ghosts.forEach(ghost => ghost.dir = OPPOSITE[ghost.dir]);
      flash("GLITCH MODE");
    }
    if (pelletsLeft === 0) winGame();
  }

  function addScore(points) {
    score += points;
    if (score > highScore) {
      highScore = score;
      saveHighScore();
    }
    updateHud();
  }

  function checkCollisions(now) {
    const p = actorPosition(player);
    const touching = [];
    for (const ghost of ghosts) {
      const g = actorPosition(ghost);
      let dx = Math.abs(p.x - g.x);
      dx = Math.min(dx, COLS - dx);
      if (Math.hypot(dx, p.y - g.y) <= .64) touching.push(ghost);
    }
    if (!touching.length) return;
    // Decide after checking ALL ghosts: a lethal ghost must never be masked
    // by a frightened one sharing the same tile in the same frame.
    if (now < frightenedUntil) {
      for (const ghost of touching) {
        frightenedChain++;
        addScore(200 * 2 ** (frightenedChain - 1));
        Object.assign(ghost, makeActor(ghost.spawn, ghost.index % 2 ? "left" : "right", ghost.speed), {index: ghost.index});
        beep(880, .12, .06);
        flash(`${200 * 2 ** (frightenedChain - 1)} POINTS`);
      }
    } else {
      loseLife(now);
    }
  }

  function loseLife(now) {
    if (state !== "playing") return;
    lives--;
    updateHud();
    beep(105, .45, .1, "sawtooth");
    if (lives <= 0) {
      state = "gameover";
      showOverlay("RUN ENDED", `Score ${score.toLocaleString()}. The wall wins this round.`, "PLAY AGAIN", "NO MORE LIVES");
      return;
    }
    state = "dying";
    deathUntil = now + 1100;
    flash("LIFE LOST");
  }

  function winGame() {
    state = "won";
    addScore(1000);
    beep(660, .12, .06);
    setTimeout(() => beep(880, .12, .06), 130);
    setTimeout(() => beep(1100, .28, .07), 270);
    showOverlay("WALL CLEARED", `Final score ${score.toLocaleString()}. Every square is gone.`, "PLAY AGAIN", "NICE WORK, RAY");
  }

  function startGame() {
    unlockAudio();
    resetBoard();
    state = "playing";
    overlay.classList.add("hidden");
    beep(330, .08, .04);
  }

  function togglePause() {
    if (state === "playing") {
      state = "paused";
      showOverlay("PAUSED", "The maze is holding its breath.", "RESUME", "TAKE A BEAT");
    } else if (state === "paused") {
      state = "playing";
      overlay.classList.add("hidden");
      lastTime = performance.now();
    }
  }

  function showOverlay(title, text, button, eyebrow) {
    overlayTitle.textContent = title;
    overlayText.textContent = text;
    overlayButton.textContent = button;
    overlayEyebrow.textContent = eyebrow;
    overlay.classList.remove("hidden");
  }

  function flash(message) {
    toast.textContent = message;
    toast.classList.remove("show");
    void toast.offsetWidth;
    toast.classList.add("show");
  }

  function updateHud() {
    scoreNode.textContent = String(score).padStart(6, "0");
    highScoreNode.textContent = String(highScore).padStart(6, "0");
    livesNode.replaceChildren(...Array.from({length: lives}, () => {
      const img = document.createElement("img");
      img.src = "assets/ray-right-closed.png";
      img.alt = "";
      return img;
    }));
    livesNode.setAttribute("aria-label", `${lives} ${lives === 1 ? "life" : "lives"}`);
  }

  function unlockAudio() {
    const AudioEngine = window.AudioContext || window.webkitAudioContext;
    if (!AudioEngine) return;
    if (!audioContext) audioContext = new AudioEngine();
    if (audioContext.state === "suspended") audioContext.resume();
  }

  function beep(frequency, duration, volume, type = "square") {
    if (!soundOn) return;
    try {
      unlockAudio();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const start = audioContext.currentTime;
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(volume, start);
      gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start(start);
      oscillator.stop(start + duration);
    } catch { /* Audio is optional. */ }
  }

  function roundedRect(target, x, y, w, h, radius) {
    target.beginPath();
    target.roundRect(x, y, w, h, radius);
  }

  function renderMazeLayer() {
    // Prerender the static maze: background, walls, uneaten regular pellets.
    // Called on board reset and each pellet pickup — never per frame.
    const m = mazeCtx;
    m.save();
    m.setTransform(DPR, 0, 0, DPR, 0, 0);
    const background = m.createRadialGradient(WIDTH*.5, HEIGHT*.45, 20, WIDTH*.5, HEIGHT*.45, WIDTH*.7);
    background.addColorStop(0, "#191022");
    background.addColorStop(1, "#0b0710");
    m.fillStyle = background;
    m.fillRect(0, 0, WIDTH, HEIGHT);

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const cell = grid[y]?.[x] ?? "#";
        const px = x * TILE;
        const py = y * TILE;
        if (cell === "#") {
          m.shadowColor = "rgba(255, 76, 112, .32)";
          m.shadowBlur = 7;
          roundedRect(m, px + 2, py + 2, TILE - 4, TILE - 4, 4);
          m.fillStyle = "#29152f";
          m.fill();
          m.shadowBlur = 0;
          m.strokeStyle = "rgba(255, 105, 95, .48)";
          m.lineWidth = 1;
          m.stroke();
          m.fillStyle = "rgba(255, 216, 172, .035)";
          m.fillRect(px + 5, py + 5, TILE - 10, 2);
        } else if (cell === ".") {
          m.shadowColor = "#ff554f";
          m.shadowBlur = 5;
          m.fillStyle = "#ff695f";
          roundedRect(m, px + TILE/2 - 2.5, py + TILE/2 - 2.5, 5, 5, 1);
          m.fill();
          m.shadowBlur = 0;
        }
      }
    }
    m.restore();
  }

  function drawMaze(now) {
    // Per frame: blit the prerendered maze, then draw only the animated power pellets.
    ctx.save();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(mazeLayer, 0, 0, WIDTH, HEIGHT);
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (grid[y]?.[x] !== "o") continue;
        const pulse = 1 + Math.sin(now / 115) * .18;
        const size = 11 * pulse;
        const px = x * TILE;
        const py = y * TILE;
        ctx.shadowColor = "#ff554f";
        ctx.shadowBlur = 13;
        ctx.fillStyle = "#ffb066";
        roundedRect(ctx, px + TILE/2 - size/2, py + TILE/2 - size/2, size, size, 3);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
    ctx.restore();
  }

  function drawPlayer(now) {
    const p = actorPosition(player);
    const size = TILE * 2.05;
    const cx = p.x * TILE + TILE / 2;
    const cy = p.y * TILE + TILE / 2;
    ctx.save();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.shadowColor = "rgba(255, 213, 173, .48)";
    ctx.shadowBlur = 8;
    if (!spriteFailed && spriteAtlas.complete && spriteAtlas.naturalWidth > 0) {
      const open = Math.floor(now / 115) % 2;
      const directionOffset = { right: 0, left: 2, up: 4, down: 6 }[player.dir] ?? 0;
      const index = directionOffset + open;
      const sourceX = (index % 4) * 128;
      const sourceY = Math.floor(index / 4) * 128;
      ctx.drawImage(spriteAtlas, sourceX, sourceY, 128, 128, cx - size/2, cy - size/2, size, size);
    } else {
      // Sprite failed to load — fall back to a simple portrait disc so the player is never invisible.
      ctx.fillStyle = "#ff695f";
      ctx.beginPath();
      ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      const d = DIRECTIONS[player.dir] ?? DIRECTIONS.right;
      const ex = d.x * 4;
      const ey = d.y * 4;
      ctx.fillStyle = "#120c1d";
      ctx.beginPath();
      ctx.arc(cx - 8 + ex, cy - 4 + ey, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx + 8 + ex, cy - 4 + ey, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#120c1d";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx + d.x * 6, cy + 4 + d.y * 6, 7, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawGhost(ghost, now) {
    const pos = actorPosition(ghost);
    const frightened = now < frightenedUntil;
    const blink = frightened && frightenedUntil - now < 1800 && Math.floor(now / 180) % 2;
    const color = frightened ? (blink ? "#f5e6c8" : "#4268ff") : GHOST_COLORS[ghost.index];
    const unit = 3;
    const pattern = [
      "...######...",
      ".##########.",
      "############",
      "############",
      "############",
      "############",
      "############",
      "############",
      "############",
      "############",
      "##..##..##..",
      "#....##....#"
    ];
    const ox = pos.x*TILE + TILE/2 - 18;
    const oy = pos.y*TILE + TILE/2 - 18;
    ctx.save();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.shadowColor = color;
    ctx.shadowBlur = frightened ? 6 : 9;
    ctx.fillStyle = color;
    pattern.forEach((row, y) => [...row].forEach((pixel, x) => {
      if (pixel === "#") ctx.fillRect(Math.round(ox + x*unit), Math.round(oy + y*unit), unit, unit);
    }));
    ctx.shadowBlur = 0;
    if (frightened) {
      ctx.fillStyle = blink ? "#4268ff" : "#fff";
      ctx.fillRect(ox + 8, oy + 14, 5, 5);
      ctx.fillRect(ox + 23, oy + 14, 5, 5);
      ctx.fillRect(ox + 11, oy + 25, 14, 3);
    } else {
      const d = DIRECTIONS[ghost.dir];
      [[9,14],[23,14]].forEach(([x,y]) => {
        ctx.fillStyle = "#fff8e8";
        ctx.fillRect(ox+x-2, oy+y-4, 8, 10);
        ctx.fillStyle = "#22122c";
        ctx.fillRect(ox+x + d.x*2, oy+y + d.y*2, 4, 4);
      });
    }
    ctx.restore();
  }

  function render(now) {
    drawMaze(now);
    drawPlayer(now);
    ghosts.forEach(ghost => drawGhost(ghost, now));
    if (state === "dying") {
      ctx.save();
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.fillStyle = `rgba(255,105,95,${.14 + Math.sin(now/55)*.1})`;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      ctx.restore();
    }
  }

  function update(dt, now) {
    if (state === "dying") {
      if (now >= deathUntil) {
        resetActors();
        frightenedUntil = 0;
        state = "playing";
      }
      return;
    }
    if (state !== "playing") return;
    modeClock += dt;
    advance(player, dt, choosePlayerDirection, actor => eatCell(actor, now));
    ghosts.forEach(ghost => {
      ghost.speed = now < frightenedUntil ? 4.15 : 5.25 + ghost.index * .08;
      advance(ghost, dt, actor => chooseGhostDirection(actor, now));
    });
    checkCollisions(now);
  }

  function loop(now) {
    const dt = Math.min((now - lastTime) / 1000, .05);
    lastTime = now;
    update(dt, now);
    render(now);
    requestAnimationFrame(loop);
  }

  function setDirection(direction) {
    if (!DIRECTIONS[direction]) return;
    if (state === "ready") startGame();
    nextDirection = direction;
  }

  const keyDirection = {
    ArrowLeft: "left", a: "left", A: "left",
    ArrowRight: "right", d: "right", D: "right",
    ArrowUp: "up", w: "up", W: "up",
    ArrowDown: "down", s: "down", S: "down"
  };

  window.addEventListener("keydown", event => {
    if (keyDirection[event.key]) {
      event.preventDefault();
      setDirection(keyDirection[event.key]);
      return;
    }
    if (event.key === "p" || event.key === "P" || event.key === "Escape") {
      event.preventDefault();
      togglePause();
    }
    if (event.key === "Enter" && !overlay.classList.contains("hidden")) overlayButton.click();
  });

  document.querySelectorAll("[data-direction]").forEach(button => {
    button.addEventListener("pointerdown", event => {
      event.preventDefault();
      setDirection(button.dataset.direction);
    });
  });

  canvas.addEventListener("pointerdown", event => {
    touchStart = {x: event.clientX, y: event.clientY};
    canvas.setPointerCapture?.(event.pointerId);
  });

  canvas.addEventListener("pointerup", event => {
    if (!touchStart) return;
    const dx = event.clientX - touchStart.x;
    const dy = event.clientY - touchStart.y;
    touchStart = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return;
    setDirection(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up"));
  });

  overlayButton.addEventListener("click", () => {
    if (state === "paused") togglePause();
    else startGame();
  });

  soundButton.addEventListener("click", () => {
    soundOn = !soundOn;
    soundButton.textContent = soundOn ? "SOUND ON" : "SOUND OFF";
    soundButton.setAttribute("aria-pressed", String(soundOn));
    soundButton.setAttribute("aria-label", soundOn ? "Mute sound" : "Unmute sound");
    if (soundOn) beep(520, .06, .035);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state === "playing") togglePause();
  });

  resetBoard();
  render(performance.now());
  requestAnimationFrame(loop);
})();
