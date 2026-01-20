const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

// Store room information (e.g., passwords)
const rooms = {};

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('join-room', (roomId, userId, nickname, password) => {
        // Room Password Logic
        if (!rooms[roomId]) {
            // Create room (store password if provided)
            rooms[roomId] = { password: password || null };
        } else {
            // Check password
            if (rooms[roomId].password && rooms[roomId].password !== password) {
                socket.emit('error-message', 'Incorrect password');
                return; // Stop execution
            }
        }

        console.log(`User ${userId} (${nickname}) joined room ${roomId}`);
        socket.join(roomId);
        socket.to(roomId).emit('user-connected', userId, nickname);

        // Store nickname on socket for reference
        socket.data.nickname = nickname;

        socket.on('disconnect', () => {
            console.log(`User ${userId} disconnected`);
            socket.to(roomId).emit('user-disconnected', userId, nickname);

            // Clean up room if empty (optional, but good practice)
            const room = io.sockets.adapter.rooms.get(roomId);
            if (!room || room.size === 0) {
                delete rooms[roomId];
            }
        });

        // Relay signaling messages
        socket.on('offer', (payload) => {
            socket.to(roomId).emit('offer', payload);
        });

        socket.on('answer', (payload) => {
            socket.to(roomId).emit('answer', payload);
        });

        socket.on('candidate', (payload) => {
            socket.to(roomId).emit('candidate', payload);
        });

        socket.on('media-state-change', (payload) => {
            socket.to(roomId).emit('media-state-change', payload);
        });

        // Chat Feature
        socket.on('chat-message', (message) => {
            socket.to(roomId).emit('chat-message', message);
        });

        // Reaction Feature
        socket.on('reaction', (emoji) => {
            socket.to(roomId).emit('reaction', emoji);
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});
