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
let screenAudioSender = null;

    let roomId = null;
    let myNickname = '';
    let roomPassword = '';
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
video: true, // Enable camera

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
showToast('ไม่พบไมโครโฟน เข้าร่วมในฐานะผู้ชม', 'info');

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
showToast('เกิดข้อผิดพลาดในการเริ่มต้นสื่อ เข้าร่วมในฐานะผู้ชม', 'error');

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
expandBtn.title = "ออกจากเต็มหน้าจอ";
        } else {
            icon.className = 'fas fa-expand';
            expandBtn.title = "เต็มหน้าจอ";

        }
    });

    // Global Error Handler for debugging on mobile/other devices
    window.onerror = function (message, source, lineno, colno, error) {
showToast(`ข้อผิดพลาด: ${message}`, 'error');

        console.error('Global Error:', error);
        return false;
    };

    joinBtn.addEventListener('click', async () => {
        console.log('Join button clicked');
        roomId = roomInput.value.trim();
        myNickname = nicknameInput.value.trim();
        roomPassword = passwordInput.value.trim();

        if (!myNickname) {
showToast('กรุณาระบุชื่อเล่น', 'error');

            return;
        }

        if (!roomId) {
showToast('กรุณาระบุรหัสห้อง', 'error');

            return;
        }

        // Set Loading State
        const originalText = joinBtn.innerHTML;
        joinBtn.disabled = true;
joinBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>กำลังเข้าร่วม...</span>';


        try {
            // Timeout race for getUserMedia
            const mediaPromise = startLocalStream();
            const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve('timeout'), 5000));

            const result = await Promise.race([mediaPromise, timeoutPromise]);

            if (result === 'timeout') {
                console.warn('Media access timed out, proceeding as viewer');
showToast('การเข้าถึงสื่อล่าช้า/ล้มเหลว เข้าร่วมในฐานะผู้ชม', 'info');

                // Force join without local stream
                joinRoomSuccess(roomId);
            } else if (result) {
                joinRoomSuccess(roomId);
            } else {
                // startLocalStream returned false/null
showToast('การเริ่มต้นล้มเหลว โปรดลองอีกครั้ง', 'error');

                resetJoinBtn(originalText);
            }
        } catch (err) {
            console.error('Join error:', err);
showToast('เกิดข้อผิดพลาดในการเข้าร่วมห้อง: ' + err.message, 'error');

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

        socket.emit('join-room', id, socket.id, myNickname, roomPassword);
    }

    copyLinkBtn.addEventListener('click', () => {
        const link = window.location.href;
        navigator.clipboard.writeText(link).then(() => {
showToast('คัดลอกลิงก์ไปยังคลิปบอร์ดแล้ว!', 'success');
        }).catch(err => {
            showToast('ไม่สามารถคัดลอกลิงก์ได้', 'error');

        });
    });

    // --- WebRTC Logic ---

    socket.on('error-message', (message) => {
let displayMessage = message;
        if (message === 'Incorrect password') displayMessage = 'รหัสผ่านไม่ถูกต้อง';
        showToast(displayMessage, 'error');

        if (message === 'Incorrect password') {
            joinScreen.style.display = 'flex';
            roomScreen.style.display = 'none';
            joinScreen.classList.add('active');
resetJoinBtn('<span>เข้าร่วมห้อง</span><i class="fas fa-arrow-right"></i>');

        }
    });

    socket.on('user-connected', async (userId, nickname) => {
        console.log('User connected:', userId, nickname);
showToast(`${nickname || 'ผู้ใช้'} เชื่อมต่อแล้ว`, 'info');

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
const screenAudioTrack = currentScreenStream.getAudioTracks()[0];
            if (screenAudioTrack) {
                 console.log('Adding existing screen audio track to new connection');
                 screenAudioSender = peerConnection.addTrack(screenAudioTrack, currentScreenStream);
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

    socket.on('user-disconnected', (userId, nickname) => {
        console.log('User disconnected');
showToast(`${nickname || 'ผู้ใช้'} ตัดการเชื่อมต่อแล้ว`, 'info');

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
showToast('ตัดการเชื่อมต่อแล้ว กำลังพยายามเชื่อมต่อใหม่...', 'error');

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
showToast('เชื่อมต่อใหม่สำเร็จ!', 'success');

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

if (event.track.kind === 'video') {
                // Force update srcObject for video
                remoteVideo.srcObject = stream;
                console.log('Assigned new video stream to remote video');
                
                remoteVideoWrapper.classList.remove('placeholder');
                if (waitingMessage) waitingMessage.style.display = 'none'; // Explicitly hide waiting message
                remoteVideoWrapper.classList.remove('camera-off');
                // Ensure video plays
                remoteVideo.play().catch(e => console.error('Error playing video:', e));
            } else if (event.track.kind === 'audio') {
                // Handle Audio Track
                // If the stream is NOT the one currently in remoteVideo (which handles the main video/audio),
                // or if remoteVideo has no stream yet, we might need to handle it.
                // Simplest robust way: If it's a secondary audio track (like system audio while mic is on another stream), play it.
                
                if (remoteVideo.srcObject !== stream) {
                    console.log('New audio stream detected (separate from video), creating audio element');
                    const audio = document.createElement('audio');
                    audio.srcObject = stream;
                    audio.autoplay = true;
                    // audio.controls = true; 
                    // audio.style.display = 'none';
                    document.body.appendChild(audio);

                    // Cleanup when track ends
                    event.track.onended = () => {
                        console.log('Audio track ended, removing audio element');
                        audio.remove();
                    };
                }

            }
        };

        // ICE Connection State Monitoring
        peerConnection.oniceconnectionstatechange = () => {
            console.log('ICE State:', peerConnection.iceConnectionState);
            if (peerConnection.iceConnectionState === 'disconnected' || peerConnection.iceConnectionState === 'failed') {
showToast('การเชื่อมต่อไม่เสถียร', 'error');

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
showToast('ไม่พบไมโครโฟน', 'error');

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
showToast('ไม่มีไมโครโฟนที่ใช้งานได้', 'error');

        }
    });

    screenBtn.addEventListener('click', async () => {
        // If already sharing, this button acts as "Switch Screen"
        // If not sharing, it starts sharing

        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
showToast('อุปกรณ์/เบราว์เซอร์นี้ไม่รองรับการแชร์หน้าจอ', 'error');
                return;
            }

            const screenStream = await navigator.mediaDevices.getDisplayMedia({ 
                video: true,
                audio: true // Request system audio
            });
            const screenTrack = screenStream.getVideoTracks()[0];
            const screenAudioTrack = screenStream.getAudioTracks()[0]; // Get audio track if available

            // Replace video track in peer connection sender or Add track if not exists
            if (peerConnection) {
                let renegotiationNeeded = false;

                if (videoSender) {
                    // Reuse existing sender for video
                    await videoSender.replaceTrack(screenTrack);
                } else {
                    // ... (existing logic for video sender finding)
                    const senders = peerConnection.getSenders();
                    const existingSender = senders.find(s => s.track && s.track.kind === 'video');
                    

                    if (existingSender) {
                        videoSender = existingSender;
                        await videoSender.replaceTrack(screenTrack);
                    } else {
videoSender = peerConnection.addTrack(screenTrack, localStream || screenStream);
                        renegotiationNeeded = true;
                    }
                }

                // Handle System Audio
                if (screenAudioTrack) {
                    console.log('Adding system audio track');
                    if (screenAudioSender) {
                         await screenAudioSender.replaceTrack(screenAudioTrack);
                    } else {
                        screenAudioSender = peerConnection.addTrack(screenAudioTrack, screenStream);
                        renegotiationNeeded = true;
                    }
                }

                if (renegotiationNeeded) {
                    const offer = await peerConnection.createOffer();
                    await peerConnection.setLocalDescription(offer);
                    socket.emit('offer', { type: 'offer', sdp: offer, roomId: roomId });
                }
            } else {
                showToast('กำลังแชร์หน้าจอ (รอเพื่อนเข้าร่วม)', 'info');

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
if (screenAudioSender) {
                screenAudioSender.replaceTrack(null).catch(e => console.error('Error stopping audio track:', e));
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
        // Backward compatibility
        if (typeof msgData === 'string') {
            msgData = { text: msgData, sender: 'User' };
        }
        appendMessage(msgData, 'other');
        if (!chatContainer.classList.contains('active')) {
            showToast(`New message from ${msgData.sender}`, 'info');
        }
    });

    function appendMessage(data, type) {
        const msgDiv = document.createElement('div');
        msgDiv.classList.add('message', type);

        if (type === 'other') {
            const senderSpan = document.createElement('span');
            senderSpan.classList.add('sender-name');
            senderSpan.textContent = data.sender;
            msgDiv.appendChild(senderSpan);
        }

        const textSpan = document.createElement('span');
        textSpan.textContent = data.text;
        msgDiv.appendChild(textSpan);

        chatMessages.appendChild(msgDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // 2. Reactions (Emoji Rain)
    const reactionBtn = document.getElementById('reaction-btn');
    const reactionMenu = document.querySelector('.reaction-menu');

    reactionBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        reactionMenu.classList.toggle('show');
        reactionBtn.classList.toggle('active');
    });

    document.addEventListener('click', (e) => {
        if (!reactionBtn.contains(e.target) && !reactionMenu.contains(e.target)) {
            reactionMenu.classList.remove('show');
            reactionBtn.classList.remove('active');
        }
    });

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

    // 5. Sound Effects (Soundboard) with AudioContext
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const soundBtn = document.getElementById('sound-btn');
    const soundMenu = document.querySelector('.sound-menu');

    soundBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        soundMenu.classList.toggle('show');
        soundBtn.classList.toggle('active');
        // Close other menus
        reactionMenu.classList.remove('show');
        reactionBtn.classList.remove('active');
    });

    document.addEventListener('click', (e) => {
        if (!soundBtn.contains(e.target) && !soundMenu.contains(e.target)) {
            soundMenu.classList.remove('show');
            soundBtn.classList.remove('active');
        }
    });

    document.querySelectorAll('.sound-menu span').forEach(btn => {
        btn.addEventListener('click', () => {
            const soundId = btn.dataset.sound;
            playSound(soundId);
            socket.emit('play-sound', soundId);
        });
    });

    socket.on('play-sound', (soundId) => {
        playSound(soundId);
        showToast(`Sound effect: ${soundId}`, 'info');
    });

    function playSound(type) {
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }

        const osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        osc.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        const now = audioCtx.currentTime;

        if (type === 'clap') {
            // White noise burst
            const bufferSize = audioCtx.sampleRate * 0.1; // 0.1 sec
            const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                data[i] = Math.random() * 2 - 1;
            }
            const noise = audioCtx.createBufferSource();
            noise.buffer = buffer;
            const noiseGain = audioCtx.createGain();
            noise.connect(noiseGain);
            noiseGain.connect(audioCtx.destination);
            noiseGain.gain.setValueAtTime(1, now);
            noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
            noise.start(now);
        } else if (type === 'laugh') {
            // Series of oscillating pitches
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(400, now);
            osc.frequency.linearRampToValueAtTime(300, now + 0.1);
            osc.frequency.linearRampToValueAtTime(400, now + 0.2);
            osc.frequency.linearRampToValueAtTime(300, now + 0.3);
            gainNode.gain.setValueAtTime(0.5, now);
            gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
            osc.start(now);
            osc.stop(now + 0.5);
        } else if (type === 'drum') {
            // Low freq kick
            osc.frequency.setValueAtTime(150, now);
            osc.frequency.exponentialRampToValueAtTime(0.01, now + 0.5);
            gainNode.gain.setValueAtTime(1, now);
            gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
            osc.start(now);
            osc.stop(now + 0.5);
        } else if (type === 'horn') {
            // Air hornish (sawtooth)
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(300, now);
            osc.frequency.linearRampToValueAtTime(250, now + 0.5);
            gainNode.gain.setValueAtTime(0.5, now);
            gainNode.gain.linearRampToValueAtTime(0, now + 0.5);
            osc.start(now);
            osc.stop(now + 0.5);
        }
    }

    // 6. Auto-Hide Controls (Cinema Mode)
    let hideTimer;
    const body = document.body;

    function resetHideTimer() {
        body.classList.remove('hide-ui');
        clearTimeout(hideTimer);
        // Only hide if we are in the room screen
        if (roomScreen.style.display !== 'none') {
            hideTimer = setTimeout(() => {
                body.classList.add('hide-ui');
            }, 3000); // 3 seconds
        }
    }

    document.addEventListener('mousemove', resetHideTimer);
    document.addEventListener('click', resetHideTimer);
    document.addEventListener('keydown', resetHideTimer);

// 7. Connection Status Monitor
    const pingDisplay = document.getElementById('ping-display');
    const statusDot = document.querySelector('.status-dot');


    setInterval(async () => {
        if (!peerConnection || peerConnection.iceConnectionState !== 'connected') {
            pingDisplay.textContent = '(Offline)';
            statusDot.style.backgroundColor = '#666';

            return;
        }

        try {
            const stats = await peerConnection.getStats();
            let rtt = null;


            stats.forEach(report => {
                if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                    rtt = report.currentRoundTripTime;
                }
});


            if (rtt !== null) {
                const pingMs = Math.round(rtt * 1000);
                pingDisplay.textContent = `(${pingMs}ms)`;

if (pingMs < 100) {
                    statusDot.style.backgroundColor = '#46d369'; // Green
                } else if (pingMs < 200) {
                    statusDot.style.backgroundColor = '#ffc107'; // Yellow
                } else {
                    statusDot.style.backgroundColor = '#e50914'; // Red
                }
            }

        } catch (err) {
            console.warn('Stats error:', err);
        }
    }, 2000);

});
