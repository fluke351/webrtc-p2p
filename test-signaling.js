const { io } = require('socket.io-client');

const SERVER_URL = 'http://localhost:3000';
const ROOM_ID = 'test-room-' + Math.random();

const client1 = io(SERVER_URL);
const client2 = io(SERVER_URL);

let clientsReady = 0;

function checkFinished(source) {
    clientsReady++;
    console.log(`Success part reached from: ${source} (${clientsReady}/2)`);
    if (clientsReady === 2) {
        console.log('--- ALL SIMULATION TESTS PASSED ---');
        process.exit(0);
    }
}

client1.on('connect', () => {
    console.log('Client 1 connected:', client1.id);
    client1.emit('join-room', ROOM_ID, client1.id, 'Alice', 'secret');
});

client1.on('you-are-host', () => {
    console.log('Client 1 confirmed as host');
});

client1.on('user-connected', (userId, nickname) => {
    console.log(`Client 1 saw user connected: ${nickname} (ID: ${userId})`);
    setTimeout(() => {
        console.log('Client 1 sending offer to', userId);
        client1.emit('offer', { target: userId, sdp: 'fake-sdp', callerId: client1.id });
    }, 500);
});

client2.on('connect', () => {
    console.log('Client 2 connected:', client2.id);
    setTimeout(() => {
        client2.emit('join-room', ROOM_ID, client2.id, 'Bob', 'secret');
    }, 500);
});

client2.on('existing-users', (users) => {
    console.log('Client 2 received existing users:', users);
    if (users.length === 1 && users[0].nickname === 'Alice') {
        console.log('Verified: Nickname sync for existing users');
    }
});

client2.on('offer', (payload) => {
    console.log('Client 2 received offer from Alice:', payload.sdp);
    if (payload.sdp === 'fake-sdp' && payload.callerId === client1.id) {
        console.log('Verified: Signaling offer relay');
        checkFinished('Signaling');
    }
});

client1.on('chat-message', (msg) => {
    console.log('Client 1 received chat from Bob:', msg.text);
    if (msg.text === 'Hello Alice' && msg.sender === 'Bob') {
        console.log('Verified: Chat broadcast');
        checkFinished('Chat');
    }
});

client2.on('connect', () => {
    setTimeout(() => {
        console.log('Client 2 sending chat to Alice');
        client2.emit('chat-message', { text: 'Hello Alice', sender: 'Bob' });
    }, 2000);
});

setTimeout(() => {
    console.error('Simulation timed out! Current progress:', clientsReady);
    process.exit(1);
}, 10000);
