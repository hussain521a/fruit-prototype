const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

// Store rooms: each room has a thief and players
let rooms = {};

io.on("connection", (socket) => {
  console.log("user connected");

  // Join a room
  socket.on("joinRoom", ({ roomId, role }) => {
    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = {
        thief: { x: 400, y: 300 },
        players: []
      };
    }

    if (role === "thief") {
      rooms[roomId].thiefSocket = socket.id;
      console.log(`Thief joined room ${roomId}`);
    } else {
      rooms[roomId].players.push(socket.id);
      console.log(`Player joined room ${roomId}`);
    }

    // Send initial thief position
    socket.emit("updateThief", rooms[roomId].thief);
  });

  // Move thief
  socket.on("move", ({ roomId, x, y }) => {
    const room = rooms[roomId];
    if (!room) return;

    room.thief.x += x;
    room.thief.y += y;

    // Broadcast to everyone in the room
    io.to(roomId).emit("updateThief", room.thief);
  });

  // Handle disconnect
  socket.on("disconnect", () => {
    console.log("user disconnected");
    // Optional: remove from rooms
  });
});

server.listen(3000, () => {
  console.log("Server running on port 3000");
});