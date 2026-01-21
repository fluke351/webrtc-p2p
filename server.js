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
            rooms[roomId] = {
                password: password || null,
                host: socket.id // First user is host
            };
        } else {
            // Check password
            if (rooms[roomId].password && rooms[roomId].password !== password) {
                socket.emit('error-message', 'Incorrect password');
                return; // Stop execution
            }
        }

        console.log(`User ${userId} (${nickname}) joined room ${roomId}`);
        socket.join(roomId);

        // Notify user if they are host
        if (rooms[roomId].host === socket.id) {
            socket.emit('you-are-host');
        } else {
            // Notify existing host about new user? (Optional)
        }

        socket.to(roomId).emit('user-connected', userId, nickname);

        // Update Viewer Count
        const clients = io.sockets.adapter.rooms.get(roomId);
        const count = clients ? clients.size : 0;
        io.to(roomId).emit('update-viewer-count', count);

        // Store nickname on socket for reference
        socket.data.nickname = nickname;
        socket.data.roomId = roomId; // Store roomId for disconnect handling

        socket.on('disconnect', () => {
            console.log(`User ${userId} disconnected`);
            socket.to(roomId).emit('user-disconnected', userId, nickname);

            // Clean up room if empty (optional, but good practice)
            const room = io.sockets.adapter.rooms.get(roomId);
            if (!room || room.size === 0) {
                delete rooms[roomId];
            } else {
                // If host disconnected, assign new host
                if (rooms[roomId] && rooms[roomId].host === socket.id) {
                    // Get first remaining socket id
                    const newHostId = room.values().next().value;
                    rooms[roomId].host = newHostId;
                    io.to(newHostId).emit('you-are-host');
                    // Optional: notify everyone about new host
                }

                // Update Viewer Count for remaining users
                io.to(roomId).emit('update-viewer-count', room.size);
            }
        });

        // Host Actions
        socket.on('kick-user', (targetUserId) => {
            // Verify requester is host
            if (rooms[roomId] && rooms[roomId].host === socket.id) {
                io.to(targetUserId).emit('kicked');
                // Force disconnect socket
                const targetSocket = io.sockets.sockets.get(targetUserId);
                if (targetSocket) {
                    targetSocket.leave(roomId);
                    targetSocket.disconnect(true);
                }
            }
        });

        // Relay signaling messages
        socket.on('offer', (payload) => {
            io.to(payload.target).emit('offer', payload);
        });

        socket.on('answer', (payload) => {
            io.to(payload.target).emit('answer', payload);
        });

        socket.on('candidate', (payload) => {
            io.to(payload.target).emit('candidate', payload);
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

        // Sound Effect Feature
        socket.on('play-sound', (soundId) => {
            socket.to(roomId).emit('play-sound', soundId);
        });
        // Game Feature (Tic-Tac-Toe)
        socket.on('game-move', (payload) => {
            // payload: { index, symbol, roomId }
            socket.to(payload.roomId).emit('game-move', payload);
        });

        socket.on('game-restart', (roomId) => {
            socket.to(roomId).emit('game-restart');
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});
