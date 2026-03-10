const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

let thief = { x: 400, y: 300 };

io.on("connection", (socket) => {

  console.log("user connected");

  socket.on("move", (data) => {
    thief.x += data.x;
    thief.y += data.y;

    io.emit("updateThief", thief);
  });

});

server.listen(3000, () => {
  console.log("Server running on port 3000");
});