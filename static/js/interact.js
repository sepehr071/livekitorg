// LiveKit Voice Agent Integration
document.addEventListener('DOMContentLoaded', function() {
    // Add CSS for fade-out animations
    const style = document.createElement('style');
    style.textContent = `
        .fade-out {
            opacity: 0;
            transition: opacity 0.3s ease-out;
            pointer-events: none;
        }
    `;
    document.head.appendChild(style);
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
    const langBtn = document.getElementById('lang-btn');
    const langDropdown = document.getElementById('lang-dropdown');
    const currentLangIndicator = document.querySelector('.current-lang');

    // State variables
    let room = null;
    let isConnected = false;
    let isRecording = false;
    let currentLanguage = 'en'; // Default language
    let lastUserInput = ''; // Store the last user input

    // Connect button handler - only used internally now
    connectButton.addEventListener('click', async () => {
        // This function is now just a fallback and shouldn't be directly used
        console.log('Warning: Connect button should not be directly clicked. Use mic button instead.');
    });

    // Disconnect functionality is still available through code, but button is hidden
    // We'll keep this code for future reference
    /*
    disconnectButton.addEventListener('click', () => {
        disconnectFromRoom();
    });
    */
    
    // Remove auto-connect behavior - user must click mic button to connect

    // Toggle microphone - also handles connection if not connected
    micButton.addEventListener('click', async () => {
        if (!isConnected) {
            // Show connecting status
            micStatus.textContent = 'Connecting...';
            updateStatus('connecting');
            
            // Connect first, then enable mic
            try {
                // Get the token from the server with language parameter
                const response = await fetch(`/api/token?lang=${currentLanguage}`);
                const data = await response.json();
                
                if (!data.success) {
                    throw new Error(data.error || 'Failed to get token');
                }
                
                console.log('Received token:', data);
                
                // Connect to the LiveKit room
                await connectToRoom(data.token, data.livekit_url);
                
                // Now start recording after successful connection
                startRecording();
            } catch (error) {
                console.error('Connection error:', error);
                updateStatus('disconnected');
                showFlashMessage('Failed to connect: ' + error.message, 'error');
                micStatus.textContent = 'Click to connect';
            }
            return;
        }
        
        // If already connected, just toggle the mic
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
    
    // Toggle language dropdown on click
    langBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        langDropdown.classList.toggle('show');
    });
    
    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!langBtn.contains(e.target) && !langDropdown.contains(e.target)) {
            langDropdown.classList.remove('show');
        }
    });

    // Language dropdown functionality
    document.querySelectorAll('#lang-dropdown a').forEach(link => {
        link.addEventListener('click', async (e) => {
            e.preventDefault();
            const newLang = e.target.getAttribute('data-lang');
            
            // Close the dropdown
            langDropdown.classList.remove('show');
            
            if (newLang === currentLanguage) return;
            
            console.log(`Changing language from ${currentLanguage} to ${newLang}`);
            currentLanguage = newLang;
            
            // Update the language indicator
            currentLangIndicator.textContent = newLang.toUpperCase();
            
            // Show a brief flash notification about language change
            showFlashMessage(`Language changed to ${getLangName(newLang)}`, 'info');
            
            // If connected, send language change instruction silently
            if (isConnected && room && room.localParticipant) {
                // Create language instruction message
                const langInstruction = `From now on only respond in ${getLangName(newLang)} language`;
                
                try {
                    console.log('Sending language instruction silently:', langInstruction);
                    
                    // Send the text using sendText method without showing in UI
                    const info = await room.localParticipant.sendText(langInstruction, {
                        topic: 'lk.chat',
                    });
                    
                    console.log('Language instruction sent successfully:', info);
                } catch (error) {
                    console.error('Error sending language instruction:', error);
                    
                    // Fallback to publishData method if sendText is not available
                    try {
                        const data = {
                            type: 'message',
                            text: langInstruction
                        };
                        
                        const encodedData = new TextEncoder().encode(JSON.stringify(data));
                        room.localParticipant.publishData(encodedData, { reliable: true });
                        console.log('Language instruction sent successfully with publishData');
                    } catch (fallbackError) {
                        console.error('Error sending language instruction with publishData:', fallbackError);
                        showFlashMessage('Failed to change language. Please try again.', 'error');
                    }
                }
            }
        });
    });
    
    // Helper function to show flash messages - simplified to just log to console
    function showFlashMessage(message, type = 'info') {
        console.log(`[${type}] ${message}`);
        // No visual flash messages as per user request
    }
    
    // Helper function to get language name
    function getLangName(langCode) {
        const langNames = {
            'en': 'English',
            'fa': 'فارسی',
            'ar': 'العربية',
            'fr': 'Français'
        };
        return langNames[langCode] || langCode;
    }

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
            
            // Set up data message handler separately
            setupDataMessageHandler(RoomEvent);
            
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
            
            showFlashMessage('Connected successfully! You can now interact with the voice agent.', 'success');
        } catch (error) {
            console.error('Failed to connect to LiveKit room:', error);
            updateStatus('disconnected');
            showFlashMessage('Connection failed: ' + error.message, 'error');
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
                    console.log('TEXT STREAM RECEIVED:', message);
                    
                    // Check if this is a transcription of audio from agent
                    const isTranscribedSpeech = reader.info.attributes && reader.info.attributes['lk.transcribed_track_id'];
                    const isAgentIdentity = participantInfo.identity && participantInfo.identity.startsWith('agent');
                    
                    if (isTranscribedSpeech) {
                        if (isAgentIdentity) {
                            // Agent speaking - use displayAgentMessage
                            displayAgentMessage(message, true);
                        } else {
                            // User speaking - use displayUserTranscription
                            // Extract final status
                            const isFinal = reader.info.attributes &&
                                reader.info.attributes['lk.transcription_final'] === 'true';
                            
                            displayUserTranscription(message, null, isFinal);
                        }
                    } else {
                        // DIRECT MESSAGE: Non-transcription message (rare, but handle it)
                        if (isAgentIdentity) {
                            // If from agent, put in agent area
                            console.log("Processing DIRECT AGENT MESSAGE (non-transcription):", message);
                            displayAgentMessage(message, false);
                        } else {
                            // If from user or system, handle as system message
                            console.log("Processing OTHER MESSAGE:", message);
                            showFlashMessage(message, 'info');
                        }
                    }
                } catch (error) {
                    console.error('Error reading transcription stream:', error);
                }
            });
            
            // Register handler for chat messages (important for agent responses)
            room.registerTextStreamHandler('lk.chat', async (reader, participantInfo) => {
                console.log(`Received text stream from ${participantInfo.identity} on lk.chat topic`);
                
                try {
                    const message = await reader.readAll();
                    console.log('Chat message content:', message);
                    
                    // Only process messages from the agent, and ignore system commands
                    if (!participantInfo.identity || !participantInfo.identity.startsWith('agent')) return;
                    
                    // Skip language instruction messages (they start with "From now on only respond in")
                    if (message.startsWith("From now on only respond in")) {
                        console.log("Skipping language instruction message in display:", message);
                        return;
                    }
                    
                    // Display agent message directly in the AGENT area
                    console.log("Showing agent response in UI from CHAT:", message);
                    
                    // Show notification that we received a message
                    showFlashMessage('Received response from Caila', 'info');
                    
                    // Use displayAgentMessage to ensure correct placement in agent area
                    displayAgentMessage(message, false);
                    
                    // Also add to chat log for completeness (invisible but functional)
                    const messageDiv = document.createElement('div');
                    messageDiv.className = 'message agent-message';
                    messageDiv.innerHTML = `
                        <strong>Caila:</strong>
                        <p>${message}</p>
                        <small>${new Date().toLocaleTimeString()}</small>
                    `;
                    chatContainer.appendChild(messageDiv);
                } catch (error) {
                    console.error('Error reading chat stream:', error);
                }
            });
            
            console.log('Text stream handlers set up successfully');
        } catch (error) {
            console.error('Error setting up text stream handlers:', error);
        }
    }
    
    // Set up dedicated data message handler for agent responses as a fallback
    function setupDataMessageHandler(RoomEvent) {
        if (!room) return;
        
        // Register handler for direct data messages as fallback
        room.on(RoomEvent.DataReceived, (payload, participant) => {
            if (!participant || !participant.identity || !participant.identity.startsWith('agent')) return;
            
            try {
                const decodedData = new TextDecoder().decode(payload);
                const data = JSON.parse(decodedData);
                
                if (data.type === 'message') {
                    // Skip language instruction messages
                    if (data.text && data.text.startsWith("From now on only respond in")) {
                        console.log("Skipping language instruction data message:", data.text);
                        return;
                    }
                    
                    console.log("Showing agent response from data:", data.text);
                    // Display directly in agent area
                    displayAgentMessage(data.text, false);
                    
                    // Also add to chat log for history (invisible but functional)
                    const messageDiv = document.createElement('div');
                    messageDiv.className = 'message agent-message';
                    messageDiv.innerHTML = `
                        <strong>Caila:</strong>
                        <p>${data.text}</p>
                        <small>${new Date().toLocaleTimeString()}</small>
                    `;
                    chatContainer.appendChild(messageDiv);
                }
            } catch (error) {
                console.error('Error processing received data:', error);
            }
        });
        
        console.log('Data message handler set up successfully');
    }
    
    // Global maps to track messages by content (primary deduplication mechanism)
    const userMessagesByContent = new Map();  // Maps normalized content -> DOM element
    const agentMessagesByContent = new Map(); // Maps normalized content -> DOM element
    
    // Store partial fragments to track conversation context
    let lastSpeakerId = null;
    let partialMessageFragments = [];
    let lastClassification = null; // 'agent' or 'user'
    
    // Function to clean up misclassified messages
    function cleanupMisclassifiedMessages(agentText, removeOnly = false) {
        // Find user messages that contain beginning parts of this agent message
        const agentTextLower = agentText.toLowerCase().trim();
        const messagesToRemove = [];
        
        // LESS AGGRESSIVE DETECTION: Only remove messages that are very clearly part of the agent message
        userMessagesByContent.forEach((element, contentKey) => {
            // Only if this user message is EXACTLY the start of the agent message
            // AND it's a substantial part (more than 15 characters)
            if (agentTextLower.startsWith(contentKey) && contentKey.length > 15) {
                console.log(`Found misclassified user message: "${contentKey.substring(0, 30)}..."`);
                messagesToRemove.push({element, contentKey});
            }
        });
        
        // Remove the misclassified messages
        messagesToRemove.forEach(({element, contentKey}) => {
            // Remove the element from DOM
            if (element && element.isConnected) {
                console.log(`Removing misclassified user message element`);
                element.classList.add('fade-out');
                setTimeout(() => {
                    if (element.isConnected) {
                        element.remove();
                    }
                }, 500);
            }
            
            // Remove from tracking map
            userMessagesByContent.delete(contentKey);
        });
        
        return messagesToRemove.length > 0;
    }
    
    // Function to clean up all short user messages - less aggressive now
    // This is useful when we detect a speaker change to agent
    function cleanupAllShortUserMessages() {
        const messagesToRemove = [];
        
        // Check for short messages that might be misclassified
        userMessagesByContent.forEach((element, contentKey) => {
            // Only remove very short messages under 5 chars that are likely fragments
            if (contentKey.length < 5) {
                console.log(`Found potentially misclassified short message: "${contentKey}"`);
                messagesToRemove.push({element, contentKey});
            }
        });
        
        // Remove them all
        if (messagesToRemove.length > 0) {
            console.log(`Cleaning up ${messagesToRemove.length} potentially misclassified user messages`);
            
            messagesToRemove.forEach(({element, contentKey}) => {
                // Remove the element from DOM with animation
                if (element && element.isConnected) {
                    element.classList.add('fade-out');
                    setTimeout(() => {
                        if (element.isConnected) {
                            element.remove();
                        }
                    }, 300);
                }
                
                // Remove from tracking map
                userMessagesByContent.delete(contentKey);
            });
        }
        
        return messagesToRemove.length > 0;
    }
    
    // Remove duplicate function (already defined above)
    
    // IMPROVED: Display user transcriptions in the user text display
    function displayUserTranscription(text, segmentId = null, isFinal = false) {
        // Safety check
        if (!text || text.trim() === '') return;
        
        // More comprehensive check for agent messages
        const lowerText = text.toLowerCase();
        const agentPhrases = [
            "i'm ana", "sales professional", "assist you", "help you",
            "i can help", "i'd be happy", "please let me know",
            "is there anything", "would you like", "can i assist"
        ];
        
        // Check if this contains any agent phrases and is longer than a typical user message
        if (agentPhrases.some(phrase => lowerText.includes(phrase)) && lowerText.length > 25) {
            console.log(`Skipping likely agent message incorrectly classified as user: "${text}"`);
            return;
        }
        
        console.log(`USER MESSAGE: "${text}" (final=${isFinal})`);
        
        // Store the normalized content for deduplication
        const normalizedContent = lowerText.trim();
        
        // Add to user message tracking map
        userMessagesByContent.set(normalizedContent, null); // We don't need to track the element
        
        // Update the user text display
        const userTextDisplay = document.getElementById('user-text-display');
        if (userTextDisplay) {
            userTextDisplay.textContent = text;
            
            // Store reference to this element
            userMessagesByContent.set(normalizedContent, userTextDisplay);
            
            // Save this as the last user input (only if it's a final transcription or substantial)
            if (isFinal || text.length > 15) {
                lastUserInput = text;
                console.log(`Saved last user input: "${lastUserInput}"`);
            }
        }
        
        // Also add to chat history container (hidden but functional)
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message user-message transcription';
        messageDiv.innerHTML = `
            <strong>You (transcribed):</strong>
            <p>${text}</p>
            <small>${new Date().toLocaleTimeString()}</small>
        `;
        
        chatContainer.appendChild(messageDiv);
    }

    // Set up event listeners for the LiveKit room
    function setupRoomEventListeners(RoomEvent) {
        if (!room) return;
        
        console.log('Setting up room event listeners');
        
        // NOTE: We've removed the DataReceived handler from here as it's now handled in setupDataMessageHandler
        // This prevents duplicate message handling
        
        // When participants join/leave
        room.on(RoomEvent.ParticipantConnected, (participant) => {
            console.log('Participant connected:', participant.identity);
            // Don't add messages for participants joining - reduce UI clutter
        });
        
        room.on(RoomEvent.ParticipantDisconnected, (participant) => {
            console.log('Participant disconnected:', participant.identity);
            // Don't add messages for participants leaving - reduce UI clutter
        });
        
        // When tracks (audio/video) are subscribed to
        room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
            console.log('Track subscribed:', track.kind, 'from', participant.identity);
            
            // If we receive an audio track, attach it to an audio element
            if (track.kind === 'audio') {
                const audioElement = track.attach();
                document.body.appendChild(audioElement);
                audioElement.style.display = 'none'; // Hide but keep audio playing
                
                // Only show message when agent audio is received (reduces clutter)
                if (participant.identity && participant.identity.startsWith('agent')) {
                    showFlashMessage('Connected to Caila', 'info');
                }
            }
        });
        
        // Process transcriptions to ensure agent responses appear in agent area
        room.on(RoomEvent.TranscriptionReceived, (segments) => {
            for (const segment of segments) {
                // Skip empty transcriptions
                if (!segment.text || segment.text.trim() === '') continue;
                
                // Add detailed diagnostic information
                console.log(`TRANSCRIPTION EVENT DETAILS:`, {
                    text: segment.text,
                    final: segment.final,
                    senderIdentity: segment.senderIdentity,
                    participantId: segment.participantId,
                    language: segment.language,
                    // Include any other properties that exist
                    rawSegment: segment
                });
                
                // IMPROVED CLASSIFICATION: Prioritize identity-based classification
                // This is the most reliable method
                const isIdentityAgent = segment.senderIdentity &&
                                       segment.senderIdentity.startsWith('agent');
                
                // Only use content-based classification as a fallback
                let isAgent = isIdentityAgent;
                
                // If we couldn't determine from identity, use content analysis
                if (!isIdentityAgent && segment.text.length > 10) {
                    // Track current speaker ID for conversation context
                    const currentSpeakerId = segment.participantId || segment.senderIdentity || 'unknown';
                    
                    // If this is a new speaker or we don't have context yet
                    if (currentSpeakerId !== lastSpeakerId) {
                        // Reset context for new speaker
                        partialMessageFragments = [];
                        lastSpeakerId = currentSpeakerId;
                    }
                    
                    // Add this fragment to our contextual history
                    partialMessageFragments.push(segment.text);
                    
                    // Combine all fragments for more accurate classification
                    const fullContext = partialMessageFragments.join(" ");
                    const textContent = fullContext.toLowerCase();
                    
                    // ENHANCED AGENT DETECTION - More comprehensive patterns
                    const agentPhrases = [
                        "i'm ana", "sales professional", "help you find", "barcode scanner",
                        "handheld computer", "ruggedized", "optimize your", "workflow",
                        "data capture", "operations", "pain point", "ready to help",
                        "what's the main", "assist", "support", "i can help",
                        "i'd be happy", "please let me know", "is there anything",
                        "would you like", "can i assist"
                    ];
                    
                    // Check if this contains multiple agent phrases or is a longer message
                    const matchCount = agentPhrases.filter(phrase => textContent.includes(phrase)).length;
                    const isContentFromAgent = (matchCount >= 1 && textContent.length > 30) ||
                                              (matchCount >= 2);
                    
                    // Look at active speakers to help with classification
                    const isActiveSpeakerAgent = room.activeSpeakers.some(
                        speaker => speaker.identity && speaker.identity.startsWith('agent')
                    );
                    
                    // Combined check - use any method that works
                    isAgent = isContentFromAgent || (isActiveSpeakerAgent && segment.text.length > 20);
                }
                
                console.log(`Message classification: isIdentityAgent=${isIdentityAgent}, final decision: isAgent=${isAgent}`);
                
                // Store classification for this conversation turn
                if (lastClassification !== (isAgent ? 'agent' : 'user')) {
                    lastClassification = isAgent ? 'agent' : 'user';
                    console.log(`Classification changed to: ${lastClassification}`);
                }
                
                // IMPROVED HANDLING: Clear separation between agent and user messages
                if (isAgent) {
                    // For agent messages - only display final transcriptions
                    if (segment.final) {
                        console.log("Displaying AGENT message from transcription");
                        displayAgentMessage(segment.text, true);
                    } else {
                        console.log("Skipping non-final agent transcription");
                    }
                } else {
                    // For user messages - display all transcriptions
                    console.log("Displaying USER message from transcription");
                    displayUserTranscription(segment.text, null, segment.final === true);
                }
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
            showFlashMessage('Disconnected from the voice agent.', 'warning');
        });
        
        // Log connection state changes for debugging
        room.on(RoomEvent.ConnectionStateChanged, (state) => {
            console.log('Connection state changed:', state);
        });
    }

    // Disconnect from the room
    async function disconnectFromRoom() {
        if (room) {
            try {
                if (isRecording) {
                    await stopRecording();
                }
                
                await room.disconnect();
                console.log('Disconnected from room successfully');
                showFlashMessage('Disconnected from voice agent', 'info');
            } catch (error) {
                console.error('Error during disconnect:', error);
            } finally {
                // Always ensure we reset the state even if there were errors
                room = null;
                isConnected = false;
                updateStatus('disconnected');
                enableDisconnect(false);
            }
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
            
            // Show the active icon and hide others
            document.getElementById('mic-icon-connect').style.display = 'none';
            document.getElementById('mic-icon-mute').style.display = 'none';
            document.getElementById('mic-icon-active').style.display = 'inline-block';
            
            micStatus.textContent = 'Listening';
            isRecording = true;
            
            showFlashMessage('Microphone activated. Speak now...', 'info');
        } catch (error) {
            console.error('Error accessing microphone:', error);
            showFlashMessage('Failed to access microphone: ' + error.message, 'error');
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
            
            // Show the mute icon and hide others
            document.getElementById('mic-icon-connect').style.display = 'none';
            document.getElementById('mic-icon-mute').style.display = 'inline-block';
            document.getElementById('mic-icon-active').style.display = 'none';
            
            micStatus.textContent = 'Speak';
            isRecording = false;
            
            showFlashMessage('Microphone deactivated.', 'info');
        }
    }

    // Send a text message
    async function sendTextMessage() {
        const text = textInput.value.trim();
        if (!text) return;
        
        if (!isConnected) {
            showFlashMessage('Please connect first before sending messages.', 'warning');
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
                    showFlashMessage('Failed to send message. Please try again.', 'error');
                }
            }
        }
        
        // Clear the input
        textInput.value = '';
    }

    // Add a message to the chat container
    function addMessage(sender, text, type) {
        // Create the original message div for compatibility
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}-message`;
        messageDiv.innerHTML = `
            <strong>${sender}:</strong>
            <p>${text}</p>
            <small>${new Date().toLocaleTimeString()}</small>
        `;
        
        chatContainer.appendChild(messageDiv);
        
        // Handle the enhanced UI elements based on message type
        if (type === 'user') {
            // User messages go to the user section at bottom
            displayUserMessage(text);
        } else if (type === 'agent' || type === 'agent-transcription') {
            // Agent messages go to the agent section at top
            displayAgentMessage(text, type === 'agent-transcription');
        } else if (type === 'system') {
            // System messages show as flash notifications
            showFlashMessage(text, 'info');
        }
    }
    
    // Add a message to the conversation container
    function addMessageToConversation(text, isAgent, isStreaming = false) {
        // Don't add empty messages
        if (!text || text.trim() === '') return;
        
        if (isAgent) {
            // Handle AI message
            const conversationContainer = document.getElementById('conversation-container');
            if (!conversationContainer) return;
            
            // Check if we already have a streaming message that we should update
            if (isStreaming) {
                const existingStream = conversationContainer.querySelector('.ai-message.streaming');
                if (existingStream) {
                    const contentElement = existingStream.querySelector('.ai-message-content');
                    if (contentElement) {
                        contentElement.innerText = text;
                        return existingStream;
                    }
                }
            }
            
            // Clear previous messages - we only show the latest AI response
            conversationContainer.innerHTML = '';
            
            // Create a new AI message
            const aiMessage = document.createElement('div');
            aiMessage.className = 'ai-message';
            
            if (isStreaming) {
                aiMessage.classList.add('streaming');
            }
            
            // Add the message content
            aiMessage.innerHTML = `<div class="ai-message-content">${text}</div>`;
            
            conversationContainer.appendChild(aiMessage);
            
            // Scroll to the bottom
            conversationContainer.scrollTop = conversationContainer.scrollHeight;
            
            return aiMessage;
        } else {
            // Handle user message - just update the user text display
            const userTextDisplay = document.getElementById('user-text-display');
            if (userTextDisplay) {
                userTextDisplay.textContent = text;
            }
            
            return null; // No element to return for user messages
        }
    }
    
    // Display user message in the user text display
    function displayUserMessage(text) {
        if (!text || text.trim() === '') return;
        console.log('Displaying user message:', text);
        
        // Store the normalized content for deduplication
        const normalizedContent = text.toLowerCase().trim();
        
        // Add to user message tracking map
        userMessagesByContent.set(normalizedContent, null);
        
        // Update the user text display
        const userTextDisplay = document.getElementById('user-text-display');
        if (userTextDisplay) {
            userTextDisplay.textContent = text;
            
            // Store reference to this element
            userMessagesByContent.set(normalizedContent, userTextDisplay);
            
            // Save this as the last user input
            lastUserInput = text;
            console.log(`Saved last user input: "${lastUserInput}"`);
        }
        
        // Also add to conversation for compatibility
        addMessageToConversation(text, false);
    }
    
    // Variables to track streaming state
    let currentStreamingMessage = null;
    let streamInterval = null;
    let streamingText = '';
    let streamingIndex = 0;
    
    // Display agent message without streaming effect
    function displayAgentMessage(text, isTranscription) {
        // Add source tracking for debugging
        const callStack = new Error().stack;
        const source = callStack.split('\n')[2].trim();
        
        // Safety check
        if (!text || text.trim() === '') return;
        
        console.log(`AGENT MESSAGE [${source}]: "${text}" (isTranscription=${isTranscription})`);
        
        try {
            // Restore the last user input if the user text display is empty or has been cleared
            const userTextDisplay = document.getElementById('user-text-display');
            if (userTextDisplay &&
                (userTextDisplay.textContent.trim() === '' ||
                 userTextDisplay.textContent.trim().length < 5)) {
                
                // Only restore if we have a saved user input
                if (lastUserInput && lastUserInput.trim() !== '') {
                    console.log(`Restoring last user input: "${lastUserInput}"`);
                    userTextDisplay.textContent = lastUserInput;
                }
            }
            
            // Create a new agent message - we don't need deduplication since we only show the latest message
            console.log("Creating new agent message");
            const aiMessage = addMessageToConversation(text, true, false);
            
            if (!aiMessage) {
                console.error("Failed to create AI message");
                return;
            }
            
            // Store for reference
            currentStreamingMessage = aiMessage;
            
            // Display text immediately
            streamText(aiMessage, text);
            
        } catch (error) {
            console.error("Error creating agent message:", error);
            // Fallback: just display the message directly
            addMessageToConversation(text, true, false);
        }
    }
    
    // Display text immediately without animation
    function streamText(aiMessage, text) {
        if (!aiMessage || !aiMessage.isConnected) {
            console.error("AI message not available for streaming");
            return;
        }
        
        // Find the content element
        const contentElement = aiMessage.querySelector('.ai-message-content');
        if (!contentElement) {
            console.error("Content element not found in AI message");
            return;
        }
        
        // Display the full text immediately
        contentElement.textContent = text;
        
        // Remove streaming class
        aiMessage.classList.remove('streaming');
        
        // Scroll conversation to bottom
        const conversationContainer = document.getElementById('conversation-container');
        if (conversationContainer) {
            conversationContainer.scrollTop = conversationContainer.scrollHeight;
        }
    }
    
    // Removed finishStreaming function - now handled directly in streamText

    // Update the connection status indicator
    function updateStatus(status) {
        statusIndicator.className = 'status-indicator';
        statusIndicator.classList.add('status-' + status);
        
        // Get the text input container
        const textInputContainer = document.querySelector('.text-input-container');
        
        switch (status) {
            case 'disconnected':
                connectionStatus.textContent = 'Ready';
                micButton.classList.remove('connected');
                micButton.classList.remove('active');
                micStatus.textContent = 'Start';
                
                // Show connect icon and hide others
                document.getElementById('mic-icon-connect').style.display = 'inline-block';
                document.getElementById('mic-icon-mute').style.display = 'none';
                document.getElementById('mic-icon-active').style.display = 'none';
                
                // Hide text input
                if (textInputContainer) {
                    textInputContainer.classList.remove('visible');
                }
                break;
                
            case 'connecting':
                connectionStatus.textContent = 'Connecting';
                micStatus.textContent = 'Connecting';
                
                // Show connect icon and hide others
                document.getElementById('mic-icon-connect').style.display = 'inline-block';
                document.getElementById('mic-icon-mute').style.display = 'none';
                document.getElementById('mic-icon-active').style.display = 'none';
                
                // Hide text input
                if (textInputContainer) {
                    textInputContainer.classList.remove('visible');
                }
                break;
                
            case 'connected':
                connectionStatus.textContent = 'Connected';
                micButton.classList.add('connected');
                micStatus.textContent = 'Speak';
                
                // Show mute icon and hide others
                document.getElementById('mic-icon-connect').style.display = 'none';
                document.getElementById('mic-icon-mute').style.display = 'inline-block';
                document.getElementById('mic-icon-active').style.display = 'none';
                
                // Show text input with fade-in effect
                if (textInputContainer) {
                    textInputContainer.classList.add('visible');
                }
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
    
    // Initialize language indicator
    currentLangIndicator.textContent = currentLanguage.toUpperCase();
});