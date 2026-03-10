console.log("Game loaded");

const socket = io();
const roomId = prompt("Enter room code for this game:");

//join room as host (to listen)
socket.emit("joinRoom", { roomId, role: "host" });

const config = {
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  physics: { default: "arcade" },
  scene: {
    preload: preload,
    create: create,
    update: update
  }
};

const game = new Phaser.Game(config);

let player;
let npcs = [];

function preload(){

  this.load.image("npc","assets/npc.png");
  this.load.image("player","assets/player.png");

}

function create(){

  player = this.add.sprite(400,300,"player");

  // create npc crowd
  for(let i=0;i<20;i++){

    let npc = this.add.sprite(
      Phaser.Math.Between(100,700),
      Phaser.Math.Between(100,500),
      "npc"
    );

    npc.speedX = Phaser.Math.Between(-1,1);
    npc.speedY = Phaser.Math.Between(-1,1);

    npcs.push(npc);
  }

  socket.on("updateThief",(data)=>{
    player.x = data.x;
    player.y = data.y;
  });

}

function update(){

  npcs.forEach(npc=>{

    npc.x += npc.speedX;
    npc.y += npc.speedY;

    if(Math.random() < 0.01){
      npc.speedX = Phaser.Math.Between(-1,1);
      npc.speedY = Phaser.Math.Between(-1,1);
    }

  });

  depthSort();

}

function depthSort(){

  const sprites = [player,...npcs];

  sprites.forEach(sprite=>{
    sprite.depth = sprite.y;
  });

}