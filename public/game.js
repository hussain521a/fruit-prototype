console.log("Game loaded");

const socket = io();
const roomId = prompt("Enter room code for this game:");

// Join room as host (to listen)
socket.emit("joinRoom", { roomId, role: "host" });

// ─── Map config ───────────────────────────────────────────────────────────────
const MAP_WIDTH  = 1280; // ← set to your map.png width in pixels
const MAP_HEIGHT = 720;  // ← set to your map.png height in pixels

// ─── Sprite scale ─────────────────────────────────────────────────────────────
// 1.0 = natural sprite size. Adjust per map as needed.
const SPRITE_SCALE = 1.0;

// ─── Thief movement smoothing ─────────────────────────────────────────────────
// How quickly the thief visually catches up to the server position each frame.
// 1.0 = instant snap (old behavior). 0.1 = very smooth but laggy.
// 0.3 is a good starting point — raise it if it feels too delayed.
const THIEF_LERP = 0.3;

// ─── NPC config ───────────────────────────────────────────────────────────────
const NPC_COUNT         = 40;
const NPC_SPEED         = 80;  // movement speed in px/s while walking
const NPC_IDLE_CHANCE   = 0.002; // probability per frame of stopping (lower = rarer stops)
const NPC_IDLE_MIN_MS   = 1000;  // minimum time an NPC stays idle (ms)
const NPC_IDLE_MAX_MS   = 4000;  // maximum time an NPC stays idle (ms)
const NPC_TURN_CHANCE   = 0.003; // probability per frame of changing direction while walking

// ─── Sprite sheet config ──────────────────────────────────────────────────────
const FRAME_WIDTH       = 64;
const FRAME_HEIGHT      = 64;
const FRAMES_PER_ROW    = 17;
const WALK_ROWS_PER_DIR = 2;
const WALK_FRAME_RATE   = 12;

// Derived
const WALK_FRAMES_PER_DIR = FRAMES_PER_ROW * WALK_ROWS_PER_DIR; // 34
const WALK_ROW_COUNT      = 8 * WALK_ROWS_PER_DIR;               // 16
const IDLE_ROW_START      = WALK_ROW_COUNT * FRAMES_PER_ROW;     // 272

// ─── Direction orders ─────────────────────────────────────────────────────────
const WALK_DIRECTION_ORDER = [
  "up", "upleft", "upright", "downright", "right", "left", "downleft", "down"
];

const IDLE_DIRECTION_ORDER = [
  "right", "left", "up", "upleft", "upright", "downright", "downleft", "down"
];

const ANGLE_TO_DIR = [
  "right", "downright", "down", "downleft", "left", "upleft", "up", "upright"
];
// ─────────────────────────────────────────────────────────────────────────────

const config = {
  type:   Phaser.AUTO,
  width:  MAP_WIDTH,
  height: MAP_HEIGHT,
  backgroundColor: "#000000",
  physics: { default: "arcade" },
  scene: { preload, create, update }
};

const game = new Phaser.Game(config);

let player;
let npcs = [];
let lastPlayerDir = "down";

// Server position is stored separately — the sprite lerps toward this
let thiefTarget = { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 };

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
  this.add.image(0, 0, "map").setOrigin(0, 0).setDepth(-1);

  createCharacterAnimations(this, "thief");
  createCharacterAnimations(this, "npc");

  // ── Thief ──
  player = this.add.sprite(MAP_WIDTH / 2, MAP_HEIGHT / 2, "thief");
  player.setScale(SPRITE_SCALE);
  playIdleAnim(player, "thief", lastPlayerDir);

  // ── NPCs Spawning ──
  for (let i = 0; i < NPC_COUNT; i++) {
    const npc = this.add.sprite(
      Phaser.Math.Between(100, MAP_WIDTH  - 100),
      Phaser.Math.Between(100, MAP_HEIGHT - 100),
      "npc"
    );
    npc.setScale(SPRITE_SCALE);

    const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
    npc.vx       = Math.cos(angle) * NPC_SPEED;
    npc.vy       = Math.sin(angle) * NPC_SPEED;
    npc.lastDir  = "down";
    npc.isIdle   = false; // whether NPC is currently stopped
    npc.idleUntil = 0;    // timestamp (ms) when the idle period ends

    playWalkAnim(npc, "npc", npc.lastDir);
    npcs.push(npc);
  }

  // ── Server → thief target (just store, don't snap) ──
  socket.on("updateThief", (data) => {
    thiefTarget.x = data.x;
    thiefTarget.y = data.y;
  });
}

