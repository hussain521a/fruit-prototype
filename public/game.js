console.log("Game loaded");

const socket = io();
const roomId = prompt("Enter room code for this game:");

// Join room as host (to listen)
socket.emit("joinRoom", { roomId, role: "host" });

// ─── Sprite sheet config ──────────────────────────────────────────────────────
// Adjust these if the sheet ever changes — they drive all frame math below.

const FRAME_WIDTH       = 64;  // px width of a single frame
const FRAME_HEIGHT      = 64;  // px height of a single frame
const FRAMES_PER_ROW    = 17;  // number of columns in the sheet
const WALK_ROWS_PER_DIR = 2;   // each direction spans this many consecutive rows
const WALK_FRAME_RATE   = 12;  // walk animation playback speed (fps)

// Derived — no need to touch these
const WALK_FRAMES_PER_DIR = FRAMES_PER_ROW * WALK_ROWS_PER_DIR; // 34 total walk frames per direction
const WALK_ROW_COUNT      = 8 * WALK_ROWS_PER_DIR;               // 16 walk rows total
const IDLE_ROW_START      = WALK_ROW_COUNT * FRAMES_PER_ROW;     // flat index where idle row begins (16 * 17 = 272)

// ─── Direction order for WALK rows (top → bottom, one entry per direction pair)
// Row pairs: up=0-1, upleft=2-3, upright=4-5, downright=6-7,
//            right=8-9, left=10-11, downleft=12-13, down=14-15
const WALK_DIRECTION_ORDER = [
  "up",
  "upleft",
  "upright",
  "downright",
  "right",
  "left",
  "downleft",
  "down"
];

// ─── Direction order for IDLE row (left → right, one frame per direction)
// Idle row columns: right, left, up, upleft, upright, downright, downleft, down
const IDLE_DIRECTION_ORDER = [
  "right",
  "left",
  "up",
  "upleft",
  "upright",
  "downright",
  "downleft",
  "down"
];

// ─── atan2 angle buckets → direction name (clockwise from 0° = right) ─────────
// Used by getDirectionFromVector()
const ANGLE_TO_DIR = [
  "right",
  "downright",
  "down",
  "downleft",
  "left",
  "upleft",
  "up",
  "upright"
];
// ─────────────────────────────────────────────────────────────────────────────

const config = {
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  physics: { default: "arcade" },
  scene: {
    preload,
    create,
    update
  }
};

const game = new Phaser.Game(config);

let player;
let npcs = [];
let lastPlayerDir = "down"; // remembers last facing direction for idle pose

// ─── Phaser lifecycle ─────────────────────────────────────────────────────────

function preload() {
  this.load.spritesheet("thief", "assets/player.png", {
    frameWidth:  FRAME_WIDTH,
    frameHeight: FRAME_HEIGHT
  });

  this.load.spritesheet("npc", "assets/npc.png", {
    frameWidth:  FRAME_WIDTH,
    frameHeight: FRAME_HEIGHT
  });
}

function create() {
  // Register all walk + idle animations for each character type.
  // Any texture key that shares this sheet layout works automatically.
  createCharacterAnimations(this, "thief");
  createCharacterAnimations(this, "npc");

  // ── Thief (server-controlled) ──
  player = this.add.sprite(400, 300, "thief");
  playIdleAnim(player, "thief", lastPlayerDir);

  // ── NPC crowd ──
  for (let i = 0; i < 20; i++) {
    const npc = this.add.sprite(
      Phaser.Math.Between(100, 700),
      Phaser.Math.Between(100, 500),
      "npc"
    );
    npc.speedX  = Phaser.Math.FloatBetween(-2, 2);
    npc.speedY  = Phaser.Math.FloatBetween(-2, 2);
    npc.lastDir = "down";
    playWalkAnim(npc, "npc", npc.lastDir);
    npcs.push(npc);
  }

  // ── Server updates → thief position + animation ──
  socket.on("updateThief", (data) => {
    const dx = data.x - player.x;
    const dy = data.y - player.y;

    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      const dir = getDirectionFromVector(dx, dy);
      lastPlayerDir = dir;
      playWalkAnim(player, "thief", dir);
    } else {
      playIdleAnim(player, "thief", lastPlayerDir);
    }

    player.x = data.x;
    player.y = data.y;
  });
}

