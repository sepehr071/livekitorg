// LiveKit Voice Agent Integration with Session Persistence
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

    // Connection State Management
    const CONNECTION_STATE = {
        DISCONNECTED: 'disconnected',
        CONNECTING: 'connecting',
        CONNECTED: 'connected',
        RECONNECTING: 'reconnecting',
        ERROR: 'error'
    };

    // Session Storage Keys
    const STORAGE_KEYS = {
        CONNECTION_INFO: 'livekit_connection_info',
        ROOM_NAME: 'livekit_room_name',
        TOKEN: 'livekit_token',
        LIVEKIT_URL: 'livekit_url',
        LANGUAGE: 'livekit_language',
        CONNECTION_STATE: 'livekit_connection_state',
        LAST_CONNECTED: 'livekit_last_connected'
    };

    // Connection info with defaults
    const connectionInfo = {
        state: CONNECTION_STATE.DISCONNECTED,
        roomName: '',
        token: '',
        livekitUrl: '',
        lastConnected: null
    };

    // State variables
    let room = null;
    let isConnected = false;
    let isRecording = false;
    let currentLanguage = loadFromStorage(STORAGE_KEYS.LANGUAGE) || 'de'; // Default language (German)
    let lastUserInput = ''; // Store the last user input
    let reconnectAttempts = 0;
    let maxReconnectAttempts = 3;
    let isReconnecting = false;
    
    // Add debug flag to easily enable/disable debug messages
    const DEBUG_MODE = true;
    
    // Enhanced logging system with levels
    const LOG_LEVELS = {
        ERROR: 0,
        WARN: 1,
        INFO: 2,
        DEBUG: 3
    };
    
    // Current log level - change to adjust verbosity
    const CURRENT_LOG_LEVEL = LOG_LEVELS.DEBUG;
    
    // Enhanced logger with multiple levels and UI integration
    function logConnection(level, ...args) {
        const timestamp = new Date().toISOString();
        const prefix = `[${timestamp}] [LiveKit ${level}]`;
        
        // Always log errors and warnings
        if (level === 'ERROR' || level === 'WARN' || DEBUG_MODE) {
            console.log(prefix, ...args);
        }
        
        // Also display critical logs in the UI
        if (level === 'ERROR' || level === 'WARN') {
            showFlashMessage(args.join(' '), level.toLowerCase());
        }
    }
    
    // Debug logger for backward compatibility
    function debugLog(...args) {
        if (DEBUG_MODE) {
            logConnection('DEBUG', ...args);
        }
    }
    
    // Removed auto-connect functionality per requirements

    // Connect button handler - only used internally now
    connectButton.addEventListener('click', async () => {
        // This function is now just a fallback and shouldn't be directly used
        console.log('Warning: Connect button should not be directly clicked. Use mic button instead.');
        
        // If we have a stored token, try to reconnect
        if (connectionInfo.token && connectionInfo.livekitUrl) {
            try {
                await connectToRoom(connectionInfo.token, connectionInfo.livekitUrl);
            } catch (error) {
                console.error('Reconnection failed:', error);
                // Clear the stored token if reconnection fails
                clearConnectionInfo();
            }
        }
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
            updateStatus(CONNECTION_STATE.CONNECTING);
            logConnection('INFO', "User initiated connection via mic button");
            
            // Show connecting indicator in welcome screen
            const connectingIndicator = document.getElementById('connecting-indicator');
            if (connectingIndicator) {
                connectingIndicator.style.display = 'flex';
                logConnection('DEBUG', "Showing connecting indicator");
            }
            
            // Connect first, then enable mic
            try {
                // Always request a fresh token with newConnection=true
                logConnection('INFO', `Requesting new token with language=${currentLanguage}`);
                
                // Get a fresh token from the server with language parameter and newConnection=true
                const response = await fetch(`/api/token?lang=${currentLanguage}&newConnection=true`);
                const data = await response.json();
                
                if (!data.success) {
                    throw new Error(data.error || 'Failed to get token');
                }
                
                logConnection('INFO', `Received token for room: ${data.room}`);
                logConnection('DEBUG', "Token response:", data);
                
                const token = data.token;
                const livekitUrl = data.livekit_url;
                
                // If we have an existing connection, disconnect from it first
                if (room) {
                    logConnection('INFO', "Disconnecting from previous room before connecting to new room");
                    try {
                        await room.disconnect(true);
                    } catch (disconnectError) {
                        logConnection('WARN', "Error disconnecting from previous room:", disconnectError);
                        // Continue anyway to establish new connection
                    }
                }
                
                // Connect to the LiveKit room with the new token
                await connectToRoom(token, livekitUrl);
                
                // Store the successful connection info
                connectionInfo.token = token;
                connectionInfo.livekitUrl = livekitUrl;
                connectionInfo.lastConnected = Date.now();
                saveConnectionInfo();
                
                // Hide connecting indicator
                if (connectingIndicator) {
                    connectingIndicator.style.display = 'none';
                }
                
                // Switch from welcome screen to conversation screen
                document.getElementById('welcome-screen').style.display = 'none';
                document.getElementById('conversation-screen').style.display = 'block';
                
                // Don't automatically start recording after connection
                // Just update the UI to show connected state
            } catch (error) {
                console.error('Connection error:', error);
                // Clear invalid connection info
                clearConnectionInfo();
                
                updateStatus(CONNECTION_STATE.DISCONNECTED);
                showFlashMessage('Failed to connect: ' + error.message, 'error');
                micStatus.textContent = 'Click to connect';
                
                // Hide connecting indicator on error
                if (connectingIndicator) {
                    connectingIndicator.style.display = 'none';
                }
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
    
    // Page Lifecycle Event Listeners
    // Handle page visibility changes to reconnect if needed
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            console.log('Page became visible, checking connection');
            if (!isConnected && connectionInfo.state === CONNECTION_STATE.CONNECTED) {
                console.log('Connection state mismatch detected, attempting to reconnect');
                attemptReconnect();
            }
        }
    });
    
    // Handle page unload to properly clean up
    window.addEventListener('beforeunload', () => {
        console.log('Page unloading, storing connection state');
        if (isConnected) {
            // Don't actually disconnect, just store the state
            // This allows for seamless reconnection after refresh
            connectionInfo.state = CONNECTION_STATE.CONNECTED;
            saveConnectionInfo();
        }
    });
    
    // Handle online/offline events
    window.addEventListener('online', () => {
        console.log('Browser is now online, checking connection');
        if (!isConnected && connectionInfo.state === CONNECTION_STATE.CONNECTED) {
            console.log('Attempting to reconnect after coming back online');
            attemptReconnect();
        }
    });
    
    window.addEventListener('offline', () => {
        console.log('Browser is now offline');
        // We don't need to do anything here as LiveKit will handle connection loss
    });

    // Language dropdown functionality
    document.querySelectorAll('#lang-dropdown a').forEach(link => {
        link.addEventListener('click', async (e) => {
            e.preventDefault();
            
            // Skip if the language option is disabled
            if (e.target.classList.contains('disabled')) {
                showFlashMessage('This language is currently not available', 'warning');
                return;
            }
            
            const newLang = e.target.getAttribute('data-lang');
            
            // Close the dropdown
            langDropdown.classList.remove('show');
            
            if (newLang === currentLanguage) return;
            
            console.log(`Changing language from ${currentLanguage} to ${newLang}`);
            currentLanguage = newLang;
            
            // Save language preference to storage
            saveToStorage(STORAGE_KEYS.LANGUAGE, newLang);
            
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
    
    // Helper function to show flash messages - now displays visual messages for better UX
    function showFlashMessage(message, type = 'info') {
        debugLog(`[${type}] ${message}`);
        
        // Add a visual flash message for better user feedback
        const flashContainer = document.querySelector('.flash-messages');
        if (!flashContainer) {
            // Create flash container if it doesn't exist
            const container = document.createElement('div');
            container.className = 'flash-messages';
            document.body.appendChild(container);
            
            // Add the message
            addFlashMessage(container, message, type);
        } else {
            // Add to existing container
            addFlashMessage(flashContainer, message, type);
        }
    }
    
    // Helper function to add a flash message to the container
    function addFlashMessage(container, message, type) {
        const messageElement = document.createElement('div');
        messageElement.className = `flash-message ${type}`;
        messageElement.innerHTML = `
            ${message}
            <button type="button" class="flash-close" onclick="this.parentElement.style.display='none';">&times;</button>
        `;
        
        container.appendChild(messageElement);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (messageElement.parentElement) {
                messageElement.style.display = 'none';
                setTimeout(() => {
                    if (messageElement.parentElement) {
                        messageElement.remove();
                    }
                }, 300);
            }
        }, 5000);
    }
    
    // Helper function to get language name
    function getLangName(langCode) {
        const langNames = {
            'en': 'English',
            'de': 'German',
            'fr': 'French',
            'es': 'Spanish',
            'it': 'Italian',
            'nl': 'Dutch',
            'pl': 'Polish'
        };
        return langNames[langCode] || langCode;
    }
    
    // Helper function to save to sessionStorage
    function saveToStorage(key, value) {
        try {
            sessionStorage.setItem(key, typeof value === 'object' ? JSON.stringify(value) : value);
        } catch (error) {
            console.error('Error saving to sessionStorage:', error);
        }
    }
    
    // Helper function to load from sessionStorage
    function loadFromStorage(key) {
        try {
            const value = sessionStorage.getItem(key);
            if (!value) return null;
            
            try {
                // Try to parse as JSON
                return JSON.parse(value);
            } catch {
                // If not JSON, return as-is
                return value;
            }
        } catch (error) {
            console.error('Error loading from sessionStorage:', error);
            return null;
        }
    }
    
    // Function to save connection info to sessionStorage
    function saveConnectionInfo() {
        saveToStorage(STORAGE_KEYS.CONNECTION_INFO, connectionInfo);
        saveToStorage(STORAGE_KEYS.CONNECTION_STATE, connectionInfo.state);
        saveToStorage(STORAGE_KEYS.TOKEN, connectionInfo.token);
        saveToStorage(STORAGE_KEYS.LIVEKIT_URL, connectionInfo.livekitUrl);
        saveToStorage(STORAGE_KEYS.LAST_CONNECTED, connectionInfo.lastConnected);
    }
    
    // Simplified function that loads only language preference
    function loadUserPreferences() {
        // Only load language preference from session storage
        try {
            const storedLang = sessionStorage.getItem(STORAGE_KEYS.LANGUAGE);
            if (storedLang) {
                debugLog('Found stored language preference:', storedLang);
                currentLanguage = storedLang;
            }
        } catch (error) {
            logConnection('ERROR', `Error loading preferences: ${error.message}`);
        }
    }
    
    // Initialize language preference on load
    loadUserPreferences();
    
    // Function to clear connection info
    function clearConnectionInfo() {
        connectionInfo.state = CONNECTION_STATE.DISCONNECTED;
        connectionInfo.token = '';
        connectionInfo.livekitUrl = '';
        connectionInfo.roomName = '';
        connectionInfo.lastConnected = null;
        
        // Clear from storage
        sessionStorage.removeItem(STORAGE_KEYS.CONNECTION_INFO);
        sessionStorage.removeItem(STORAGE_KEYS.CONNECTION_STATE);
        sessionStorage.removeItem(STORAGE_KEYS.TOKEN);
        sessionStorage.removeItem(STORAGE_KEYS.LIVEKIT_URL);
        sessionStorage.removeItem(STORAGE_KEYS.ROOM_NAME);
        sessionStorage.removeItem(STORAGE_KEYS.LAST_CONNECTED);
    }
    
    // Function to check if we should attempt reconnection with stored token
    function shouldAttemptReconnect() {
        // If we have a stored token and URL
        if (connectionInfo.token && connectionInfo.livekitUrl) {
            // Check if the token is still likely to be valid
            // Tokens are typically valid for an hour, but we'll use a more conservative 50 minutes
            const TOKEN_VALIDITY_MS = 50 * 60 * 1000; // 50 minutes in ms
            
            if (connectionInfo.lastConnected &&
                Date.now() - connectionInfo.lastConnected < TOKEN_VALIDITY_MS) {
                
                debugLog('Token appears valid, last connected: ' + new Date(connectionInfo.lastConnected).toLocaleTimeString());
                return true;
            } else {
                debugLog('Token appears expired or missing timestamp');
            }
        } else {
            debugLog('No stored token or URL available');
        }
        return false;
    }
    
    // Enhanced function to attempt reconnection with better error handling and analytics
    async function attemptReconnect() {
        if (isConnected || isReconnecting) return;
        
        isReconnecting = true;
        reconnectAttempts++;
        
        // Start timing the reconnection attempt for analytics
        const reconnectStartTime = Date.now();
        
        logConnection('INFO', `Attempting reconnection (attempt ${reconnectAttempts}/${maxReconnectAttempts})`);
        updateStatus(CONNECTION_STATE.RECONNECTING);
        
        // Add visible notification about reconnection attempt
        const connectingIndicator = document.getElementById('connecting-indicator');
        if (connectingIndicator) {
            connectingIndicator.style.display = 'flex';
            const textElement = connectingIndicator.querySelector('p');
            if (textElement) {
                textElement.textContent = `Reconnecting (attempt ${reconnectAttempts}/${maxReconnectAttempts})...`;
            }
        }
        
        try {
            // Always request a new token with new room for clean reconnection
            logConnection('INFO', `Requesting new token for reconnection with language=${currentLanguage}`);
            
            // Add request parameters for better server-side handling
            const params = new URLSearchParams({
                lang: currentLanguage,
                newConnection: 'true',
                reconnect: 'true',
                attempt: reconnectAttempts.toString(),
                ttl: '3600'  // 1 hour token
            });
            
            // Make the token request with detailed parameters
            const response = await fetch(`/api/token?${params.toString()}`);
            const data = await response.json();
            
            if (!data.success) {
                throw new Error(data.error || 'Failed to get token for reconnection');
            }
            
            logConnection('INFO', `Received new token for room: ${data.room}`);
            logConnection('DEBUG', "Reconnection token response:", {
                room: data.room,
                language: data.language,
                expires_in: data.expires_in,
                timestamp: data.timestamp
            });
            
            // If we have an existing room, disconnect from it first
            if (room) {
                logConnection('INFO', "Cleaning up previous room connection before reconnecting");
                try {
                    // Send disconnect event to server first
                    try {
                        await fetch('/api/disconnect', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                roomName: room.name,
                                reason: 'reconnect_attempt'
                            })
                        });
                        logConnection('DEBUG', 'Sent disconnect event before reconnection');
                    } catch (notifyError) {
                        logConnection('WARN', `Failed to notify server about disconnect: ${notifyError.message}`);
                    }
                    
                    // Actually disconnect from room
                    await room.disconnect(true);
                } catch (disconnectError) {
                    logConnection('WARN', `Error disconnecting from previous room: ${disconnectError.message}`);
                    // Continue anyway to establish new connection
                }
            }
            
            // Connect with the new token
            await connectToRoom(data.token, data.livekit_url);
            
            // Record successful reconnection for analytics
            const reconnectDuration = Date.now() - reconnectStartTime;
            logConnection('INFO', `Reconnection successful after ${reconnectDuration}ms`);
            
            reconnectAttempts = 0;
            showFlashMessage('Reconnected successfully', 'success');
            
            // Hide connecting indicator if visible
            if (connectingIndicator) {
                connectingIndicator.style.display = 'none';
            }
        } catch (error) {
            logConnection('ERROR', `Reconnection failed: ${error.message}`);
            
            if (reconnectAttempts < maxReconnectAttempts) {
                // Calculate backoff delay: 1s, 2s, 4s, etc.
                const backoffDelay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 10000);
                logConnection('INFO', `Will retry reconnection in ${backoffDelay}ms`);
                
                // Update the connecting indicator with retry information
                if (connectingIndicator) {
                    const textElement = connectingIndicator.querySelector('p');
                    if (textElement) {
                        textElement.textContent = `Reconnection failed. Retrying in ${backoffDelay/1000}s...`;
                    }
                }
                
                // Try again after backoff delay
                setTimeout(() => {
                    attemptReconnect();
                }, backoffDelay);
            } else {
                // Log analytics data about failed reconnection attempts
                const totalReconnectTime = Date.now() - reconnectStartTime;
                logConnection('WARN', `Maximum reconnection attempts reached after ${totalReconnectTime}ms, giving up`);
                
                // Clear connection info for a fresh start next time
                clearConnectionInfo();
                updateStatus(CONNECTION_STATE.DISCONNECTED);
                showFlashMessage('Could not reconnect. Please try again.', 'error');
                reconnectAttempts = 0;
                
                // Hide connecting indicator if visible
                if (connectingIndicator) {
                    connectingIndicator.style.display = 'none';
                }
                
                // Show welcome screen again
                document.getElementById('welcome-screen').style.display = 'flex';
                document.getElementById('conversation-screen').style.display = 'none';
            }
        } finally {
            isReconnecting = false;
        }
    }

    // Connect to LiveKit room
    async function connectToRoom(token, livekitUrl) {
        try {
            logConnection('INFO', `Connecting to LiveKit room: ${livekitUrl}`);
            
            // Access LiveKit classes from the global variable
            // This will be defined by the bundled script imported in interact.html
            const { Room, RoomEvent, ConnectionState } = window.LivekitClient;
            
            // Always create a new Room instance for clean connection state
            logConnection('INFO', 'Creating new Room instance');
            room = new Room({
                dynacast: true,
                adaptiveStream: true,
                // Add enhanced reconnection options
                reconnectPolicy: {
                    maxRetries: 3,  // Maximum number of reconnection attempts
                    retryBackoff: true, // Use exponential backoff
                }
            });
            
            // Log room options for debugging
            logConnection('DEBUG', 'Room created with options:', {
                dynacast: true,
                adaptiveStream: true,
                reconnectPolicy: {
                    maxRetries: 3,
                    retryBackoff: true
                }
            });
            
            // Set up enhanced event listeners for detailed connection logging
            setupEnhancedRoomEventListeners(RoomEvent, ConnectionState);
            setupDataMessageHandler(RoomEvent);
            
            // Pre-warm connection to speed up the actual connection
            logConnection('INFO', 'Preparing connection...');
            await room.prepareConnection(livekitUrl, token);
            
            // Connect to the room with detailed options
            logConnection('INFO', 'Connecting to room...');
            await room.connect(livekitUrl, token, {
                autoSubscribe: true
            });
            
            // Successfully connected
            logConnection('INFO', 'Connected to room successfully!');
            logRoomConnectionDetails();
            
            // Set up text stream handlers after connecting (now that we have a local participant)
            setupTextStreamHandlers();
            
            updateStatus(CONNECTION_STATE.CONNECTED);
            enableDisconnect(true);
            isConnected = true;
            
            // Store connection info
            connectionInfo.state = CONNECTION_STATE.CONNECTED;
            connectionInfo.token = token;
            connectionInfo.livekitUrl = livekitUrl;
            connectionInfo.roomName = room.name; // Store actual room name
            connectionInfo.lastConnected = Date.now();
            saveConnectionInfo();
            
            // Don't show success message here - will show after audio is connected
            // This prevents duplicate success messages
        } catch (error) {
            logConnection('ERROR', `Failed to connect to LiveKit room: ${error.message}`);
            logConnection('DEBUG', 'Connection error details:', error);
            
            updateStatus(CONNECTION_STATE.DISCONNECTED);
            showFlashMessage(`Connection failed: ${error.message}`, 'error');
            throw error; // Re-throw to allow caller to handle the error
        }
    }
    
    // Log detailed room connection information
    function logRoomConnectionDetails() {
        if (!room) {
            logConnection('WARN', 'Cannot log room details - room is null');
            return;
        }
        
        logConnection('INFO', '=== ROOM CONNECTION DETAILS ===');
        logConnection('INFO', `Room name: ${room.name}`);
        logConnection('INFO', `Room SID: ${room.sid || 'unknown'}`);
        logConnection('INFO', `Connection state: ${room.connectionState}`);
        logConnection('INFO', `Local participant: ${room.localParticipant?.identity || 'unknown'}`);
        
        // Check if participants map exists before accessing it
        if (room.participants) {
            // Log all participants
            logConnection('INFO', `Connected participants (${room.participants.size || 0}):`);
            try {
                room.participants.forEach(participant => {
                    const tracks = Array.from(participant.trackPublications.values())
                        .map(pub => `${pub.kind}:${pub.isSubscribed ? 'subscribed' : 'unsubscribed'}`);
                    
                    logConnection('INFO', `- ${participant.identity}: ${tracks.join(', ')}`);
                });
            } catch (error) {
                logConnection('WARN', `Error logging participants: ${error.message}`);
            }
        } else {
            logConnection('INFO', 'Participants map not yet available');
        }
        
        logConnection('INFO', '===============================');
    }
    
    // Set up text stream handlers for receiving messages with enhanced logging
    function setupTextStreamHandlers() {
        if (!room) {
            logConnection('ERROR', 'Cannot set up text stream handlers - room is null');
            return;
        }
        
        logConnection('INFO', `Setting up text stream handlers for room: ${room.name}`);
        
        try {
            // Register handler for transcriptions and agent messages
            logConnection('INFO', 'Registering handler for lk.transcription topic');
            room.registerTextStreamHandler('lk.transcription', async (reader, participantInfo) => {
                logConnection('INFO', `Received text stream from ${participantInfo.identity} on lk.transcription topic`);
                
                try {
                    // Read all content from the stream
                    const message = await reader.readAll();
                    logConnection('DEBUG', `TEXT STREAM RECEIVED: ${message.length} chars`, {
                        participant: participantInfo.identity,
                        room: room.name,
                        topic: 'lk.transcription'
                    });
                    
                    // Check if this is a transcription of audio from agent
                    const isTranscribedSpeech = reader.info.attributes && reader.info.attributes['lk.transcribed_track_id'];
                    const isAgentIdentity = participantInfo.identity && participantInfo.identity.startsWith('agent');
                    
                    if (isTranscribedSpeech) {
                        if (isAgentIdentity) {
                            // Agent speaking - use displayAgentMessage
                            // Extract final status for agent too
                            const isFinal = reader.info.attributes &&
                                reader.info.attributes['lk.transcription_final'] === 'true';
                            
                            logConnection('DEBUG', `Agent transcription: "${message.substring(0, 30)}..." (final=${isFinal})`);
                            
                            // For agent, we want to stream non-final messages too
                            // This will show text as it's being spoken
                            displayAgentMessage(message, true, !isFinal);
                        } else {
                            // User speaking - use displayUserTranscription
                            // Extract final status
                            const isFinal = reader.info.attributes &&
                                reader.info.attributes['lk.transcription_final'] === 'true';
                            
                            logConnection('DEBUG', `User transcription: "${message.substring(0, 30)}..." (final=${isFinal})`);
                            displayUserTranscription(message, null, isFinal);
                        }
                    } else {
                        // DIRECT MESSAGE: Non-transcription message (rare, but handle it)
                        if (isAgentIdentity) {
                            // If from agent, put in agent area
                            logConnection('INFO', "Processing DIRECT AGENT MESSAGE (non-transcription)");
                            displayAgentMessage(message, false, true);
                        } else {
                            // If from user or system, handle as system message
                            logConnection('INFO', "Processing OTHER MESSAGE");
                            showFlashMessage(message, 'info');
                        }
                    }
                } catch (error) {
                    logConnection('ERROR', `Error reading transcription stream: ${error.message}`, error);
                }
            });
            
            // Register handler for chat messages (important for agent responses)
            logConnection('INFO', 'Registering handler for lk.chat topic');
            room.registerTextStreamHandler('lk.chat', async (reader, participantInfo) => {
                logConnection('INFO', `Received text stream from ${participantInfo.identity} on lk.chat topic`);
                
                try {
                    const message = await reader.readAll();
                    logConnection('DEBUG', `Chat message: ${message.length} chars`);
                    
                    // Only process messages from the agent, and ignore system commands
                    if (!participantInfo.identity || !participantInfo.identity.startsWith('agent')) {
                        logConnection('DEBUG', 'Ignoring chat message from non-agent participant');
                        return;
                    }
                    
                    // Skip language instruction messages (they start with "From now on only respond in")
                    if (message.startsWith("From now on only respond in")) {
                        logConnection('DEBUG', "Skipping language instruction message in display");
                        return;
                    }
                    
                    // Display agent message directly in the AGENT area
                    logConnection('INFO', "Showing agent response in UI from CHAT");
                    
                    // Show notification that we received a message
                    showFlashMessage('Received response from Caila', 'info');
                    
                    // Use displayAgentMessage to ensure correct placement in agent area
                    displayAgentMessage(message, false, true);
                    
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
                    logConnection('ERROR', `Error reading chat stream: ${error.message}`, error);
                }
            });
            
            logConnection('INFO', 'Text stream handlers set up successfully');
        } catch (error) {
            logConnection('ERROR', `Error setting up text stream handlers: ${error.message}`, error);
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
                    displayAgentMessage(data.text, false, true);
                    
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
        
        // Save this as the last user input (only if it's a final transcription or substantial)
        if (isFinal || text.length > 15) {
            lastUserInput = text;
            console.log(`Saved last user input: "${lastUserInput}"`);
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

    // Set up enhanced event listeners for the LiveKit room
    function setupEnhancedRoomEventListeners(RoomEvent, ConnectionState) {
        if (!room) {
            logConnection('ERROR', 'Cannot set up event listeners - room is null');
            return;
        }
        
        logConnection('INFO', 'Setting up enhanced room event listeners');
        
        // Connection state changes - detailed logging
        room.on(RoomEvent.ConnectionStateChanged, (state) => {
            logConnection('INFO', `Connection state changed: ${state}`);
            
            // Log detailed connection state based on LiveKit docs
            switch (state) {
                case ConnectionState.CONNECTING:
                    logConnection('INFO', "Initiating connection to LiveKit server");
                    break;
                    
                case ConnectionState.CONNECTED:
                    logConnection('INFO', "Successfully connected to LiveKit server");
                    // Log all connected participants
                    room.participants.forEach(participant => {
                        logConnection('INFO', `Room has participant: ${participant.identity}`);
                    });
                    
                    // When connection is restored after being interrupted
                    if (connectionInfo.state === CONNECTION_STATE.RECONNECTING) {
                        logConnection('INFO', 'Reconnection successful');
                        isConnected = true;
                        updateStatus(CONNECTION_STATE.CONNECTED);
                        showFlashMessage('Reconnected successfully', 'success');
                    }
                    break;
                    
                case ConnectionState.DISCONNECTED:
                    logConnection('INFO', "Disconnected from LiveKit server");
                    if (room.disconnectReason) {
                        logConnection('WARN', `Disconnect reason: ${room.disconnectReason}`);
                    }
                    break;
                    
                case ConnectionState.RECONNECTING:
                    logConnection('WARN', "Connection interrupted, attempting to reconnect");
                    isConnected = false;
                    updateStatus(CONNECTION_STATE.RECONNECTING);
                    showFlashMessage('Connection interrupted. Attempting to reconnect...', 'warning');
                    connectionInfo.state = CONNECTION_STATE.RECONNECTING;
                    saveConnectionInfo();
                    break;
                    
                case ConnectionState.FAILED:
                    logConnection('ERROR', "Connection failed permanently");
                    updateStatus(CONNECTION_STATE.DISCONNECTED);
                    enableDisconnect(false);
                    isConnected = false;
                    showFlashMessage('Connection failed. Please try connecting again.', 'error');
                    break;
            }
        });
        
        // Participant tracking with enhanced logging
        room.on(RoomEvent.ParticipantConnected, (participant) => {
            logConnection('INFO', `Participant connected: ${participant.identity}`);
            
            // Special logging for agent connections
            if (participant.identity && participant.identity.startsWith('agent')) {
                logConnection('INFO', "✓ Agent joined the room");
                showFlashMessage('Agent connected to the room', 'info');
            }
        });
        
        room.on(RoomEvent.ParticipantDisconnected, (participant) => {
            logConnection('INFO', `Participant disconnected: ${participant.identity}`);
            
            // Special logging for agent disconnections
            if (participant.identity && participant.identity.startsWith('agent')) {
                logConnection('WARN', "⚠ Agent left the room");
                showFlashMessage('Agent disconnected from the room', 'warning');
            }
        });
        
        // Track subscription monitoring with detailed logging
        room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
            logConnection('INFO', `Track subscribed: ${track.kind} from ${participant.identity}`);
            
            // If we receive an audio track, attach it to an audio element
            if (track.kind === 'audio') {
                const audioElement = track.attach();
                document.body.appendChild(audioElement);
                audioElement.style.display = 'none'; // Hide but keep audio playing
                
                // Special logging for agent audio
                if (participant.identity && participant.identity.startsWith('agent')) {
                    logConnection('INFO', "✓ Agent audio connected");
                    // This is the ONLY place where we show the success message - after audio is ready
                    showFlashMessage('Connected successfully! You can now interact with the Caila.', 'success');
                }
            }
        });
        
        room.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
            logConnection('INFO', `Track unsubscribed: ${track.kind} from ${participant.identity}`);
            
            if (track.kind === 'audio' && participant.identity && participant.identity.startsWith('agent')) {
                logConnection('WARN', "⚠ Agent audio disconnected");
                showFlashMessage('Agent audio disconnected', 'warning');
            }
        });
        
        // Process transcriptions with enhanced logging
        room.on(RoomEvent.TranscriptionReceived, (segments) => {
            for (const segment of segments) {
                // Skip empty transcriptions
                if (!segment.text || segment.text.trim() === '') continue;
                
                // Add detailed diagnostic information
                logConnection('DEBUG', `TRANSCRIPTION RECEIVED:`, {
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
                
                logConnection('DEBUG', `Message classification: isIdentityAgent=${isIdentityAgent}, final decision: isAgent=${isAgent}`);
                
                // Store classification for this conversation turn
                if (lastClassification !== (isAgent ? 'agent' : 'user')) {
                    lastClassification = isAgent ? 'agent' : 'user';
                    logConnection('INFO', `Classification changed to: ${lastClassification}`);
                }
                
                // IMPROVED HANDLING: Clear separation between agent and user messages
                if (isAgent) {
                    // For agent messages - display all transcriptions, both final and non-final
                    logConnection('INFO', `Displaying AGENT message from transcription (final=${segment.final})`);
                    displayAgentMessage(segment.text, true, true);
                } else {
                    // For user messages - display all transcriptions
                    logConnection('INFO', `Displaying USER message from transcription (final=${segment.final})`);
                    displayUserTranscription(segment.text, null, segment.final === true);
                }
            }
        });
        
        // When active speakers change
        room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
            logConnection('DEBUG', `Active speakers changed: ${speakers.map(s => s.identity).join(', ')}`);
        });
        
        // Handle disconnection
        room.on(RoomEvent.Disconnected, () => {
            logConnection('WARN', 'Disconnected from room');
            
            // Log disconnection reason if available
            if (room.disconnectReason) {
                logConnection('WARN', `Disconnect reason: ${room.disconnectReason}`);
            }
            
            updateStatus(CONNECTION_STATE.DISCONNECTED);
            enableDisconnect(false);
            isConnected = false;
            showFlashMessage('Disconnected from the Caila.', 'warning');
            
            // Since we're definitely disconnected, update session state
            connectionInfo.state = CONNECTION_STATE.DISCONNECTED;
            saveConnectionInfo();
        });
    }

    // Disconnect from the room with enhanced logging
    async function disconnectFromRoom() {
        if (room) {
            logConnection('INFO', 'Disconnecting from room...');
            
            try {
                if (isRecording) {
                    logConnection('INFO', 'Stopping recording before disconnect');
                    await stopRecording();
                }
                
                // Send disconnect event to server
                logConnection('INFO', 'Sending disconnect event to server');
                try {
                    const response = await fetch('/api/disconnect', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            roomName: room.name,
                            reason: 'user_initiated'
                        })
                    });
                    const data = await response.json();
                    logConnection('DEBUG', 'Disconnect recorded on server', data);
                } catch (serverError) {
                    logConnection('WARN', `Failed to record disconnect on server: ${serverError.message}`);
                }
                
                // Disconnect with proper cleanup
                logConnection('INFO', 'Calling room.disconnect()');
                await room.disconnect(true);
                
                logConnection('INFO', 'Disconnected from room successfully');
                showFlashMessage('Disconnected from voice agent', 'info');
            } catch (error) {
                logConnection('ERROR', `Error during disconnect: ${error.message}`, error);
            } finally {
                // Always ensure we reset the state even if there were errors
                logConnection('INFO', 'Cleaning up room state after disconnect');
                room = null;
                isConnected = false;
                updateStatus(CONNECTION_STATE.DISCONNECTED);
                enableDisconnect(false);
                
                // Update connection info
                connectionInfo.state = CONNECTION_STATE.DISCONNECTED;
                saveConnectionInfo();
                
                // Switch back to welcome screen
                document.getElementById('welcome-screen').style.display = 'flex';
                document.getElementById('conversation-screen').style.display = 'none';
            }
        } else {
            logConnection('WARN', 'Disconnect called but no active room exists');
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
            
            micStatus.textContent = 'Microphone is active';
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
            
            micStatus.textContent = 'Microphone is on mute';
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
            displayAgentMessage(text, type === 'agent-transcription', true);
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
            // Handle user message - no display needed as we've removed the user text display
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
    
    // Display agent message with streaming effect
    function displayAgentMessage(text, isTranscription, isStreaming = true) {
        // Add source tracking for debugging - with browser compatibility
        let source = "unknown";
        try {
            const callStack = new Error().stack;
            if (callStack) {
                // Stack trace is available (Chrome, Firefox, etc.)
                source = callStack.split('\n')[2]?.trim() || "unknown";
            } else {
                // Stack trace unavailable (Safari)
                source = "browser-without-stack-support";
            }
        } catch (e) {
            // If any error occurs during stack handling, use a fallback
            source = "stack-error";
        }
        
        // Safety check
        if (!text || text.trim() === '') return;
        
        console.log(`AGENT MESSAGE [${source}]: "${text}" (isTranscription=${isTranscription}, isStreaming=${isStreaming})`);
        
        try {
            // Create a new agent message in the conversation container
            console.log("Creating new agent message");
            
            // Get the conversation container
            const conversationContainer = document.getElementById('conversation-container');
            if (!conversationContainer) {
                console.error("Conversation container not found");
                return;
            }
            
            // Check if we already have an AI message element
            let aiMessage = conversationContainer.querySelector('.ai-message');
            
            // If no existing message or not streaming, create a new one
            if (!aiMessage || !isStreaming) {
                // Clear previous messages - we only show the latest AI response
                conversationContainer.innerHTML = '';
                
                // Create a new AI message
                aiMessage = document.createElement('div');
                aiMessage.className = 'ai-message';
                
                // Add the message content element
                const contentElement = document.createElement('div');
                contentElement.className = 'ai-message-content';
                aiMessage.appendChild(contentElement);
                
                // Add to the container
                conversationContainer.appendChild(aiMessage);
            }
            
            // Get the content element
            const contentElement = aiMessage.querySelector('.ai-message-content');
            if (!contentElement) {
                console.error("Content element not found in AI message");
                return;
            }
            
            // Store for reference
            currentStreamingMessage = aiMessage;
            
            // If streaming, update the text with animation
            if (isStreaming) {
                // Add streaming class
                aiMessage.classList.add('streaming');
                
                // Update the text immediately - this is what the user wants
                contentElement.textContent = text;
            } else {
                // Just display the full text immediately
                contentElement.textContent = text;
                aiMessage.classList.remove('streaming');
            }
            
            // Force scroll to bottom with multiple attempts at different times
            // This ensures we catch the scroll after content is fully rendered
            forceScrollToBottom(conversationContainer);
            
            // Also add to chat log for completeness (invisible but functional)
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message agent-message';
            messageDiv.innerHTML = `
                <strong>Caila:</strong>
                <p>${text}</p>
                <small>${new Date().toLocaleTimeString()}</small>
            `;
            chatContainer.appendChild(messageDiv);
            
        } catch (error) {
            console.error("Error creating agent message:", error);
            // Fallback: just display the message directly
            addMessageToConversation(text, true, false);
        }
    }
    
    // Helper function to force scroll to bottom with multiple attempts
    function forceScrollToBottom(container) {
        if (!container) return;
        
        // Immediate scroll attempt
        container.scrollTop = container.scrollHeight;
        
        // Multiple delayed scroll attempts to ensure it works
        const scrollAttempts = [10, 50, 100, 200, 500];
        scrollAttempts.forEach(delay => {
            setTimeout(() => {
                console.log(`Scrolling to bottom (delay: ${delay}ms)`);
                container.scrollTop = container.scrollHeight;
            }, delay);
        });
        
        // Also set up a MutationObserver to watch for content changes
        if (!window.aiMessageObserver) {
            window.aiMessageObserver = new MutationObserver((mutations) => {
                console.log("Content changed, scrolling to bottom");
                container.scrollTop = container.scrollHeight;
            });
            
            // Start observing the container for content changes
            window.aiMessageObserver.observe(container, {
                childList: true,
                subtree: true,
                characterData: true
            });
        }
    }
    
    // Stream text with animation effect
    // We've removed the streamText function since we're now updating the text directly
    
    // Removed finishStreaming function - now handled directly in streamText

    // Update the connection status indicator
    function updateStatus(status) {
        // Get the text input container
        const textInputContainer = document.querySelector('.text-input-container');
        
        switch (status) {
            case CONNECTION_STATE.DISCONNECTED:
                micButton.classList.remove('connected');
                micButton.classList.remove('active');
                micStatus.textContent = 'Connect';
                
                // Show connect icon and hide others
                document.getElementById('mic-icon-connect').style.display = 'inline-block';
                document.getElementById('mic-icon-mute').style.display = 'none';
                document.getElementById('mic-icon-active').style.display = 'none';
                
                // Hide text input
                if (textInputContainer) {
                    textInputContainer.classList.remove('visible');
                }
                
                // Show welcome screen, hide conversation screen
                document.getElementById('welcome-screen').style.display = 'flex';
                document.getElementById('conversation-screen').style.display = 'none';
                break;
                
            case CONNECTION_STATE.CONNECTING:
                micStatus.textContent = 'Connecting...';
                
                // Show connect icon and hide others
                document.getElementById('mic-icon-connect').style.display = 'inline-block';
                document.getElementById('mic-icon-mute').style.display = 'none';
                document.getElementById('mic-icon-active').style.display = 'none';
                
                // Hide text input
                if (textInputContainer) {
                    textInputContainer.classList.remove('visible');
                }
                break;
                
            case CONNECTION_STATE.RECONNECTING:
                micStatus.textContent = 'Reconnecting...';
                micButton.classList.remove('connected');
                
                // Show connect icon and hide others
                document.getElementById('mic-icon-connect').style.display = 'inline-block';
                document.getElementById('mic-icon-mute').style.display = 'none';
                document.getElementById('mic-icon-active').style.display = 'none';
                
                // No need to change the screens here - keep them as they are
                break;
                
            case CONNECTION_STATE.CONNECTED:
                micButton.classList.add('connected');
                micStatus.textContent = 'Microphone is on mute';
                
                // Show mute icon and hide others
                document.getElementById('mic-icon-connect').style.display = 'none';
                document.getElementById('mic-icon-mute').style.display = 'inline-block';
                document.getElementById('mic-icon-active').style.display = 'none';
                
                // Show text input with fade-in effect
                if (textInputContainer) {
                    textInputContainer.classList.add('visible');
                }
                
                // Show conversation screen, hide welcome screen
                document.getElementById('welcome-screen').style.display = 'none';
                document.getElementById('conversation-screen').style.display = 'block';
                break;
                
            case CONNECTION_STATE.ERROR:
                micButton.classList.remove('connected');
                micButton.classList.remove('active');
                micStatus.textContent = 'Connection failed';
                
                // Show connect icon and hide others
                document.getElementById('mic-icon-connect').style.display = 'inline-block';
                document.getElementById('mic-icon-mute').style.display = 'none';
                document.getElementById('mic-icon-active').style.display = 'none';
                
                // Hide text input
                if (textInputContainer) {
                    textInputContainer.classList.remove('visible');
                }
                break;
        }
    }

    // Enable/disable the connect button (disconnect button is hidden)
    function enableDisconnect(enable) {
        connectButton.disabled = enable;
        // disconnectButton.disabled = !enable;
    }

    // Removed heartbeat and connection state check that was causing false warnings
    // LiveKit's built-in connection monitoring is sufficient

    // Initialize with disconnected status
    updateStatus(CONNECTION_STATE.DISCONNECTED);
    
    // Initialize language indicator
    currentLangIndicator.textContent = currentLanguage.toUpperCase();
    
    // Initialize screens - show welcome screen, hide conversation screen
    document.getElementById('welcome-screen').style.display = 'flex';
    document.getElementById('conversation-screen').style.display = 'none';
    
    // Removed auto-reconnect functionality per requirements
});