function update(time, delta) {
  const dt = delta / 1000;

  // ── Thief: lerp toward server target ──
  // Compute delta before moving so we can derive direction from it
  const dx = thiefTarget.x - player.x;
  const dy = thiefTarget.y - player.y;

  const isMoving = Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5;

  if (isMoving) {
    const dir = getDirectionFromVector(dx, dy);
    lastPlayerDir = dir;
    playWalkAnim(player, "thief", dir);
  } else {
    playIdleAnim(player, "thief", lastPlayerDir);
  }

  // Lerp: move a fraction of the remaining distance each frame
  player.x += dx * THIEF_LERP;
  player.y += dy * THIEF_LERP;

  // ── NPCs ──
  const margin = (FRAME_WIDTH * SPRITE_SCALE) / 2;

  npcs.forEach(npc => {
    if (npc.isIdle) {
      // Check if the idle period has expired
      if (time >= npc.idleUntil) {
        // Resume walking in a new random direction
        npc.isIdle = false;
        const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
        npc.vx = Math.cos(angle) * NPC_SPEED;
        npc.vy = Math.sin(angle) * NPC_SPEED;
      } else {
        // Stay idle this frame
        playIdleAnim(npc, "npc", npc.lastDir);
        return;
      }
    }

    // ── Walking ──
    npc.x += npc.vx * dt;
    npc.y += npc.vy * dt;

    // Bounce off edges
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

    // Randomly stop and idle
    if (Math.random() < NPC_IDLE_CHANCE) {
      npc.isIdle   = true;
      npc.idleUntil = time + Phaser.Math.Between(NPC_IDLE_MIN_MS, NPC_IDLE_MAX_MS);
      playIdleAnim(npc, "npc", npc.lastDir);
      return;
    }

    // Randomly nudge direction while walking
    if (Math.random() < NPC_TURN_CHANCE) {
      const currentAngle = Math.atan2(npc.vy, npc.vx);
      const nudge        = Phaser.Math.FloatBetween(-Math.PI / 2, Math.PI / 2);
      const newAngle     = currentAngle + nudge;
      npc.vx = Math.cos(newAngle) * NPC_SPEED;
      npc.vy = Math.sin(newAngle) * NPC_SPEED;
    }

    const dir = getDirectionFromVector(npc.vx, npc.vy);
    npc.lastDir = dir;
    playWalkAnim(npc, "npc", dir);
  });

  depthSort();
}

// ─── Animation helpers ────────────────────────────────────────────────────────

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
      frames: scene.anims.generateFrameNumbers(textureKey, { start: frame, end: frame }),
      frameRate: 1,
      repeat:    0
    });
  });
}

function getDirectionFromVector(vx, vy) {
  const angleDeg = Phaser.Math.RadToDeg(Math.atan2(vy, vx));
  let index = Math.round(angleDeg / 45);
  if (index < 0) index += 8;
  return ANGLE_TO_DIR[index % 8];
}

function playWalkAnim(sprite, textureKey, dir) {
  const key = `${textureKey}_walk_${dir}`;
  if (sprite.anims.currentAnim?.key !== key) {
    sprite.anims.play(key, true);
  }
}

function playIdleAnim(sprite, textureKey, dir) {
  const key = `${textureKey}_idle_${dir}`;
  if (sprite.anims.currentAnim?.key !== key) {
    sprite.anims.play(key);
  }
}


function depthSort() {
  [player, ...npcs].forEach(sprite => {
    sprite.depth = sprite.y;
  });
}