const socket = io({
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    randomizationFactor: 0.5
});

const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');
const joinScreen = document.getElementById('join-screen');
const videoGrid = document.getElementById('video-grid');
const joinBtn = document.getElementById('join-btn');
const roomInput = document.getElementById('room-input');
const cameraBtn = document.getElementById('camera-btn');
const micBtn = document.getElementById('mic-btn');
const screenBtn = document.getElementById('screen-btn');
const stopShareBtn = document.getElementById('stop-share-btn');
const leaveBtn = document.getElementById('leave-btn');
const copyLinkBtn = document.getElementById('copy-link-btn');
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const closeModalBtn = document.querySelector('.close-modal');
const applySettingsBtn = document.getElementById('apply-settings-btn');
const qualitySelect = document.getElementById('quality-select');
const fpsSelect = document.getElementById('fps-select');

let localStream;
let peerConnection;
let roomId;
let isScreenSharing = false;
let currentQuality = 'medium';
let currentFps = 30;

const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

const roomIdDisplay = document.getElementById('room-id-display');
const roomScreen = document.getElementById('room-screen');
const remoteVideoWrapper = document.querySelector('.video-wrapper.remote');
const localVideoWrapper = document.querySelector('.video-wrapper.local');

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
    const qualities = {
        high: { width: { ideal: 1280 }, height: { ideal: 720 } },
        medium: { width: { ideal: 640 }, height: { ideal: 480 } },
        low: { width: { ideal: 320 }, height: { ideal: 240 } }
    };

    return {
        video: {
            ...qualities[currentQuality],
            frameRate: { ideal: parseInt(currentFps) }
        },
        audio: true
    };
}

async function startLocalStream() {
    try {
        const constraints = getConstraints();
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
        }
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        localVideo.srcObject = localStream;
        return true;
    } catch (err) {
        console.error('Error accessing media devices:', err);
        showToast('Could not access camera/microphone', 'error');
        return false;
    }
}

async function replaceVideoTrack() {
    if (!peerConnection || !localStream) return;

    const videoTrack = localStream.getVideoTracks()[0];
    const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');

    if (sender) {
        try {
            await sender.replaceTrack(videoTrack);
            showToast('Video settings applied', 'success');
        } catch (err) {
            console.error('Error replacing track:', err);
            showToast('Failed to apply settings', 'error');
        }
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

joinBtn.addEventListener('click', async () => {
    roomId = roomInput.value.trim();
    if (!roomId) {
        showToast('Please enter a room ID', 'error');
        return;
    }

    const success = await startLocalStream();
    if (success) {
        joinScreen.classList.remove('active');
        joinScreen.style.display = 'none';
        roomScreen.style.display = 'flex';
        roomIdDisplay.innerText = roomId;

        // Update URL without reloading
        const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname + '?room=' + roomId;
        window.history.pushState({ path: newUrl }, '', newUrl);

        socket.emit('join-room', roomId, socket.id);
    }
});

copyLinkBtn.addEventListener('click', () => {
    const link = window.location.href;
    navigator.clipboard.writeText(link).then(() => {
        showToast('Link copied to clipboard!', 'success');
    }).catch(err => {
        showToast('Failed to copy link', 'error');
    });
});

// Settings Modal
settingsBtn.addEventListener('click', () => settingsModal.classList.add('active'));
closeModalBtn.addEventListener('click', () => settingsModal.classList.remove('active'));
settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) settingsModal.classList.remove('active');
});

applySettingsBtn.addEventListener('click', async () => {
    currentQuality = qualitySelect.value;
    currentFps = fpsSelect.value;

    if (!isScreenSharing) {
        const success = await startLocalStream();
        if (success) {
            await replaceVideoTrack();
            // Restore mute/camera state logic if needed, but for now we assume reset
            // Or better: check previous state
            // Simplified for now: just apply new stream
        }
    } else {
        showToast('Cannot change quality while screen sharing', 'error');
    }
    settingsModal.classList.remove('active');
});

// --- WebRTC Logic ---

socket.on('user-connected', async (userId) => {
    console.log('User connected:', userId);
    showToast('User connected', 'info');
    remoteVideoWrapper.classList.remove('placeholder');
    createPeerConnection();

    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('offer', { type: 'offer', sdp: offer, roomId: roomId });
    } catch (err) {
        console.error('Error creating offer:', err);
    }
});

socket.on('offer', async (payload) => {
    console.log('Received offer');
    remoteVideoWrapper.classList.remove('placeholder');
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
});

// Auto-reconnect Logic
socket.on('disconnect', () => {
    showToast('Disconnected. Attempting to reconnect...', 'error');
});

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

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('candidate', { candidate: event.candidate, roomId: roomId });
        }
    };

    peerConnection.ontrack = (event) => {
        console.log('Received remote track');
        remoteVideo.srcObject = event.streams[0];
        remoteVideoWrapper.classList.remove('placeholder');
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

cameraBtn.addEventListener('click', () => {
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;

        // Update Local UI
        if (videoTrack.enabled) {
            cameraBtn.classList.remove('inactive');
            cameraBtn.classList.add('active');
            localVideoWrapper.classList.remove('camera-off');
        } else {
            cameraBtn.classList.remove('active');
            cameraBtn.classList.add('inactive');
            localVideoWrapper.classList.add('camera-off');
        }

        // Notify remote peer
        socket.emit('media-state-change', {
            roomId,
            type: 'video',
            enabled: videoTrack.enabled
        });
    }
});

micBtn.addEventListener('click', () => {
    if (!localStream) return;
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
    }
});

screenBtn.addEventListener('click', async () => {
    // If already sharing, this button acts as "Switch Screen"
    // If not sharing, it starts sharing

    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
            showToast('Screen sharing not supported', 'error');
            return;
        }

        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = screenStream.getVideoTracks()[0];

        // Replace video track in peer connection sender
        if (peerConnection) {
            const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender) {
                sender.replaceTrack(screenTrack);
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

    } catch (err) {
        console.error('Error sharing screen:', err);
        if (err.name !== 'NotAllowedError') {
            showToast('Failed to share screen', 'error');
        }
    }
});

stopShareBtn.addEventListener('click', () => {
    stopScreenShare();
});

function stopScreenShare() {
    if (!isScreenSharing) return;

    if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (peerConnection) {
            const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender) {
                sender.replaceTrack(videoTrack);
            }
        }
        localVideo.srcObject = localStream;

        // Stop the screen share stream tracks
        if (currentScreenStream) {
            currentScreenStream.getTracks().forEach(track => track.stop());
            currentScreenStream = null;
        }
    }

    isScreenSharing = false;
    screenBtn.classList.remove('sharing');
    screenBtn.title = "Share Screen";
    stopShareBtn.style.display = 'none';
    showToast('Screen sharing stopped', 'info');
}

leaveBtn.addEventListener('click', () => {
    location.href = '/';
});
