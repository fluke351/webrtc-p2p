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
        showToast('Server connection failed. Please reload.', 'error');
        return;
    }

    // --- DOM Elements ---
    const joinScreen = document.getElementById('join-screen');
    const roomScreen = document.getElementById('room-screen');
    const roomInput = document.getElementById('room-input');
    const joinBtn = document.getElementById('join-btn');
    const roomIdDisplay = document.getElementById('room-id-display');
    const copyLinkBtn = document.getElementById('copy-link-btn');
    const localVideo = document.getElementById('local-video');
    const remoteVideo = document.getElementById('remote-video');
    const remoteVideoWrapper = document.querySelector('.video-wrapper.remote');
    const waitingMessage = remoteVideoWrapper.querySelector('.waiting-message');
    const localVideoWrapper = document.querySelector('.video-wrapper.local');
    const micBtn = document.getElementById('mic-btn');
    const screenBtn = document.getElementById('screen-btn');
    const stopShareBtn = document.getElementById('stop-share-btn');
    const leaveBtn = document.getElementById('leave-btn');
    const expandBtn = document.getElementById('expand-btn');

    // New Features Elements
    const chatBtn = document.getElementById('chat-btn');
    const chatContainer = document.getElementById('chat-container');
    const closeChatBtn = document.getElementById('close-chat');
    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');
    const chatMessages = document.getElementById('chat-messages');
    const emojiContainer = document.getElementById('emoji-container');
    const pipBtn = document.getElementById('pip-btn');
    const volumeSlider = document.getElementById('remote-volume');

    // --- State Variables ---
    let localStream = null;
    let remoteStream = null;
    let peerConnection = null;
    let videoSender = null;
    let roomId = null;
    let isScreenSharing = false;
    let currentScreenStream = null;

    // --- WebRTC Config ---
    const rtcConfig = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    };

    // --- Helper Functions ---

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

    function getConstraints() {
        return {
            video: false, // Default to audio only, no camera
            audio: true
        };
    }

    async function startLocalStream() {
        try {
            const constraints = getConstraints();
            if (localStream) {
                localStream.getTracks().forEach(track => track.stop());
            }

            try {
                // Try audio only
                localStream = await navigator.mediaDevices.getUserMedia(constraints);
            } catch (err) {
                console.warn('Could not get audio.', err);
                localStream = null;
                showToast('Microphone not found. Joining as viewer.', 'info');
            }

            if (localStream) {
                // Local video shows nothing (or user avatar/placeholder)
                updateButtonStates();
            } else {
                // No local stream
                localVideoWrapper.classList.add('mic-off');
                micBtn.classList.add('inactive');
            }

            return true; // Always allow joining
        } catch (err) {
            console.error('Error accessing media devices:', err);
            showToast('Error initializing media. Joining as viewer.', 'error');
            return true;
        }
    }

    function updateButtonStates() {
        // Default: disabled if no stream
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
            // No audio track -> disable button
            micBtn.classList.add('disabled');
            localVideoWrapper.classList.add('mic-off');
        }
    }

    // --- Initialization ---

    // Check for room in URL
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
        roomInput.value = roomParam;
    }

    // --- Event Listeners ---

    // Enter key support
    roomInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            joinBtn.click();
        }
    });

    expandBtn.addEventListener('click', () => {
        remoteVideoWrapper.classList.toggle('expanded');
        const icon = expandBtn.querySelector('i');
        if (remoteVideoWrapper.classList.contains('expanded')) {
            icon.className = 'fas fa-compress';
            expandBtn.title = "Exit Full Screen";
        } else {
            icon.className = 'fas fa-expand';
            expandBtn.title = "Full Screen";
        }
    });

    // Global Error Handler for debugging on mobile/other devices
    window.onerror = function (message, source, lineno, colno, error) {
        showToast(`Error: ${message}`, 'error');
        console.error('Global Error:', error);
        return false;
    };

    joinBtn.addEventListener('click', async () => {
        console.log('Join button clicked');
        roomId = roomInput.value.trim();
        if (!roomId) {
            showToast('Please enter a room ID', 'error');
            return;
        }

        // Set Loading State
        const originalText = joinBtn.innerHTML;
        joinBtn.disabled = true;
        joinBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>Joining...</span>';

        try {
            // Timeout race for getUserMedia
            const mediaPromise = startLocalStream();
            const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve('timeout'), 5000));

            const result = await Promise.race([mediaPromise, timeoutPromise]);

            if (result === 'timeout') {
                console.warn('Media access timed out, proceeding as viewer');
                showToast('Media access slow/failed. Joining as viewer.', 'info');
                // Force join without local stream
                joinRoomSuccess(roomId);
            } else if (result) {
                joinRoomSuccess(roomId);
            } else {
                // startLocalStream returned false/null
                showToast('Failed to initialize. Please try again.', 'error');
                resetJoinBtn(originalText);
            }
        } catch (err) {
            console.error('Join error:', err);
            showToast('Error joining room: ' + err.message, 'error');
            resetJoinBtn(originalText);
        }
    });

    function resetJoinBtn(originalText) {
        joinBtn.disabled = false;
        joinBtn.innerHTML = originalText;
    }

    function joinRoomSuccess(id) {
        joinScreen.classList.remove('active');
        joinScreen.style.display = 'none';
        roomScreen.style.display = 'flex';
        roomIdDisplay.innerText = id;

        // Update URL without reloading
        const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname + '?room=' + id;
        window.history.pushState({ path: newUrl }, '', newUrl);

        socket.emit('join-room', id, socket.id);
    }

    copyLinkBtn.addEventListener('click', () => {
        const link = window.location.href;
        navigator.clipboard.writeText(link).then(() => {
            showToast('Link copied to clipboard!', 'success');
        }).catch(err => {
            showToast('Failed to copy link', 'error');
        });
    });

    // --- WebRTC Logic ---

    socket.on('user-connected', async (userId) => {
        console.log('User connected:', userId);
        showToast('User connected', 'info');
        remoteVideoWrapper.classList.remove('placeholder');
        if (waitingMessage) waitingMessage.style.display = 'none'; // Explicitly hide waiting message
        remoteVideoWrapper.classList.add('camera-off'); // Default to audio-only visual until video track arrives
        createPeerConnection();

        if (localStream) {
            localStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, localStream);
            });
        }

        // Fix: If already sharing screen, add that track too
        if (isScreenSharing && currentScreenStream) {
            const screenTrack = currentScreenStream.getVideoTracks()[0];
            if (screenTrack) {
                console.log('Adding existing screen track to new connection');
                videoSender = peerConnection.addTrack(screenTrack, currentScreenStream);
            }
        }

        try {
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            socket.emit('offer', { type: 'offer', sdp: offer, roomId: roomId });

            // Sync state after offer
            if (isScreenSharing) {
                setTimeout(() => {
                    socket.emit('media-state-change', {
                        roomId,
                        type: 'video',
                        enabled: true
                    });
                }, 1000);
            }
        } catch (err) {
            console.error('Error creating offer:', err);
        }
    });

    socket.on('offer', async (payload) => {
        console.log('Received offer');
        remoteVideoWrapper.classList.remove('placeholder');
        if (waitingMessage) waitingMessage.style.display = 'none'; // Explicitly hide waiting message
        if (!peerConnection) {
            createPeerConnection();
            localStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, localStream);
            });
        }

        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(payload.sdp));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            socket.emit('answer', { type: 'answer', sdp: answer, roomId: roomId });
        } catch (err) {
            console.error('Error handling offer:', err);
        }
    });

    socket.on('answer', async (payload) => {
        console.log('Received answer');
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        } catch (err) {
            console.error('Error handling answer:', err);
        }
    });

    socket.on('candidate', async (payload) => {
        try {
            if (peerConnection) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(payload.candidate));
            }
        } catch (err) {
            console.error('Error adding candidate:', err);
        }
    });

    socket.on('user-disconnected', () => {
        console.log('User disconnected');
        showToast('User disconnected', 'info');
        if (peerConnection) {
            peerConnection.close();
            peerConnection = null;
        }
        remoteVideo.srcObject = null;
        remoteVideoWrapper.classList.add('placeholder');
        if (waitingMessage) waitingMessage.style.display = 'block'; // Explicitly show waiting message
    });

    // Auto-reconnect Logic
    socket.on('disconnect', () => {
        showToast('Disconnected. Attempting to reconnect...', 'error');
    });

    // Video Event Listeners for better UI state management
    remoteVideo.onplaying = () => {
        console.log('Remote video is playing');
        remoteVideoWrapper.classList.remove('placeholder');
        remoteVideoWrapper.classList.remove('camera-off');
        if (waitingMessage) waitingMessage.style.display = 'none';
    };

    remoteVideo.onloadedmetadata = () => {
        console.log('Remote video metadata loaded');
        if (remoteVideo.srcObject && remoteVideo.srcObject.active) {
            remoteVideoWrapper.classList.remove('placeholder');
            if (waitingMessage) waitingMessage.style.display = 'none';
        }
    };

    // Socket.io Events
    socket.on('connect', () => {
        if (roomId && roomScreen.style.display !== 'none') {
            showToast('Reconnected!', 'success');
            socket.emit('join-room', roomId, socket.id);
            // Might need to renegotiate if ICE failed, but simpler to just re-join for signaling
        }
    });

    function createPeerConnection() {
        if (peerConnection) return;

        peerConnection = new RTCPeerConnection(rtcConfig);
        videoSender = null; // Reset video sender for new connection

        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('candidate', { candidate: event.candidate, roomId: roomId });
            }
        };

        peerConnection.ontrack = (event) => {
            console.log('Received remote track:', event.track.kind);
            const stream = event.streams[0];

            // Force update srcObject if it's new or just to ensure it plays
            if (remoteVideo.srcObject !== stream) {
                remoteVideo.srcObject = stream;
                console.log('Assigned new stream to remote video');
            }

            remoteVideoWrapper.classList.remove('placeholder');
            if (waitingMessage) waitingMessage.style.display = 'none'; // Explicitly hide waiting message

            // Auto-detect video track and show video
            if (event.track.kind === 'video') {
                remoteVideoWrapper.classList.remove('camera-off');
                // Ensure video plays
                remoteVideo.play().catch(e => console.error('Error playing video:', e));
            }
        };

        // ICE Connection State Monitoring
        peerConnection.oniceconnectionstatechange = () => {
            console.log('ICE State:', peerConnection.iceConnectionState);
            if (peerConnection.iceConnectionState === 'disconnected' || peerConnection.iceConnectionState === 'failed') {
                showToast('Connection unstable', 'error');
                // Optional: restartIce()
            }
        };
    }

    // Handle remote media state changes
    socket.on('media-state-change', (payload) => {
        if (payload.type === 'video') {
            if (payload.enabled) {
                remoteVideoWrapper.classList.remove('camera-off');
                // Ensure video plays when enabled
                remoteVideo.play().catch(e => console.error('Error playing remote video:', e));
            } else {
                remoteVideoWrapper.classList.add('camera-off');
            }
        } else if (payload.type === 'audio') {
            if (payload.enabled) {
                remoteVideoWrapper.classList.remove('mic-off');
            } else {
                remoteVideoWrapper.classList.add('mic-off');
            }
        }
    });

    // Controls

    // Camera Button listener removed

    micBtn.addEventListener('click', () => {
        if (!localStream) {
            showToast('No microphone found', 'error');
            return;
        }
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;

            // Update Local UI
            if (audioTrack.enabled) {
                micBtn.classList.remove('inactive');
                micBtn.classList.add('active');
                localVideoWrapper.classList.remove('mic-off');
            } else {
                micBtn.classList.remove('active');
                micBtn.classList.add('inactive');
                localVideoWrapper.classList.add('mic-off');
            }

            // Notify remote peer
            socket.emit('media-state-change', {
                roomId,
                type: 'audio',
                enabled: audioTrack.enabled
            });
        } else {
            showToast('No microphone available', 'error');
        }
    });

    screenBtn.addEventListener('click', async () => {
        // If already sharing, this button acts as "Switch Screen"
        // If not sharing, it starts sharing

        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
                showToast('Screen sharing is not supported on this device/browser.', 'error');
                return;
            }

            const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            const screenTrack = screenStream.getVideoTracks()[0];

            // Replace video track in peer connection sender or Add track if not exists
            if (peerConnection) {
                if (videoSender) {
                    // Reuse existing sender
                    await videoSender.replaceTrack(screenTrack);
                } else {
                    // Try to find an existing video sender that might have been created before
                    const senders = peerConnection.getSenders();
                    const existingSender = senders.find(s => s.track && s.track.kind === 'video');

                    if (existingSender) {
                        videoSender = existingSender;
                        await videoSender.replaceTrack(screenTrack);
                    } else {
                        // No video sender (audio only mode), so add track
                        videoSender = peerConnection.addTrack(screenTrack, localStream || screenStream);

                        // Renegotiate
                        const offer = await peerConnection.createOffer();
                        await peerConnection.setLocalDescription(offer);
                        socket.emit('offer', { type: 'offer', sdp: offer, roomId: roomId });
                    }
                }
            } else {
                showToast('Sharing screen (Waiting for peer to join)', 'info');
            }

            // Update local video
            localVideo.srcObject = screenStream;
            currentScreenStream = screenStream; // Store to stop later

            screenTrack.onended = () => {
                stopScreenShare();
            };

            isScreenSharing = true;
            screenBtn.classList.add('sharing');
            screenBtn.title = "Switch Screen";
            stopShareBtn.style.display = 'flex'; // Show stop button

            // Notify user
            showToast('Screen sharing started', 'success');

            // Notify remote peer
            socket.emit('media-state-change', {
                roomId,
                type: 'video',
                enabled: true
            });

        } catch (err) {
            console.error('Error sharing screen:', err);
            if (err.name === 'NotAllowedError') {
                showToast('Screen sharing permission denied', 'error');
            } else if (err.name === 'NotSupportedError') {
                showToast('Screen sharing not supported by this browser', 'error');
            } else {
                showToast('Failed to share screen: ' + err.message, 'error');
            }
        }
    });

    stopShareBtn.addEventListener('click', () => {
        stopScreenShare();
    });

    function stopScreenShare() {
        if (!isScreenSharing) return;

        if (peerConnection) {
            if (videoSender) {
                // Keep the sender, just stop sending media
                videoSender.replaceTrack(null).catch(e => console.error('Error stopping track:', e));
            } else {
                // Fallback attempt to find sender
                const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
                if (sender) {
                    sender.replaceTrack(null).catch(e => console.error('Error stopping track:', e));
                }
            }
        }

        // Clear local video
        localVideo.srcObject = null;

        // Stop the screen share stream tracks
        if (currentScreenStream) {
            currentScreenStream.getTracks().forEach(track => track.stop());
            currentScreenStream = null;
        }

        isScreenSharing = false;
        screenBtn.classList.remove('sharing');
        screenBtn.title = "Share Screen";
        stopShareBtn.style.display = 'none';
        showToast('Screen sharing stopped', 'info');

        // Notify remote peer to turn off video display
        socket.emit('media-state-change', {
            roomId,
            type: 'video',
            enabled: false
        });
    }

    leaveBtn.addEventListener('click', () => {
        location.href = '/';
    });

    // --- New Features Logic ---

    // 1. Live Chat
    chatBtn.addEventListener('click', () => {
        chatContainer.classList.toggle('active');
        chatBtn.classList.toggle('active');
    });

    closeChatBtn.addEventListener('click', () => {
        chatContainer.classList.remove('active');
        chatBtn.classList.remove('active');
    });

    function sendMessage() {
        const message = chatInput.value.trim();
        if (message) {
            appendMessage(message, 'self');
            socket.emit('chat-message', message);
            chatInput.value = '';
        }
    }

    sendBtn.addEventListener('click', sendMessage);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });

    socket.on('chat-message', (message) => {
        appendMessage(message, 'other');
        if (!chatContainer.classList.contains('active')) {
            showToast('New message', 'info');
        }
    });

    function appendMessage(text, type) {
        const msgDiv = document.createElement('div');
        msgDiv.classList.add('message', type);
        msgDiv.textContent = text;
        chatMessages.appendChild(msgDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // 2. Reactions (Emoji Rain)
    document.querySelectorAll('.reaction-menu span').forEach(emojiBtn => {
        emojiBtn.addEventListener('click', () => {
            const emoji = emojiBtn.dataset.emoji;
            showFloatingEmoji(emoji);
            socket.emit('reaction', emoji);
        });
    });

    socket.on('reaction', (emoji) => {
        showFloatingEmoji(emoji);
    });

    function showFloatingEmoji(emoji) {
        const el = document.createElement('div');
        el.classList.add('floating-emoji');
        el.textContent = emoji;
        el.style.left = Math.random() * 80 + 10 + '%';
        emojiContainer.appendChild(el);

        setTimeout(() => {
            el.remove();
        }, 4000);
    }

    // 3. Picture-in-Picture
    pipBtn.addEventListener('click', async () => {
        try {
            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture();
            } else if (remoteVideo.readyState !== 0) {
                await remoteVideo.requestPictureInPicture();
            }
        } catch (error) {
            console.error('PiP Error:', error);
            showToast('PiP failed: ' + error.message, 'error');
        }
    });

    // 4. Volume Control
    volumeSlider.addEventListener('input', (e) => {
        remoteVideo.volume = e.target.value;
        const icon = volumeSlider.parentElement.querySelector('i');
        if (remoteVideo.volume == 0) {
            icon.className = 'fas fa-volume-mute';
        } else if (remoteVideo.volume < 0.5) {
            icon.className = 'fas fa-volume-down';
        } else {
            icon.className = 'fas fa-volume-up';
        }
    });

});
