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
    
    // Helper function to show flash messages
    function showFlashMessage(message, type = 'info') {
        // Find or create flash messages container
        let flashMessagesContainer = document.querySelector('.flash-messages');
        if (!flashMessagesContainer) {
            // Create container if it doesn't exist
            const container = document.createElement('div');
            container.className = 'flash-messages';
            document.querySelector('.interact-page').appendChild(container);
            flashMessagesContainer = container;
        }
        
        // Create the message element
        const messageDiv = document.createElement('div');
        messageDiv.className = `flash-message ${type}`;
        
        // Add content with message and close button
        messageDiv.innerHTML = `
            <span>${message}</span>
            <button type="button" class="flash-close">&times;</button>
        `;
        
        // Add click handler to close button
        const closeButton = messageDiv.querySelector('.flash-close');
        if (closeButton) {
            closeButton.addEventListener('click', () => {
                messageDiv.style.opacity = '0';
                setTimeout(() => {
                    if (messageDiv.parentNode) {
                        messageDiv.remove();
                    }
                }, 300);
            });
        }
        
        // Add to container
        flashMessagesContainer.appendChild(messageDiv);
        
        // Auto-remove after 3 seconds
        setTimeout(() => {
            if (messageDiv.parentNode) {
                messageDiv.style.opacity = '0';
                setTimeout(() => {
                    if (messageDiv.parentNode) {
                        messageDiv.remove();
                    }
                }, 300);
            }
        }, 3500);
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
        
        // IMPROVED DETECTION: Check each user message with more flexible matching
        userMessagesByContent.forEach((element, contentKey) => {
            // If this user message appears to be the start of the agent message
            // OR if the agent message starts with this user message
            if ((agentTextLower.startsWith(contentKey) && contentKey.length > 5) ||
                (contentKey.startsWith(agentTextLower.substring(0, 10)) && agentTextLower.length > 10)) {
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
    
    // Function to aggressively clean up all short user messages
    // This is useful when we detect a speaker change to agent
    function cleanupAllShortUserMessages() {
        const messagesToRemove = [];
        
        // Check for short messages that might be misclassified
        userMessagesByContent.forEach((element, contentKey) => {
            // Short messages under 15 chars are likely fragments
            if (contentKey.length < 15) {
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
    
    // Function to aggressively clean up all short user messages
    // This is useful when we detect a speaker change to agent
    function cleanupAllShortUserMessages() {
        const messagesToRemove = [];
        
        // Check for short messages that might be misclassified
        userMessagesByContent.forEach((element, contentKey) => {
            // Short messages under 15 chars are likely fragments
            if (contentKey.length < 15) {
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
    
    // SIMPLIFIED: Display user transcriptions in the conversation
    function displayUserTranscription(text, segmentId = null, isFinal = false) {
        // Safety check
        if (!text || text.trim() === '') return;
        
        // Check if this looks like it might be an agent message
        const lowerText = text.toLowerCase();
        if (lowerText.includes("i'm ana") ||
            lowerText.includes("sales professional") ||
            lowerText.includes("assist you") && lowerText.length > 30) {
            console.log(`Skipping likely agent message incorrectly classified as user: "${text}"`);
            return;
        }
        
        console.log(`USER MESSAGE: "${text}" (final=${isFinal})`);
        
        // Normalize the text for content-based deduplication
        const normalizedText = text.trim();
        const contentKey = normalizedText.toLowerCase();
        
        // First check: Do we already have this exact content or very similar content?
        const existingMessage = userMessagesByContent.get(contentKey);
        
        if (existingMessage && existingMessage.isConnected) {
            // We already have this message, just update it
            console.log('Updating existing user message with same content');
            
            // Update the content with latest version
            const contentEl = existingMessage.querySelector('.message-content');
            if (contentEl) {
                contentEl.textContent = text;
                
                // If this is a final transcription, remove the "transcribing" marker
                if (isFinal) {
                    existingMessage.classList.remove('transcribing');
                }
            }
            
            return; // Skip creating duplicates
        }
        
        // Create new message bubble
        console.log('Creating new user message bubble');
        const msgBubble = addMessageToConversation(text, false, false);
        
        if (msgBubble) {
            // Mark as transcribing if not final
            if (!isFinal) {
                msgBubble.classList.add('transcribing');
            }
            
            // Store in our content registry for future deduplication
            userMessagesByContent.set(contentKey, msgBubble);
            
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
                
                // ENHANCED AGENT DETECTION - Adding more patterns common in agent responses
                const isContentFromAgent =
                    textContent.includes("i'm ana") ||
                    textContent.includes("sales professional") ||
                    textContent.includes("help you find") ||
                    textContent.includes("barcode scanner") ||
                    textContent.includes("handheld computer") ||
                    textContent.includes("ruggedized") ||
                    textContent.includes("optimize your") ||
                    textContent.includes("workflow") ||
                    textContent.includes("data capture") ||
                    textContent.includes("operations") ||
                    textContent.includes("pain point") ||
                    (textContent.includes("ready to help") && textContent.length > 15) ||
                    (textContent.includes("what's the main") && textContent.length > 15) ||
                    (textContent.length > 30 && (
                        textContent.includes("assist") ||
                        textContent.includes("help") ||
                        textContent.includes("support")
                    ));
                
                // Standard identity check
                const isIdentityAgent = segment.senderIdentity &&
                                        segment.senderIdentity.startsWith('agent');
                
                // Look at active speakers to help with classification
                const isActiveSpeakerAgent = room.activeSpeakers.some(
                    speaker => speaker.identity && speaker.identity.startsWith('agent')
                );
                
                // Combined check - use any method that works
                const isAgent = isIdentityAgent || isContentFromAgent ||
                               (isActiveSpeakerAgent && segment.text.length > 10);
                
                console.log(`Message classification: isIdentityAgent=${isIdentityAgent}, isContentFromAgent=${isContentFromAgent}, isActiveSpeakerAgent=${isActiveSpeakerAgent}, final decision: isAgent=${isAgent}`);
                
                // Store classification for this conversation turn
                if (lastClassification !== (isAgent ? 'agent' : 'user')) {
                    lastClassification = isAgent ? 'agent' : 'user';
                    console.log(`Classification changed to: ${lastClassification}`);
                    
                    // When speaker changes to agent, clean up any short user messages
                    if (lastClassification === 'agent') {
                        cleanupAllShortUserMessages();
                    }
                }
                
                // CRITICAL FIX: Handle a more complex classification flow
                if (isAgent) {
                    // For agent messages
                    if (!segment.final) {
                        console.log("Skipping non-final agent transcription");
                        
                        // But still attempt to clean up any misclassified messages
                        if (segment.text.length > 20) {
                            cleanupMisclassifiedMessages(segment.text, true);
                        }
                        continue;
                    }
                    
                    // First, clean up any misclassified messages
                    cleanupMisclassifiedMessages(segment.text, true);
                    
                    // Then display the agent message
                    console.log("Displaying AGENT message from transcription");
                    displayAgentMessage(segment.text, true);
                } else {
                    // For user messages
                    
                    // If we have a very short message and agent was speaking recently,
                    // be cautious with classification
                    if (segment.text.length < 10 && lastClassification === 'agent') {
                        console.log("Short message after agent was speaking - double checking classification");
                        
                        // Wait for more context before displaying as user message
                        if (!segment.final) {
                            console.log("Skipping short non-final message that might be misclassified");
                            continue;
                        }
                    }
                    
                    // User transcription with content-based deduplication
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
            micButton.innerHTML = '<i class="fas fa-microphone-slash"></i>';
            micStatus.textContent = 'Listening...';
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
            micButton.innerHTML = '<i class="fas fa-microphone"></i>';
            micStatus.textContent = 'Click to speak';
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
        const conversationContainer = document.getElementById('conversation-container');
        if (!conversationContainer) return;
        
        // Fade older messages when new ones come in
        const existingMessages = conversationContainer.querySelectorAll('.message-bubble:not(.older)');
        if (existingMessages.length > 3) {
            Array.from(existingMessages).slice(0, -3).forEach(msg => {
                msg.classList.add('older');
            });
        }
        
        // Don't add empty messages
        if (!text || text.trim() === '') return;
        
        // Check if we already have a streaming message from agent that we should update
        if (isAgent && isStreaming) {
            const existingStream = conversationContainer.querySelector('.message-bubble.streaming');
            if (existingStream) {
                const contentElement = existingStream.querySelector('.message-content');
                if (contentElement) {
                    contentElement.innerText = text;
                    return existingStream;
                }
            }
        }
        
        // Otherwise, create a new message bubble
        const messageBubble = document.createElement('div');
        messageBubble.className = `message-bubble ${isAgent ? 'agent-message' : 'user-message'}`;
        
        if (isAgent && isStreaming) {
            messageBubble.classList.add('streaming');
        }
        
        let messageContent = '';
        
        if (isAgent) {
            // Add agent label and speaking indicator
            messageContent += `
                <div class="speaker-label agent-label">
                    <i class="fas fa-robot"></i>
                    <span>Caila</span>
                </div>
            `;
            
            if (isStreaming) {
                messageContent += `
                    <div class="ai-speaking-indicator active">
                        <span></span>
                        <span></span>
                        <span></span>
                    </div>
                `;
            }
        } else {
            // Add user label
            messageContent += `
                <div class="speaker-label user-label">
                    <i class="fas fa-user"></i>
                    <span>You</span>
                </div>
            `;
        }
        
        // Add the message content div
        messageContent += `<div class="message-content ${isStreaming ? 'streaming' : ''}">${text}</div>`;
        
        messageBubble.innerHTML = messageContent;
        conversationContainer.appendChild(messageBubble);
        
        // Scroll to the bottom
        conversationContainer.scrollTop = conversationContainer.scrollHeight;
        
        return messageBubble;
    }
    
    // Display user message in the conversation
    function displayUserMessage(text) {
        if (!text || text.trim() === '') return;
        console.log('Displaying user message:', text);
        addMessageToConversation(text, false);
    }
    
    // Variables to track streaming state
    let currentStreamingMessage = null;
    let streamInterval = null;
    let streamingText = '';
    let streamingIndex = 0;
    
    // Display agent message with real-time streaming effect
    function displayAgentMessage(text, isTranscription) {
        // Add source tracking for debugging
        const callStack = new Error().stack;
        const source = callStack.split('\n')[2].trim();
        
        // Safety check
        if (!text || text.trim() === '') return;
        
        console.log(`AGENT MESSAGE [${source}]: "${text}" (isTranscription=${isTranscription})`);
        
        // Normalize text for content-based deduplication
        const normalizedText = text.trim();
        const contentKey = normalizedText.toLowerCase();
        
        // Debug agent message content
        console.log(`AGENT MESSAGE CONTENT: ${contentKey.substring(0, 30)}...`);
        
        // Check if we already have this exact content
        const existingMessage = agentMessagesByContent.get(contentKey);
        
        if (existingMessage && existingMessage.isConnected) {
            // We already have this message, just update it
            console.log(`DEDUP: Found existing message with key "${contentKey.substring(0, 30)}..." (source=${source})`);
            
            // Update the content with latest version
            const contentEl = existingMessage.querySelector('.message-content');
            if (contentEl) {
                contentEl.textContent = text;
            }
            
            return; // Skip creating duplicates
        } else if (existingMessage) {
            console.log(`DEDUP FAILED: Message exists but not connected (source=${source})`);
        } else {
            console.log(`DEDUP: No existing message found for "${contentKey.substring(0, 30)}..." (source=${source})`);
        }
        
        try {
            // Create a new agent message
            console.log("Creating new agent message bubble");
            const messageBubble = addMessageToConversation(text, true, isTranscription);
            
            if (!messageBubble) {
                console.error("Failed to create message bubble");
                return;
            }
            
            // Store in our registry for future deduplication
            agentMessagesByContent.set(contentKey, messageBubble);
            currentStreamingMessage = messageBubble;
            
            // Flash notification when agent responds
            showFlashMessage('Agent is speaking...', 'info');
            
            // Start a new streaming message
            streamingText = text;
            streamingIndex = 0;
            
            // Clear any existing interval to prevent multiple streams
            if (streamInterval) {
                clearInterval(streamInterval);
            }
            
            // Start the streaming with a slight delay to ensure DOM is ready
            setTimeout(() => {
                streamText(messageBubble, text);
            }, 50);
            
        } catch (error) {
            console.error("Error creating agent message:", error);
            // Fallback: just display the message directly
            addMessageToConversation(text, true, false);
        }
    }
    
    // Simpler streaming function that just focuses on the text animation
    function streamText(messageBubble, text) {
        if (!messageBubble || !messageBubble.isConnected) {
            console.error("Message bubble not available for streaming");
            return;
        }
        
        // Find the content element
        const contentElement = messageBubble.querySelector('.message-content');
        if (!contentElement) {
            console.error("Content element not found in message bubble");
            return;
        }
        
        // Start with empty text
        contentElement.textContent = '';
        
        // Set up character-by-character animation
        let index = 0;
        
        function addNextChar() {
            if (!messageBubble.isConnected) {
                console.error("Message bubble disconnected during streaming");
                return;
            }
            
            if (index < text.length) {
                // Add one character at a time
                contentElement.textContent = text.substring(0, index + 1);
                index++;
                
                // Scroll conversation to bottom
                const conversationContainer = document.getElementById('conversation-container');
                if (conversationContainer) {
                    conversationContainer.scrollTop = conversationContainer.scrollHeight;
                }
                
                // Calculate a random delay for the next character
                let delay = 20; // Base speed
                
                // Previous character (just added)
                const prevChar = text.charAt(index - 1);
                
                // Add variable delays based on punctuation
                if ('.!?'.includes(prevChar)) {
                    delay = 200 + Math.random() * 100; // Longer pause after sentences
                } else if (',;:)('.includes(prevChar)) {
                    delay = 100 + Math.random() * 50; // Medium pause after commas, etc.
                } else {
                    delay = 20 + Math.random() * 20; // Random typing speed variation
                }
                
                // Schedule next character with variable delay
                setTimeout(addNextChar, delay);
            } else {
                // Streaming complete - remove indicators
                messageBubble.classList.remove('streaming');
                
                const indicator = messageBubble.querySelector('.ai-speaking-indicator');
                if (indicator) {
                    indicator.classList.remove('active');
                }
                
                if (contentElement) {
                    contentElement.classList.remove('streaming');
                }
            }
        }
        
        // Start the streaming
        addNextChar();
    }
    
    // Removed finishStreaming function - now handled directly in streamText

    // Update the connection status indicator
    function updateStatus(status) {
        statusIndicator.className = 'status-indicator';
        statusIndicator.classList.add('status-' + status);
        
        switch (status) {
            case 'disconnected':
                connectionStatus.textContent = 'Disconnected';
                micButton.classList.remove('connected');
                micButton.classList.remove('active');
                micStatus.textContent = 'Click to connect';
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
    
    // Initialize language indicator
    currentLangIndicator.textContent = currentLanguage.toUpperCase();
});