console.log("Game loaded");

const socket = io();
const roomId = prompt("Enter room code for this game:");

// Join room as host (to listen)
socket.emit("joinRoom", { roomId, role: "host" });

// ─── Map config ───────────────────────────────────────────────────────────────
// Set these to your map image's natural pixel dimensions.
// The canvas will match exactly — no stretching.
const MAP_WIDTH  = 1280; // ← set to your map.png width in pixels
const MAP_HEIGHT = 720;  // ← set to your map.png height in pixels

// ─── Sprite scale ─────────────────────────────────────────────────────────────
// 1.0 = natural sprite size. Lower = smaller on screen.
// Adjust this whenever you swap maps or want to tune character size.
const SPRITE_SCALE = 0.75;

// ─── Sprite sheet config ──────────────────────────────────────────────────────
// Adjust these if the sheet ever changes — they drive all frame math below.
const FRAME_WIDTH       = 64;  // px width of a single frame
const FRAME_HEIGHT      = 64;  // px height of a single frame
const FRAMES_PER_ROW    = 17;  // number of columns in the sheet
const WALK_ROWS_PER_DIR = 2;   // each direction spans this many consecutive rows
const WALK_FRAME_RATE   = 12;  // walk animation playback speed (fps)

// NPC movement speed in pixels per second (delta-time based, so framerate-independent)
const NPC_SPEED = 80; // ← tweak this to change how fast NPCs move

// Derived — no need to touch these
const WALK_FRAMES_PER_DIR = FRAMES_PER_ROW * WALK_ROWS_PER_DIR; // 34 total walk frames per direction
const WALK_ROW_COUNT      = 8 * WALK_ROWS_PER_DIR;               // 16 walk rows total
const IDLE_ROW_START      = WALK_ROW_COUNT * FRAMES_PER_ROW;     // flat index where idle row begins (272)

// ─── Direction orders ─────────────────────────────────────────────────────────
// Walk rows top → bottom
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

// Idle row left → right
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

// atan2 angle buckets → direction name (clockwise from 0° = right)
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
  type:   Phaser.AUTO,
  width:  MAP_WIDTH,
  height: MAP_HEIGHT,
  backgroundColor: "#000000",
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
let lastPlayerDir = "down";

// ─── Phaser lifecycle ─────────────────────────────────────────────────────────

function preload() {
  this.load.image("map", "assets/fruitmap1.png");

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
  // ── Background map (static, behind everything) ──
  // Anchored at top-left (0, 0), drawn at natural pixel size
  this.add.image(0, 0, "map").setOrigin(0, 0).setDepth(-1);

  // Register animations for all character types
  createCharacterAnimations(this, "thief");
  createCharacterAnimations(this, "npc");

  // ── Thief (server-controlled) ──
  player = this.add.sprite(MAP_WIDTH / 2, MAP_HEIGHT / 2, "thief");
  player.setScale(SPRITE_SCALE);
  playIdleAnim(player, "thief", lastPlayerDir);

  // ── NPC crowd ──
  for (let i = 0; i < 20; i++) {
    const npc = this.add.sprite(
      Phaser.Math.Between(100, MAP_WIDTH  - 100),
      Phaser.Math.Between(100, MAP_HEIGHT - 100),
      "npc"
    );
    npc.setScale(SPRITE_SCALE);

    // Store velocity as a unit vector × speed (px/s).
    // Using a random angle avoids the axis-aligned bias of random int components.
    const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
    npc.vx      = Math.cos(angle) * NPC_SPEED;
    npc.vy      = Math.sin(angle) * NPC_SPEED;
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

function update(time, delta) {
  // delta is milliseconds since last frame — divide by 1000 for seconds
  const dt = delta / 1000;

  // Half the scaled sprite size used as the boundary margin so NPCs
  // bounce off the edge before their center leaves the map.
  const margin = (FRAME_WIDTH * SPRITE_SCALE) / 2;

  npcs.forEach(npc => {
    // Move using delta time so speed is framerate-independent
    npc.x += npc.vx * dt;
    npc.y += npc.vy * dt;

    // Bounce off map edges — reverse the relevant velocity component
    // and nudge back inside so they don't clip through the wall
    if (npc.x < margin) {
      npc.x  = margin;
      npc.vx = Math.abs(npc.vx);
    } else if (npc.x > MAP_WIDTH - margin) {
      npc.x  = MAP_WIDTH - margin;
      npc.vx = -Math.abs(npc.vx);
    }

    if (npc.y < margin) {
      npc.y  = margin;
      npc.vy = Math.abs(npc.vy);
    } else if (npc.y > MAP_HEIGHT - margin) {
      npc.y  = MAP_HEIGHT - margin;
      npc.vy = -Math.abs(npc.vy);
    }

    // Randomly nudge direction (small angle offset keeps motion feeling organic)
    if (Math.random() < 0.003) {
      const currentAngle = Math.atan2(npc.vy, npc.vx);
      const nudge        = Phaser.Math.FloatBetween(-Math.PI / 2, Math.PI / 2);
      const newAngle     = currentAngle + nudge;
      npc.vx = Math.cos(newAngle) * NPC_SPEED;
      npc.vy = Math.sin(newAngle) * NPC_SPEED;
    }

    // Animate
    const isMoving = Math.abs(npc.vx) > 1 || Math.abs(npc.vy) > 1;
    if (isMoving) {
      const dir = getDirectionFromVector(npc.vx, npc.vy);
      npc.lastDir = dir;
      playWalkAnim(npc, "npc", dir);
    } else {
      playIdleAnim(npc, "npc", npc.lastDir);
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
 * @param {Phaser.Scene} scene
 * @param {string} textureKey - must match a spritesheet loaded in preload()
 */
function createCharacterAnimations(scene, textureKey) {
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
 */
function getDirectionFromVector(vx, vy) {
  const angleDeg = Phaser.Math.RadToDeg(Math.atan2(vy, vx));
  let index = Math.round(angleDeg / 45);
  if (index < 0) index += 8;
  return ANGLE_TO_DIR[index % 8];
}

/**
 * Plays the walk animation, guarding against mid-cycle restarts.
 */
function playWalkAnim(sprite, textureKey, dir) {
  const key = `${textureKey}_walk_${dir}`;
  if (sprite.anims.currentAnim?.key !== key) {
    sprite.anims.play(key, true);
  }
}

/**
 * Plays the idle (static) animation, guarding against unnecessary replays.
 */
function playIdleAnim(sprite, textureKey, dir) {
  const key = `${textureKey}_idle_${dir}`;
  if (sprite.anims.currentAnim?.key !== key) {
    sprite.anims.play(key);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Y-based depth sort — sprites lower on screen draw on top of those above them.
 * Map image is fixed at depth -1 so it always stays behind everything.
 */
function depthSort() {
  [player, ...npcs].forEach(sprite => {
    sprite.depth = sprite.y;
  });
}