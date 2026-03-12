//Variables
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

// Store rooms: each room has a thief and players
let rooms = {};

//On user connection
io.on("connection", (socket) => {
	console.log("user connected:", socket.id);

	// Join a room
	socket.on("joinRoom", ({ roomId, role }) => {
		socket.join(roomId);

		// Create room if it doesn't exist
		if (!rooms[roomId]) {
		rooms[roomId] = {
			thief: { x: 400, y: 300 },
			players: []
		};
		}

		// Assign role
		if (role === "thief") {
		rooms[roomId].thiefSocket = socket.id;
		console.log(`Thief joined room ${roomId}`);
		} else {
		rooms[roomId].players.push(socket.id);
		console.log(`Player joined room ${roomId}`);
		}

		//Sends role to requester
		socket.emit("assignRole", role);

		// Send initial thief position
		socket.emit("updateThief", rooms[roomId].thief);
	});

  // Move thief
	socket.on("move", ({ roomId, x, y }) => {
		const room = rooms[roomId];
		if (!room) return;

		//Check to make sure the sender is the thief
		if (socket.id !== room.thiefSocket) return;

		room.thief.x += x;
		room.thief.y += y;

		// Broadcast to everyone in the room
		io.to(roomId).emit("updateThief", room.thief);
	});

  // Handle disconnect
	socket.on("disconnect", () => {
		for (const roomId in rooms) {

		const room = rooms[roomId];

		//If the disconnect is from thief, remove the thief
		if (room.thiefSocket === socket.id) {
			room.thiefSocket = null;
		}

		//Replaces players with new list by filtering out the id of the one that disconnected
		room.players = room.players.filter(id => id !== socket.id);
		}
	});

});

server.listen(3000, () => {
	console.log("Server running on port 3000");
});