function update() {
  npcs.forEach(npc => {
    npc.x += npc.speedX;
    npc.y += npc.speedY;

    npc.x = Phaser.Math.Clamp(npc.x, 0, 800);
    npc.y = Phaser.Math.Clamp(npc.y, 0, 600);

    const isMoving = Math.abs(npc.speedX) > 0.1 || Math.abs(npc.speedY) > 0.1;
    if (isMoving) {
      const dir = getDirectionFromVector(npc.speedX, npc.speedY);
      npc.lastDir = dir;
      playWalkAnim(npc, "npc", dir);
    } else {
      playIdleAnim(npc, "npc", npc.lastDir);
    }

    if (Math.random() < 0.003) {
      npc.speedX = Phaser.Math.FloatBetween(-2, 2);
      npc.speedY = Phaser.Math.FloatBetween(-2, 2);
    }
  });

  depthSort();
}

// ─── Animation helpers ────────────────────────────────────────────────────────

/**
 * Registers all walk and idle animations for a given texture key.
 *
 * Walk:  8 directions × 34 frames (spanning 2 consecutive rows each).
 * Idle:  8 directions × 1 static frame (from the dedicated idle row).
 *
 * Animation keys follow the pattern:  `${textureKey}_walk_${dir}`
 *                                     `${textureKey}_idle_${dir}`
 *
 * @param {Phaser.Scene} scene
 * @param {string} textureKey - must match a spritesheet loaded in preload()
 */
function createCharacterAnimations(scene, textureKey) {

  // ── Walk animations ──
  // Each direction occupies WALK_FRAMES_PER_DIR (34) consecutive flat frames,
  // naturally spanning 2 rows of 17 because Phaser reads sheets left→right, top→bottom.
  WALK_DIRECTION_ORDER.forEach((dir, dirIndex) => {
    const start = dirIndex * WALK_FRAMES_PER_DIR;
    const end   = start + WALK_FRAMES_PER_DIR - 1;

    scene.anims.create({
      key:       `${textureKey}_walk_${dir}`,
      frames:    scene.anims.generateFrameNumbers(textureKey, { start, end }),
      frameRate: WALK_FRAME_RATE,
      repeat:    -1
    });
  });

  // ── Idle animations ──
  // Each is a single static frame from the dedicated idle row (row 16).
  // IDLE_ROW_START = 272 (16 rows × 17 frames), then offset by column index.
  IDLE_DIRECTION_ORDER.forEach((dir, idleIndex) => {
    const frame = IDLE_ROW_START + idleIndex;

    scene.anims.create({
      key:    `${textureKey}_idle_${dir}`,
      frames: scene.anims.generateFrameNumbers(textureKey, {
        start: frame,
        end:   frame
      }),
      frameRate: 1,
      repeat:    0
    });
  });
}

/**
 * Converts a movement vector (vx, vy) to the nearest of the 8 direction names.
 *
 * @param {number} vx
 * @param {number} vy
 * @returns {string}  e.g. "upright", "downleft", "left"
 */
function getDirectionFromVector(vx, vy) {
  const angleDeg = Phaser.Math.RadToDeg(Math.atan2(vy, vx)); // -180 → 180
  let index = Math.round(angleDeg / 45);
  if (index < 0) index += 8;
  return ANGLE_TO_DIR[index % 8];
}

/**
 * Plays the walk animation for a sprite.
 * Guards against restarting the same animation mid-cycle.
 *
 * @param {Phaser.GameObjects.Sprite} sprite
 * @param {string} textureKey
 * @param {string} dir
 */
function playWalkAnim(sprite, textureKey, dir) {
  const key = `${textureKey}_walk_${dir}`;
  if (sprite.anims.currentAnim?.key !== key) {
    sprite.anims.play(key, true);
  }
}

/**
 * Plays the idle (static) animation for a sprite.
 * Guards against flickering by skipping if already on the correct idle frame.
 *
 * @param {Phaser.GameObjects.Sprite} sprite
 * @param {string} textureKey
 * @param {string} dir
 */
function playIdleAnim(sprite, textureKey, dir) {
  const key = `${textureKey}_idle_${dir}`;
  if (sprite.anims.currentAnim?.key !== key) {
    sprite.anims.play(key);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Y-based depth sort — sprites lower on screen draw on top of those above them,
 * creating the 2.5D overlap illusion.
 */
function depthSort() {
  [player, ...npcs].forEach(sprite => {
    sprite.depth = sprite.y;
  });
}