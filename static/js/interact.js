// LiveKit Voice Agent Integration
document.addEventListener('DOMContentLoaded', function() {
    // Import LiveKit components from the bundled package
    // These will be available through the bundled import when using webpack
    
    // DOM Elements
    const connectButton = document.getElementById('connect-button');
    // Disconnect button is commented out in HTML, but we'll keep a reference for future use
    // const disconnectButton = document.getElementById('disconnect-button');
    const micButton = document.getElementById('mic-button');
    const sendButton = document.getElementById('send-button');
    const textInput = document.getElementById('text-input');
    const chatContainer = document.getElementById('chat-container');
    const statusIndicator = document.getElementById('status-indicator');
    const connectionStatus = document.getElementById('connection-status');
    const micStatus = document.getElementById('mic-status');

    // State variables
    let room = null;
    let isConnected = false;
    let isRecording = false;

    // Connect to LiveKit
    connectButton.addEventListener('click', async () => {
        updateStatus('connecting');
        
        try {
            // Get the token from the server
            const response = await fetch('/api/token');
            const data = await response.json();
            
            if (!data.success) {
                throw new Error(data.error || 'Failed to get token');
            }
            
            console.log('Received token:', data);
            
            // Connect to the LiveKit room
            connectToRoom(data.token, data.livekit_url);
        } catch (error) {
            console.error('Connection error:', error);
            updateStatus('disconnected');
            addMessage('System', 'Failed to connect: ' + error.message, 'agent');
        }
    });

    // Disconnect functionality is still available through code, but button is hidden
    // We'll keep this code for future reference
    /*
    disconnectButton.addEventListener('click', () => {
        disconnectFromRoom();
    });
    */
    
    // Auto-connect when the page loads
    document.addEventListener('DOMContentLoaded', async () => {
        // Wait a moment before connecting to ensure everything is loaded
        setTimeout(() => {
            if (!isConnected) {
                connectButton.click();
            }
        }, 1000);
    });

    // Toggle microphone
    micButton.addEventListener('click', async () => {
        if (!isConnected) {
            // If not connected, try to connect first
            connectButton.click();
            // Wait for connection before activating microphone
            const checkConnection = setInterval(() => {
                if (isConnected) {
                    clearInterval(checkConnection);
                    startRecording();
                }
            }, 500);
            return;
        }
        
        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    });

    // Send text message
    sendButton.addEventListener('click', () => {
        sendTextMessage();
    });

    // Also allow Enter key to send message
    textInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendTextMessage();
        }
    });

    // Connect to LiveKit room
    async function connectToRoom(token, livekitUrl) {
        try {
            console.log('Connecting to LiveKit room:', livekitUrl);
            
            // Access LiveKit classes from the global variable
            // This will be defined by the bundled script imported in interact.html
            const { Room, RoomEvent } = window.LivekitClient;
            
            // Create a new LiveKit room
            room = new Room({
                // optimize publishing bandwidth and CPU for published tracks
                dynacast: true,
                // automatically manage subscribed video quality
                adaptiveStream: true
            });
            
            // Set up event listeners before connecting
            setupRoomEventListeners(RoomEvent);
            
            // Pre-warm connection to speed up the actual connection
            console.log('Preparing connection...');
            await room.prepareConnection(livekitUrl, token);
            
            // Connect to the room
            console.log('Connecting to room...');
            await room.connect(livekitUrl, token);
            
            // Successfully connected
            console.log('Connected to room successfully');
            
            // Set up text stream handlers after connecting (now that we have a local participant)
            setupTextStreamHandlers();
            
            updateStatus('connected');
            enableDisconnect(true);
            isConnected = true;
            
            addMessage('System', 'Connected successfully! You can now interact with the voice agent.', 'agent');
        } catch (error) {
            console.error('Failed to connect to LiveKit room:', error);
            updateStatus('disconnected');
            addMessage('System', 'Connection failed: ' + error.message, 'agent');
        }
    }
    
    // Set up text stream handlers for receiving messages
    function setupTextStreamHandlers() {
        if (!room) return;
        
        console.log('Setting up text stream handlers');
        
        try {
            // Register handler for transcriptions and agent messages
            room.registerTextStreamHandler('lk.transcription', async (reader, participantInfo) => {
                console.log(`Received text stream from ${participantInfo.identity} on lk.transcription topic`);
                
                try {
                    // Read all content from the stream
                    const message = await reader.readAll();
                    console.log('Transcription content:', message);
                    
                    // If it's not a transcription of audio (doesn't have transcribed_track_id), treat as a message
                    if (!reader.info.attributes || !reader.info.attributes['lk.transcribed_track_id']) {
                        addMessage('Agent', message, 'agent');
                    }
                } catch (error) {
                    console.error('Error reading transcription stream:', error);
                }
            });
            
            console.log('Text stream handlers set up successfully');
        } catch (error) {
            console.error('Error setting up text stream handlers:', error);
        }
    }

    // Set up event listeners for the LiveKit room
    function setupRoomEventListeners(RoomEvent) {
        if (!room) return;
        
        console.log('Setting up room event listeners');
        
        // When data is received (text messages from participants)
        room.on(RoomEvent.DataReceived, (payload, participant) => {
            console.log('Data received from', participant?.identity);
            // Handle incoming messages (typically from the agent)
            try {
                const decodedData = new TextDecoder().decode(payload);
                const data = JSON.parse(decodedData);
                
                if (data.type === 'message') {
                    addMessage('Agent', data.text, 'agent');
                }
            } catch (error) {
                console.error('Error processing received data:', error);
            }
        });
        
        // When participants join/leave
        room.on(RoomEvent.ParticipantConnected, (participant) => {
            console.log('Participant connected:', participant.identity);
            addMessage('System', `${participant.identity} joined the room`, 'agent');
        });
        
        room.on(RoomEvent.ParticipantDisconnected, (participant) => {
            console.log('Participant disconnected:', participant.identity);
            addMessage('System', `${participant.identity} left the room`, 'agent');
        });
        
        // When tracks (audio/video) are subscribed to
        room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
            console.log('Track subscribed:', track.kind, 'from', participant.identity);
            
            // If we receive an audio track, attach it to an audio element
            if (track.kind === 'audio') {
                const audioElement = track.attach();
                document.body.appendChild(audioElement);
                audioElement.style.display = 'none'; // Hide but keep audio playing
                
                addMessage('System', `Receiving audio from ${participant.identity}`, 'agent');
            }
        });
        
        // Deprecated but still useful for debugging
        room.on(RoomEvent.TranscriptionReceived, (segments) => {
            console.log('TranscriptionReceived event:', segments);
            for (const segment of segments) {
                console.log(`Transcription from ${segment.senderIdentity}: ${segment.text}`);
            }
        });
        
        // When active speakers change
        room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
            console.log('Active speakers:', speakers.map(s => s.identity));
        });
        
        // Handle disconnection
        room.on(RoomEvent.Disconnected, () => {
            console.log('Disconnected from room');
            updateStatus('disconnected');
            enableDisconnect(false);
            isConnected = false;
            addMessage('System', 'Disconnected from the voice agent.', 'agent');
        });
        
        // Log connection state changes for debugging
        room.on(RoomEvent.ConnectionStateChanged, (state) => {
            console.log('Connection state changed:', state);
        });
    }

    // Disconnect from the room
    async function disconnectFromRoom() {
        if (room) {
            if (isRecording) {
                stopRecording();
            }
            
            await room.disconnect();
            room = null;
            isConnected = false;
            updateStatus('disconnected');
            enableDisconnect(false);
        }
    }

    // Start recording from the microphone
    async function startRecording() {
        if (!room || !isConnected) return;
        
        try {
            console.log('Enabling microphone...');
            // Enable microphone using the LiveKit helper method
            await room.localParticipant.setMicrophoneEnabled(true);
            
            // Update UI
            micButton.classList.add('active');
            micButton.innerHTML = '<i class="fas fa-microphone-slash"></i>';
            micStatus.textContent = 'Listening...';
            isRecording = true;
            
            addMessage('System', 'Microphone activated. Speak now...', 'agent');
        } catch (error) {
            console.error('Error accessing microphone:', error);
            addMessage('System', 'Failed to access microphone: ' + error.message, 'agent');
        }
    }

    // Stop recording
    async function stopRecording() {
        if (isRecording && room) {
            console.log('Disabling microphone...');
            // Disable microphone
            await room.localParticipant.setMicrophoneEnabled(false);
            
            // Update UI
            micButton.classList.remove('active');
            micButton.innerHTML = '<i class="fas fa-microphone"></i>';
            micStatus.textContent = 'Click to speak';
            isRecording = false;
            
            addMessage('System', 'Microphone deactivated.', 'agent');
        }
    }

    // Send a text message
    async function sendTextMessage() {
        const text = textInput.value.trim();
        if (!text) return;
        
        if (!isConnected) {
            addMessage('System', 'Please connect first before sending messages.', 'agent');
            return;
        }
        
        // Add the message to the chat
        addMessage('You', text, 'user');
        
        // Send the message to the room using the text stream API
        if (room && room.localParticipant) {
            try {
                console.log('Sending text message:', text);
                
                // First, try using the sendText method with lk.chat topic
                const info = await room.localParticipant.sendText(text, {
                    topic: 'lk.chat',
                });
                
                console.log('Text message sent successfully with sendText:', info);
            } catch (error) {
                console.error('Error sending text with sendText:', error);
                
                // Fallback to publishData method if sendText is not available
                try {
                    const data = {
                        type: 'message',
                        text: text
                    };
                    
                    const encodedData = new TextEncoder().encode(JSON.stringify(data));
                    room.localParticipant.publishData(encodedData, { reliable: true });
                    console.log('Text message sent successfully with publishData');
                } catch (fallbackError) {
                    console.error('Error sending text with publishData fallback:', fallbackError);
                    addMessage('System', 'Failed to send message. Please try again.', 'agent');
                }
            }
        }
        
        // Clear the input
        textInput.value = '';
    }

    // Add a message to the chat container
    function addMessage(sender, text, type) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}-message`;
        messageDiv.innerHTML = `
            <strong>${sender}:</strong>
            <p>${text}</p>
            <small>${new Date().toLocaleTimeString()}</small>
        `;
        
        chatContainer.appendChild(messageDiv);
        
        // Scroll to the bottom
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    // Update the connection status indicator
    function updateStatus(status) {
        statusIndicator.className = 'status-indicator';
        statusIndicator.classList.add('status-' + status);
        
        switch (status) {
            case 'disconnected':
                connectionStatus.textContent = 'Disconnected';
                micButton.classList.remove('connected');
                micStatus.textContent = 'Connect to start';
                break;
            case 'connecting':
                connectionStatus.textContent = 'Connecting...';
                micStatus.textContent = 'Connecting...';
                break;
            case 'connected':
                connectionStatus.textContent = 'Connected';
                micButton.classList.add('connected');
                micStatus.textContent = 'Click to speak';
                break;
        }
    }

    // Enable/disable the connect button (disconnect button is hidden)
    function enableDisconnect(enable) {
        connectButton.disabled = enable;
        // disconnectButton.disabled = !enable;
    }

    // Send a heartbeat every minute to keep the session alive
    setInterval(async () => {
        if (isConnected) {
            try {
                await fetch('/api/heartbeat', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });
            } catch (error) {
                console.error('Heartbeat error:', error);
            }
        }
    }, 60000);

    // Initialize with disconnected status
    updateStatus('disconnected');
});