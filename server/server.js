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
	socket.on("joinRoom", ({ roomId , role }) => {
		socket.join(roomId);

		// Create room if it doesn't exist
		if (!rooms[roomId]) {
		rooms[roomId] = {
			thief: { x: 400, y: 300 },
			players: []
		};
		}

		//Assigning roles
		const room = rooms[roomId];
		//HOST
		if (role === "host") {
			console.log(`Host joined room ${roomId}`);
			socket.emit("assignRole", "host");
			socket.emit("updateThief", room.thief);
			return;
	  	}

		// CONTROLLER
  		let assignedRole;
		if (!room.thiefSocket) {
			room.thiefSocket = socket.id;
			assignedRole = "thief";
			console.log(`Thief joined room ${roomId}`);
		} else {
			assignedRole = "player";
			room.players.push(socket.id);
			console.log(`Player joined room ${roomId}`);
		}

		//Sends role to requester
		socket.emit("assignRole", assignedRole);

		// Send initial thief position
		socket.emit("updateThief", room.thief);
	});

  // Move thief
	socket.on("move", ({ roomId, x, y }) => {
		const room = rooms[roomId];
		if (!room) return;

		//Check to make sure the sender is the thief
		if (socket.id !== room.thiefSocket) return;

		// Movement Logic
		const WIDTH = 800;
		const HEIGHT = 600;

		room.thief.x += x;
		room.thief.y += y;

		// Boundaries
		room.thief.x = Math.max(0, Math.min(WIDTH, room.thief.x));
		room.thief.y = Math.max(0, Math.min(HEIGHT, room.thief.y));

		// Broadcast to everyone in the room
		io.to(roomId).emit("updateThief", room.thief);
	});

  // Handle disconnect
	socket.on("disconnect", () => {

		console.log("user disconnected:", socket.id);
		for (const roomId in rooms) {

			const room = rooms[roomId];

			//If the disconnect is from thief, remove the thief
			if (room.thiefSocket === socket.id) {
				room.thiefSocket = null;
				console.log("user disconnected from room ", roomId, "thief left");

			}

			//Replaces players with new list by filtering out the id of the one that disconnected
			room.players = room.players.filter(id => id !== socket.id);
		}
	});

});

server.listen(3000, () => {
	console.log("Server running on port 3000");
});