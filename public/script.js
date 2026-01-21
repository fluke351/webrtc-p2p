const socket = typeof io !== 'undefined' ? io({
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    randomizationFactor: 0.5
}) : null;

// Ensure DOM is ready before attaching listeners
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM fully loaded');
    if (!socket) {
        showToast('การเชื่อมต่อเซิร์ฟเวอร์ล้มเหลว โปรดโหลดใหม่', 'error');
        return;
    }

    // --- DOM Elements ---
    const joinScreen = document.getElementById('join-screen');
    const roomScreen = document.getElementById('room-screen');
    const roomInput = document.getElementById('room-input');
    const nicknameInput = document.getElementById('nickname-input');
    const passwordInput = document.getElementById('password-input');
    const joinBtn = document.getElementById('join-btn');
    const roomIdDisplay = document.getElementById('room-id-display');
    const viewerCountDisplay = document.getElementById('viewer-count');
    const copyLinkBtn = document.getElementById('copy-link-btn');
    const theaterModeBtn = document.getElementById('theater-mode-btn');

    // Video Grid
    const videoGrid = document.getElementById('video-grid');
    const localVideo = document.getElementById('local-video');
    const localVideoWrapper = document.querySelector('.video-wrapper.local');

    // Controls
    const micBtn = document.getElementById('mic-btn');
    const screenBtn = document.getElementById('screen-btn');
    const stopShareBtn = document.getElementById('stop-share-btn');
    const leaveBtn = document.getElementById('leave-btn');

    // Features
    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');
    const chatMessages = document.getElementById('chat-messages');
    const emojiContainer = document.getElementById('emoji-container');
    const soundBtn = document.getElementById('sound-btn');
    const reactionBtn = document.getElementById('reaction-btn');

    // Navigation
    const unreadBadge = document.getElementById('unread-badge');

    // --- State Variables ---
    let localStream = null;
    let peers = {}; // userId -> { connection, videoSender, screenAudioSender, wrapper, videoEl }

    let roomId = null;
    let myNickname = '';
    let roomPassword = '';
    let isScreenSharing = false;
    let currentScreenStream = null;
    let amIHost = false;
    let unreadCount = 0;

    // --- WebRTC Config ---
    const rtcConfig = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    };

    // --- Modal Logic ---
    const gameModal = document.getElementById('game-modal');
    const closeGameBtn = document.getElementById('close-game-btn');
    const chatContainer = document.getElementById('chat-container');
    const closeChatBtn = document.getElementById('close-chat');
    const gameBtn = document.getElementById('game-btn');
    const chatBtn = document.getElementById('chat-btn');

    if (gameBtn) {
        gameBtn.addEventListener('click', () => {
            gameModal.style.display = 'flex';
        });
    }

    if (closeGameBtn) {
        closeGameBtn.addEventListener('click', () => {
            gameModal.style.display = 'none';
        });
    }

    // Close modal on outside click
    window.addEventListener('click', (e) => {
        if (e.target === gameModal) {
            gameModal.style.display = 'none';
        }
    });

    if (chatBtn) {
        chatBtn.addEventListener('click', () => {
            chatContainer.classList.toggle('active');
            if (chatContainer.classList.contains('active')) {
                unreadCount = 0;
                if (unreadBadge) {
                    unreadBadge.style.display = 'none';
                    unreadBadge.innerText = '';
                }
                scrollToBottom();
            }
        });
    }

    if (closeChatBtn) {
        closeChatBtn.addEventListener('click', () => {
            chatContainer.classList.remove('active');
        });
    }

    // --- Game Logic ---
    let boardState = ['', '', '', '', '', '', '', '', ''];
    let currentTurn = 'X';
    let gameActive = true;
    let mySymbol = 'X'; // Default, will change if needed
    const gameStatus = document.getElementById('game-status');
    const resetGameBtn = document.getElementById('reset-game-btn');
    const cells = document.querySelectorAll('.cell');

    cells.forEach(cell => {
        cell.addEventListener('click', () => {
            const index = cell.dataset.index;

            if (boardState[index] !== '' || !gameActive) return;

            // Loose turn check
            if (currentTurn !== mySymbol) {
                showToast("ยังไม่ใช่ตาของคุณ!", "error");
                return;
            }

            makeMove(index, mySymbol);
            socket.emit('game-move', { index, symbol: mySymbol, roomId });
        });
    });

    function makeMove(index, symbol) {
        if (boardState[index] !== '') return;

        boardState[index] = symbol;
        const cell = document.querySelector(`.cell[data-index="${index}"]`);
        cell.innerText = symbol;
        cell.classList.add(symbol.toLowerCase());

        if (checkWin(symbol)) {
            gameStatus.innerText = `${symbol} ชนะ!`;
            showToast(`${symbol} ชนะ!`, 'success');
            gameActive = false;
        } else if (boardState.every(cell => cell !== '')) {
            gameStatus.innerText = "เสมอ!";
            gameActive = false;
        } else {
            currentTurn = symbol === 'X' ? 'O' : 'X';
            gameStatus.innerText = `ตาของ ${currentTurn}`;

            if (symbol === mySymbol) {
                gameStatus.innerText += " (รอฝ่ายตรงข้าม)";
            } else {
                gameStatus.innerText += " (ตาคุณ!)";
            }
        }
    }

    function checkWin(symbol) {
        const winConditions = [
            [0, 1, 2], [3, 4, 5], [6, 7, 8], // Rows
            [0, 3, 6], [1, 4, 7], [2, 5, 8], // Cols
            [0, 4, 8], [2, 4, 6]             // Diagonals
        ];
        return winConditions.some(combination => {
            return combination.every(index => boardState[index] === symbol);
        });
    }

    resetGameBtn.addEventListener('click', () => {
        resetGame();
        socket.emit('game-restart', roomId);
    });

    function resetGame() {
        boardState = ['', '', '', '', '', '', '', '', ''];
        cells.forEach(cell => {
            cell.innerText = '';
            cell.className = 'cell';
            cell.classList.remove('x', 'o');
        });
        currentTurn = 'X';
        gameActive = true;
        gameStatus.innerText = "ตาของ X";
        showToast("เริ่มเกมใหม่!", "info");
    }

    // Init game state
    gameActive = true;

    // --- Socket Events for Game ---
    socket.on('game-move', (payload) => {
        // If I receive a move, I must be the OTHER symbol
        if (mySymbol === payload.symbol) {
            mySymbol = payload.symbol === 'X' ? 'O' : 'X'; // Switch my symbol if conflict
        }

        makeMove(payload.index, payload.symbol);

        // Notify if not on game modal
        if (gameModal.style.display !== 'flex') {
            showToast(`คู่แข่งเดินที่ช่อง ${parseInt(payload.index) + 1}`, 'info');
        }
    });

    socket.on('game-restart', () => {
        resetGame();
    });

    // --- Helper Functions ---

    // Theater Mode Logic
    function toggleTheaterMode() {
        videoGrid.classList.toggle('theater-mode');
        const icon = theaterModeBtn.querySelector('i');

        if (videoGrid.classList.contains('theater-mode')) {
            icon.className = 'fas fa-th-large';
            theaterModeBtn.title = "โหมดตาราง (Grid)";
            showToast('เข้าสู่โหมดโรงหนัง', 'info');

            // Auto-feature the first remote video or local if none
            const firstRemote = document.querySelector('.video-wrapper.remote');
            if (firstRemote && !document.querySelector('.featured')) {
                makeFeatured(firstRemote);
            } else if (!document.querySelector('.featured')) {
                makeFeatured(localVideoWrapper);
            }
        } else {
            icon.className = 'fas fa-rectangle-wide';
            theaterModeBtn.title = "โหมดโรงหนัง";
            showToast('ออกจากโหมดโรงหนัง', 'info');
            document.querySelectorAll('.featured').forEach(el => el.classList.remove('featured'));
        }
    }

    function makeFeatured(element) {
        document.querySelectorAll('.featured').forEach(el => el.classList.remove('featured'));
        element.classList.add('featured');
    }

    theaterModeBtn.addEventListener('click', toggleTheaterMode);

    // Handle video selection in Theater Mode
    videoGrid.addEventListener('click', (e) => {
        if (!videoGrid.classList.contains('theater-mode')) return;

        const wrapper = e.target.closest('.video-wrapper');
        if (wrapper && !wrapper.classList.contains('featured')) {
            makeFeatured(wrapper);
        }
    });

    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        let icon = 'info-circle';
        if (type === 'success') icon = 'check-circle';
        if (type === 'error') icon = 'exclamation-circle';

        toast.innerHTML = `<i class="fas fa-${icon}"></i> <span>${message}</span>`;
        document.body.appendChild(toast);

        // Trigger reflow
        void toast.offsetWidth;
        toast.classList.add('show');

        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    async function startLocalStream() {
        try {
            const constraints = {
                video: false, // Start with audio only? Or video? Original code had video:true but commented out? 
                // Wait, original code: video: true. Let's keep it consistent.
                // But usually we want camera? The user has "Camera Off" logic.
                // Let's assume audio only for "Cinema" mode unless specified?
                // The previous code had video: true.
                video: true,
                audio: true
            };

            if (localStream) {
                localStream.getTracks().forEach(track => track.stop());
            }

            try {
                localStream = await navigator.mediaDevices.getUserMedia(constraints);
            } catch (err) {
                console.warn('Could not get media.', err);
                localStream = null;
                showToast('ไม่พบไมโครโฟน/กล้อง เข้าร่วมในฐานะผู้ชม', 'info');
            }

            if (localStream) {
                // Mute local video to prevent feedback
                localVideo.srcObject = localStream;
                localVideo.muted = true;
                updateButtonStates();
            } else {
                localVideoWrapper.classList.add('mic-off');
                micBtn.classList.add('inactive');
            }

            return true;
        } catch (err) {
            console.error('Error accessing media devices:', err);
            showToast('เกิดข้อผิดพลาดในการเริ่มต้นสื่อ เข้าร่วมในฐานะผู้ชม', 'error');
            return true;
        }
    }

    function updateButtonStates() {
        if (!localStream) {
            micBtn.classList.add('disabled');
            localVideoWrapper.classList.add('mic-off');
            return;
        }

        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            micBtn.classList.remove('disabled');
            if (audioTrack.enabled) {
                micBtn.classList.remove('inactive');
                micBtn.classList.add('active');
                localVideoWrapper.classList.remove('mic-off');
            } else {
                micBtn.classList.remove('active');
                micBtn.classList.add('inactive');
                localVideoWrapper.classList.add('mic-off');
            }
        } else {
            micBtn.classList.add('disabled');
            localVideoWrapper.classList.add('mic-off');
        }
    }

    // --- Peer Connection Logic (Mesh) ---

    function createPeerConnection(userId, initiator = false) {
        const pc = new RTCPeerConnection(rtcConfig);
        const peer = {
            connection: pc,
            videoSender: null,
            screenAudioSender: null,
            wrapper: null,
            videoEl: null
        };
        peers[userId] = peer;

        // Add Local Tracks
        if (localStream) {
            localStream.getTracks().forEach(track => {
                if (track.kind === 'video') {
                    // Initial video track (camera)
                    peer.videoSender = pc.addTrack(track, localStream);
                } else {
                    pc.addTrack(track, localStream);
                }
            });
        }

        // If sharing screen, replace video track immediately or add it
        if (isScreenSharing && currentScreenStream) {
            const screenTrack = currentScreenStream.getVideoTracks()[0];
            if (screenTrack) {
                if (peer.videoSender) {
                    peer.videoSender.replaceTrack(screenTrack);
                } else {
                    peer.videoSender = pc.addTrack(screenTrack, currentScreenStream);
                }
            }
            const screenAudioTrack = currentScreenStream.getAudioTracks()[0];
            if (screenAudioTrack) {
                peer.screenAudioSender = pc.addTrack(screenAudioTrack, currentScreenStream);
            }
        }

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('candidate', {
                    target: userId,
                    candidate: event.candidate,
                    roomId: roomId,
                    callerId: socket.id
                });
            }
        };

        pc.ontrack = (event) => {
            console.log(`Received track from ${userId}: ${event.track.kind}`);
            const stream = event.streams[0];

            if (!peer.wrapper) {
                addRemoteVideo(userId, stream);
            }

            if (event.track.kind === 'video') {
                peer.videoEl.srcObject = stream;
                peer.videoEl.play().catch(e => console.error('Error playing remote video:', e));
                peer.wrapper.classList.remove('placeholder');
                peer.wrapper.classList.remove('camera-off');

                // Monitor track ending
                event.track.onended = () => {
                    console.log(`Video track ended for ${userId}`);
                    // Revert to placeholder or camera-off
                    peer.wrapper.classList.add('camera-off');
                };
            } else if (event.track.kind === 'audio') {
                // If it's a secondary audio track (system audio), create separate element
                if (peer.videoEl.srcObject !== stream) {
                    const audio = document.createElement('audio');
                    audio.srcObject = stream;
                    audio.autoplay = true;
                    document.body.appendChild(audio);
                    event.track.onended = () => audio.remove();
                }
            }
        };

        pc.oniceconnectionstatechange = () => {
            console.log(`ICE State for ${userId}: ${pc.iceConnectionState}`);
            if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
                showToast(`การเชื่อมต่อกับผู้ใช้หลุด (ID: ${userId})`, 'error');
                // Could try to restart ICE here
                // removePeer(userId); // Optional: remove or wait for reconnect?
                if (peer.wrapper) peer.wrapper.classList.add('placeholder');
            }
        };

        return pc;
    }

    function addRemoteVideo(userId, stream) {
        if (peers[userId] && peers[userId].wrapper) return;

        const wrapper = document.createElement('div');
        wrapper.className = 'video-wrapper remote placeholder';
        wrapper.id = `video-${userId}`;

        wrapper.innerHTML = `
            <div class="waiting-message">
                <i class="fas fa-spinner fa-spin"></i>
                <p>กำลังเชื่อมต่อ...</p>
            </div>
            <div class="camera-off-indicator">
                <i class="fas fa-user-circle"></i>
                <span>ผู้ชม (เสียงเท่านั้น)</span>
            </div>
            <video autoplay playsinline></video>
            <button class="icon-btn pip-btn" title="โหมดภาพซ้อนภาพ">
                <i class="fas fa-images"></i>
            </button>
            <button class="icon-btn expand-btn" title="เต็มหน้าจอ">
                <i class="fas fa-expand"></i>
            </button>
            <div class="video-overlay">
                <span class="user-label">ผู้ชม</span>
                <div class="volume-control">
                    <i class="fas fa-volume-up"></i>
                    <input type="range" min="0" max="1" step="0.1" value="1">
                </div>
                <div class="audio-indicator"><i class="fas fa-microphone"></i></div>
            </div>
        `;

        const video = wrapper.querySelector('video');
        video.srcObject = stream;

        // Volume Control
        const volumeSlider = wrapper.querySelector('input[type="range"]');
        volumeSlider.addEventListener('input', (e) => {
            video.volume = e.target.value;
        });

        // Expand/PiP buttons can be added here if needed per-video
        const pipBtn = wrapper.querySelector('.pip-btn');
        const expandBtn = wrapper.querySelector('.expand-btn');

        if (pipBtn) {
            pipBtn.addEventListener('click', async () => {
                try {
                    if (document.pictureInPictureElement) {
                        await document.exitPictureInPicture();
                    } else if (video.readyState !== 0) {
                        await video.requestPictureInPicture();
                    }
                } catch (err) {
                    console.error('PiP Error:', err);
                }
            });
        }

        if (expandBtn) {
            expandBtn.addEventListener('click', () => {
                wrapper.classList.toggle('expanded');
                const icon = expandBtn.querySelector('i');
                if (wrapper.classList.contains('expanded')) {
                    icon.className = 'fas fa-compress';
                    expandBtn.title = "ออกจากเต็มหน้าจอ";
                } else {
                    icon.className = 'fas fa-expand';
                    expandBtn.title = "เต็มหน้าจอ";
                }
            });
        }

        videoGrid.appendChild(wrapper);

        if (peers[userId]) {
            peers[userId].wrapper = wrapper;
            peers[userId].videoEl = video;
        }
    }

    function removePeer(userId) {
        if (peers[userId]) {
            if (peers[userId].connection) {
                peers[userId].connection.close();
            }
            if (peers[userId].wrapper) {
                peers[userId].wrapper.remove();
            }
            delete peers[userId];
        }
    }

    // --- Socket Events ---

    socket.on('you-are-host', () => {
        amIHost = true;
        showToast('คุณคือเจ้าของห้อง (Host)', 'success');
        // Show kick buttons for existing peers
        document.querySelectorAll('.kick-btn').forEach(btn => btn.style.display = 'block');
    });

    socket.on('kicked', () => {
        alert('คุณถูกเชิญออกจากห้องโดยเจ้าของห้อง');
        location.href = '/';
    });

    socket.on('update-viewer-count', (count) => {
        if (viewerCountDisplay) {
            viewerCountDisplay.innerText = count;
        }
    });

    socket.on('user-connected', async (userId, nickname) => {
        console.log('User connected:', userId, nickname);
        showToast(`${nickname || 'ผู้ชม'} เข้าโรงหนังแล้ว`, 'info');

        const pc = createPeerConnection(userId, true);
        try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.emit('offer', {
                target: userId,
                sdp: offer,
                roomId: roomId,
                callerId: socket.id // Identify myself
            });
        } catch (err) {
            console.error('Error creating offer:', err);
        }
    });

    socket.on('offer', async (payload) => {
        console.log('Received offer from:', payload.callerId);
        const userId = payload.callerId;

        let pc;
        if (peers[userId]) {
            pc = peers[userId].connection;
        } else {
            pc = createPeerConnection(userId, false);
        }

        try {
            await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('answer', {
                target: userId,
                sdp: answer,
                roomId: roomId,
                callerId: socket.id
            });
        } catch (err) {
            console.error('Error handling offer:', err);
        }
    });

    socket.on('answer', async (payload) => {
        console.log('Received answer from:', payload.callerId);
        const userId = payload.callerId;
        if (peers[userId]) {
            try {
                await peers[userId].connection.setRemoteDescription(new RTCSessionDescription(payload.sdp));
            } catch (err) {
                console.error('Error handling answer:', err);
            }
        }
    });

    socket.on('candidate', async (payload) => {
        // payload.target matches my socket.id (handled by server routing)
        // But I need to know WHO sent it?
        // Server emits { target, candidate, callerId? }
        // I didn't add callerId to candidate in server.js?
        // Wait, server.js just relays: io.to(target).emit('candidate', payload).
        // So payload MUST contain callerId from client side?
        // My createPeerConnection emits candidate with { target, candidate, roomId }.
        // I need to add callerId there!

        // Wait, socket.on('candidate') handler needs to know which PC to add to.
        // I must change `pc.onicecandidate` to include `callerId: socket.id`.

        // Handling incoming:
        // payload: { target, candidate, roomId, callerId }
        const userId = payload.callerId; // Sender
        if (peers[userId]) {
            try {
                await peers[userId].connection.addIceCandidate(new RTCIceCandidate(payload.candidate));
            } catch (err) {
                console.error('Error adding candidate:', err);
            }
        }
    });

    socket.on('user-disconnected', (userId, nickname) => {
        console.log('User disconnected:', userId);
        showToast(`${nickname || 'ผู้ชม'} ออกจากโรงหนังแล้ว`, 'info');
        removePeer(userId);
    });

    socket.on('error-message', (message) => {
        let displayMessage = message;
        if (message === 'Incorrect password') displayMessage = 'รหัสผ่านไม่ถูกต้อง';
        showToast(displayMessage, 'error');
        if (message === 'Incorrect password') {
            joinScreen.style.display = 'flex';
            roomScreen.style.display = 'none';
            joinScreen.classList.add('active');
            joinBtn.disabled = false;
            joinBtn.innerHTML = '<span>เข้าสู่โรงหนัง</span><i class="fas fa-play"></i>';
        }
    });

    // --- UI Interactions ---

    joinBtn.addEventListener('click', async () => {
        roomId = roomInput.value.trim();
        myNickname = nicknameInput.value.trim();
        roomPassword = passwordInput.value.trim();

        if (!myNickname) {
            showToast('กรุณาระบุชื่อผู้ชม', 'error');
            return;
        }
        if (!roomId) {
            showToast('กรุณาระบุหมายเลขโรง', 'error');
            return;
        }

        joinBtn.disabled = true;
        joinBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>กำลังตรวจสอบตั๋ว...</span>';

        await startLocalStream();

        joinScreen.classList.remove('active');
        joinScreen.style.display = 'none';
        roomScreen.style.display = 'flex';
        roomIdDisplay.innerText = roomId;

        const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname + '?room=' + roomId;
        window.history.pushState({ path: newUrl }, '', newUrl);

        socket.emit('join-room', roomId, socket.id, myNickname, roomPassword);
    });

    micBtn.addEventListener('click', () => {
        if (!localStream) {
            showToast('ไม่พบไมโครโฟน', 'error');
            return;
        }
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            updateButtonStates();

            // Notify others? (Optional visual indicator)
            socket.emit('media-state-change', {
                roomId,
                type: 'audio',
                enabled: audioTrack.enabled
            });
        }
    });

    screenBtn.addEventListener('click', async () => {
        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
                showToast('อุปกรณ์ไม่รองรับการฉายหนัง (Share Screen)', 'error');
                return;
            }

            const screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: true
            });
            const screenTrack = screenStream.getVideoTracks()[0];
            const screenAudioTrack = screenStream.getAudioTracks()[0];

            // Update all peers
            Object.keys(peers).forEach(userId => {
                const peer = peers[userId];
                let needsRenegotiation = false;

                if (peer.videoSender) {
                    peer.videoSender.replaceTrack(screenTrack).catch(e => console.error(e));
                }

                if (screenAudioTrack) {
                    if (!peer.screenAudioSender) {
                        peer.screenAudioSender = peer.connection.addTrack(screenAudioTrack, screenStream);
                        needsRenegotiation = true;
                    } else {
                        peer.screenAudioSender.replaceTrack(screenAudioTrack).catch(e => console.error(e));
                    }
                }

                if (needsRenegotiation) {
                    renegotiate(userId);
                }
            });

            localVideo.srcObject = screenStream;
            currentScreenStream = screenStream;

            screenTrack.onended = () => stopScreenShare();

            isScreenSharing = true;
            screenBtn.classList.add('sharing');
            screenBtn.title = "Switch Screen";
            stopShareBtn.style.display = 'flex';
            showToast('เริ่มฉายหนังแล้ว', 'success');

        } catch (err) {
            console.error('Error sharing:', err);
            showToast('ยกเลิกการฉายหนัง', 'info');
        }
    });

    stopShareBtn.addEventListener('click', stopScreenShare);

    function stopScreenShare() {
        if (!isScreenSharing) return;

        // Revert to camera track (if available) or null
        let cameraTrack = null;
        if (localStream) {
            const videoTrack = localStream.getVideoTracks()[0]; // If we enabled video
            if (videoTrack) cameraTrack = videoTrack;
        }

        Object.values(peers).forEach(peer => {
            if (peer.videoSender) {
                peer.videoSender.replaceTrack(cameraTrack).catch(e => console.error(e));
            }
            if (peer.screenAudioSender) {
                peer.screenAudioSender.stop(); // Stop the sender? Or replace with null?
                peer.connection.removeTrack(peer.screenAudioSender); // Better to remove?
                peer.screenAudioSender = null;
            }
        });

        if (currentScreenStream) {
            currentScreenStream.getTracks().forEach(track => track.stop());
            currentScreenStream = null;
        }

        localVideo.srcObject = localStream; // Revert local view
        isScreenSharing = false;
        screenBtn.classList.remove('sharing');
        stopShareBtn.style.display = 'none';
        showToast('หยุดฉายหนังแล้ว', 'info');
    }

    leaveBtn.addEventListener('click', () => {
        location.href = '/';
    });

    // --- Chat & Reactions (Broadcast) ---

    // Reaction & Sound Logic
    reactionBtn.addEventListener('click', () => {
        const menu = reactionBtn.nextElementSibling;
        menu.classList.toggle('show');
        // Close others
        soundBtn.nextElementSibling.classList.remove('show');
    });

    soundBtn.addEventListener('click', () => {
        const menu = soundBtn.nextElementSibling;
        menu.classList.toggle('show');
        reactionBtn.nextElementSibling.classList.remove('show');
    });

    // Delegate clicks for emoji/sound menus
    document.addEventListener('click', (e) => {
        if (e.target.closest('.reaction-menu span')) {
            const item = e.target.closest('span');
            const emoji = item.dataset.emoji;
            const sound = item.dataset.sound;

            if (emoji) {
                showFloatingEmoji(emoji);
                socket.emit('reaction', emoji);
                item.parentElement.classList.remove('show');
            } else if (sound) {
                playSoundEffect(sound);
                socket.emit('play-sound', sound);
                item.parentElement.classList.remove('show');
            }
        } else if (!e.target.closest('.reaction-wrapper')) {
            // Close menus if clicked outside
            document.querySelectorAll('.reaction-menu').forEach(m => m.classList.remove('show'));
        }
    });

    socket.on('reaction', (emoji) => {
        showFloatingEmoji(emoji);
    });

    socket.on('play-sound', (soundId) => {
        playSoundEffect(soundId);
    });

    function showFloatingEmoji(emoji) {
        const el = document.createElement('div');
        el.className = 'floating-emoji';
        el.innerText = emoji;
        el.style.left = Math.random() * 80 + 10 + '%'; // Random horizontal
        emojiContainer.appendChild(el);
        setTimeout(() => el.remove(), 4000);
    }

    const soundEffects = {
        clap: 'sounds/clap.mp3',
        laugh: 'sounds/laugh.mp3',
        drum: 'sounds/drum.mp3',
        horn: 'sounds/horn.mp3'
    };

    function playSoundEffect(id) {
        if (soundEffects[id]) {
            // In a real app, these files should exist. 
            // Since we don't have them, we might just log or show a visual indicator.
            // Or use AudioContext to generate beep?
            // For now, let's assume files exist or just visual.
            console.log('Playing sound:', id);
            // const audio = new Audio(soundEffects[id]);
            // audio.play().catch(e => console.warn('Sound play failed', e));

            showToast(`Sound Effect: ${id}`, 'info');
        }
    }

    function sendMessage() {
        const message = chatInput.value.trim();
        if (message) {
            const msgData = { text: message, sender: myNickname };
            appendMessage(msgData, 'self');
            socket.emit('chat-message', msgData);
            chatInput.value = '';
        }
    }

    sendBtn.addEventListener('click', sendMessage);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });

    socket.on('chat-message', (msgData) => {
        if (typeof msgData === 'string') msgData = { text: msgData, sender: 'User' };
        appendMessage(msgData, 'other');

        // Check if Chat Container is active
        if (chatContainer && !chatContainer.classList.contains('active')) {
            showToast(`ข้อความใหม่จาก ${msgData.sender}`, 'info');
            unreadCount++;
            if (unreadBadge) {
                unreadBadge.style.display = 'block';
                unreadBadge.innerText = unreadCount > 9 ? '9+' : unreadCount;
            }
        }
    });

    function appendMessage(data, type) {
        const div = document.createElement('div');
        div.className = `message ${type}`;
        div.innerHTML = `
            <div class="sender">${data.sender}</div>
            <div class="text">${data.text}</div>
        `;
        chatMessages.appendChild(div);
        scrollToBottom();
    }

    function scrollToBottom() {
        if (chatMessages) {
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
    }

    // Initial Check
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('room')) {
        roomInput.value = urlParams.get('room');
    }

    // Network Quality Monitoring Loop
    setInterval(async () => {
        for (const userId in peers) {
            const peer = peers[userId];
            if (!peer.connection || !peer.wrapper) continue;

            if (peer.connection.iceConnectionState !== 'connected' && peer.connection.iceConnectionState !== 'completed') continue;

            try {
                const stats = await peer.connection.getStats();
                let rtt = null;

                stats.forEach(report => {
                    if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.currentRoundTripTime !== undefined) {
                        rtt = report.currentRoundTripTime * 1000;
                    }
                });

                const indicator = peer.wrapper.querySelector('.network-indicator');
                if (indicator) {
                    indicator.className = 'network-indicator';
                    if (rtt !== null) {
                        if (rtt < 100) indicator.classList.add('good');
                        else if (rtt < 300) indicator.classList.add('fair');
                        else indicator.classList.add('poor');
                        indicator.title = `Ping: ${Math.round(rtt)}ms`;
                    }
                }
            } catch (e) {
                // ignore
            }
        }
    }, 2000);
});
