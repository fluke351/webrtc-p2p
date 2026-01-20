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

    // Global Error Handler for debugging on mobile/other devices
    window.onerror = function (message, source, lineno, colno, error) {
        showToast(`Error: ${message}`, 'error');
        console.error('Global Error:', error);
        return false;
    };

    joinBtn.addEventListener('click', async () => {
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
            } else {
                // Should theoretically not happen as startLocalStream returns true
                showToast('Failed to initialize. Please try again.', 'error');
                joinBtn.disabled = false;
                joinBtn.innerHTML = originalText;
            }
        } catch (err) {
            console.error('Join error:', err);
            showToast('Error joining room: ' + err.message, 'error');
            joinBtn.disabled = false;
            joinBtn.innerHTML = originalText;
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
        remoteVideoWrapper.classList.add('camera-off'); // Default to audio-only visual until video track arrives
        createPeerConnection();

        if (localStream) {
            localStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, localStream);
            });
        }

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
                const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
                if (sender) {
                    await sender.replaceTrack(screenTrack);
                } else {
                    // No video sender (audio only mode), so add track
                    peerConnection.addTrack(screenTrack, localStream || screenStream);

                    // Renegotiate
                    const offer = await peerConnection.createOffer();
                    await peerConnection.setLocalDescription(offer);
                    socket.emit('offer', { type: 'offer', sdp: offer, roomId: roomId });
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
            // If we added a track, we might want to remove it or replace it with null/black
            // But removing track is tricky in WebRTC.
            // Easiest is to just stop the track.
            const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender) {
                // We can't easily "remove" the sender without renegotiation that might remove the m-line.
                // Replacing with null stops sending.
                sender.replaceTrack(null);
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
