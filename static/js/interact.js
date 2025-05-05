// LiveKit Voice Agent Integration with Session Persistence
document.addEventListener('DOMContentLoaded', function() {
    // DOM Elements - moved to the top for proper initialization
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
    const interruptButton = document.getElementById('interrupt-button');

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
    
    // DOM Elements section has been moved to the top of the function

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
        LAST_CONNECTED: 'livekit_last_connected',
        TTS_MUTED: 'livekit_tts_muted',
        CONVERSATION_HISTORY: 'livekit_conversation_history'
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
    let isAgentSpeaking = false; // Track if agent is currently speaking
    let isTtsMuted = false; // Track TTS mute state
    // Removed isInterruptActive variable as it's no longer needed
    // Removed pendingInterruptMessages array as it's no longer needed
    
    // Initialize lastSpeakerId and lastClassification with null
    let lastSpeakerId = null;
    let lastClassification = null;
    
    // Conversation history tracking with enhanced scroll management
    let conversationHistory = [];
    let isScrolledToBottom = true;
    let lastScrollHeight = 0;
    let unreadMessageCount = 0;
    let autoScrollEnabled = true; // Enable/disable auto-scrolling
    let scrollThreshold = 100; // Threshold in pixels to determine if scrolled away from bottom
    let isProcessingScroll = false; // Prevent scroll event handling during programmatic scrolling
    
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
    
    // Enhanced logger with multiple levels - UI integration removed
    function logConnection(level, ...args) {
        const timestamp = new Date().toISOString();
        const prefix = `[${timestamp}] [LiveKit ${level}]`;
        
        // Always log errors and warnings
        if (level === 'ERROR' || level === 'WARN' || DEBUG_MODE) {
            console.log(prefix, ...args);
        }
        
        // No UI notifications as per requirements, just log everything to console
        // For debugging purposes only
        if (DEBUG_MODE) {
            console.log(prefix, ...args);
        }
    }
    
    // Debug logger for backward compatibility
    function debugLog(...args) {
        if (DEBUG_MODE) {
            logConnection('DEBUG', ...args);
        }
    }
    
    // Removed auto-connect functionality per requirements

    // Connect button handler - now used directly from welcome screen
    connectButton.addEventListener('click', async () => {
        // Show connecting status
        updateStatus(CONNECTION_STATE.CONNECTING);
        logConnection('INFO', "User initiated connection via connect button");
        
        // Show connecting indicator in welcome screen
        const connectingIndicator = document.getElementById('connecting-indicator');
        if (connectingIndicator) {
            connectingIndicator.style.display = 'flex';
            logConnection('DEBUG', "Showing connecting indicator");
        }
        
        // Connect to room
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
            
            // Show voice button, text input and controls after connection
            document.querySelector('.voice-button-container').style.display = 'flex';
            document.querySelector('.text-input-container').style.display = 'flex';
            document.querySelector('.bottom-controls').style.display = 'flex';
        } catch (error) {
            console.error('Connection error:', error);
            // Clear invalid connection info
            clearConnectionInfo();
            
            updateStatus(CONNECTION_STATE.DISCONNECTED);
            showFlashMessage('Failed to connect: ' + error.message, 'error');
            // Status text removed
            
            // Hide connecting indicator on error
            if (connectingIndicator) {
                connectingIndicator.style.display = 'none';
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
            // Status text removed
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
                
                // Show voice button, text input and controls after connection
                document.querySelector('.voice-button-container').style.display = 'flex';
                document.querySelector('.text-input-container').style.display = 'flex';
                document.querySelector('.bottom-controls').style.display = 'flex';
                
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
    
    // TTS mute toggle button event listener
    const ttsToggleBtn = document.getElementById('tts-toggle-btn');
    if (ttsToggleBtn) {
        ttsToggleBtn.addEventListener('click', () => {
            toggleTtsMute();
        });
    }

    // Language dropdown functionality
    document.querySelectorAll('#lang-dropdown a').forEach(link => {
        link.addEventListener('click', async (e) => {
            e.preventDefault();
            
            // Skip if the language option is disabled
            if (e.target.classList.contains('disabled')) {
                // No UI notification as per requirements
                console.log('This language is currently not available');
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
            
            // No UI notification as per requirements
            console.log(`Language changed to ${getLangName(newLang)}`);
            
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
                        // No UI notification as per requirements
                        console.log('Failed to change language. Please try again.');
                    }
                }
            }
        });
    });
    
    // Add event listener for download button
    const downloadBtn = document.getElementById('download-btn');
    if (downloadBtn) {
        downloadBtn.addEventListener('click', downloadConversation);
    }
    
    // Function to download conversation
    function downloadConversation() {
        // Format conversation history as text
        const formattedText = formatConversationAsText();
        
        // Generate filename with date
        const date = new Date().toISOString().split('T')[0];
        const filename = `conversation-${date}.txt`;
        
        // Create download link
        const blob = new Blob([formattedText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        
        // Set link properties
        a.href = url;
        a.download = filename;
        
        // Trigger download
        document.body.appendChild(a);
        a.click();
        
        // Cleanup
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);
        
        // Log to console instead of showing UI message
        console.log('Conversation downloaded successfully');
    }
    
    // Format conversation history as text
    function formatConversationAsText() {
        let text = "Conversation History\n";
        text += "===================\n\n";
        
        conversationHistory.forEach(message => {
            const prefix = message.isAgent ? "Agent: " : "User: ";
            text += `${prefix}${message.text}\n\n`;
        });
        
        return text;
    }
    
    // Helper function to log messages to console only (no UI notifications)
    function showFlashMessage(message, type = 'info') {
        // Only log to console, no UI display as required
        // This ensures notifications don't appear in the UI
        console.log(`[${type}] ${message}`);
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
    
    // Load user preferences function - now loads both language and TTS mute state
    function loadUserPreferences() {
        // Load language preference from session storage
        try {
            const storedLang = sessionStorage.getItem(STORAGE_KEYS.LANGUAGE);
            if (storedLang) {
                debugLog('Found stored language preference:', storedLang);
                currentLanguage = storedLang;
            }
            
            // Load TTS mute state preference
            const storedTtsMuted = loadFromStorage(STORAGE_KEYS.TTS_MUTED);
            if (storedTtsMuted !== null) {
                debugLog('Found stored TTS mute preference:', storedTtsMuted);
                isTtsMuted = storedTtsMuted === 'true' || storedTtsMuted === true;
            }
        } catch (error) {
            logConnection('ERROR', `Error loading preferences: ${error.message}`);
        }
    }
    
    // Initialize TTS state
    function initializeTtsState() {
        // Update UI to match state
        updateTtsToggleDisplay();
    }
    
    // Update TTS toggle button display
    function updateTtsToggleDisplay() {
        const ttsToggleBtn = document.getElementById('tts-toggle-btn');
        const ttsIcon = document.getElementById('tts-icon');
        const ttsLabel = document.getElementById('tts-label');
        
        if (ttsToggleBtn && ttsIcon) {
            // Update icon
            ttsIcon.className = isTtsMuted ? 'fas fa-volume-mute' : 'fas fa-volume-up';
            
            // Update button class
            ttsToggleBtn.classList.toggle('muted', isTtsMuted);
            
            // Update label to show Mute/Unmute
            if (ttsLabel) {
                ttsLabel.textContent = isTtsMuted ? 'Unmute' : 'Mute';
            }
            
            // Apply mute state to any existing audio elements
            applyTtsMuteState();
        }
    }
    
    // Apply TTS mute state to audio elements
    function applyTtsMuteState() {
        // Get all audio elements
        const audioElements = document.querySelectorAll('audio');
        audioElements.forEach(audio => {
            audio.muted = isTtsMuted;
        });
    }
    
    // Toggle TTS mute state
    function toggleTtsMute() {
        isTtsMuted = !isTtsMuted;
        
        // Save preference
        saveToStorage(STORAGE_KEYS.TTS_MUTED, isTtsMuted);
        
        // Update UI
        updateTtsToggleDisplay();
        
        // No UI notification as per requirements
        console.log(`Text-to-speech audio ${isTtsMuted ? 'muted' : 'unmuted'}`);
    }
    
    // Initialize language preference and TTS state on load
    loadUserPreferences();
    initializeTtsState();
    
    // Add interrupt button click handler - moved here after all variable declarations
    if (interruptButton) {
        interruptButton.addEventListener('click', interruptAgent);
    }
    
    // Initialize conversation UI - moved here after STORAGE_KEYS is defined
    initializeConversationUI();
    
    // Initialize conversation UI with enhanced scroll functionality and virtualization
    function initializeConversationUI() {
        // Set up scroll listener for chat history
        const chatHistory = document.getElementById('chat-history');
        if (chatHistory) {
            // Use passive event listener for better scroll performance
            chatHistory.addEventListener('scroll', handleScroll, { passive: true });
            
            // Add wheel event listener to detect user scroll direction
            chatHistory.addEventListener('wheel', function(e) {
                if (!isProcessingScroll) {
                    // If scrolling down near the bottom, re-enable auto-scroll
                    const scrollPosition = chatHistory.scrollHeight - chatHistory.scrollTop - chatHistory.clientHeight;
                    if (e.deltaY > 0 && scrollPosition < scrollThreshold * 2) {
                        autoScrollEnabled = true;
                    }
                }
            }, { passive: true });
            
            // Add resize observer to update virtualization when window size changes
            if ('ResizeObserver' in window) {
                const resizeObserver = new ResizeObserver((() => {
                    // Simple debounce implementation
                    let timeout;
                    return function(entries) {
                        clearTimeout(timeout);
                        timeout = setTimeout(() => {
                            if (typeof virtualScrollState !== 'undefined' && virtualScrollState.isVirtualized) {
                                if (typeof handleVirtualScroll === 'function') {
                                    handleVirtualScroll();
                                }
                            }
                        }, 100);
                    };
                })());
                resizeObserver.observe(chatHistory);
            }
        }
        
        // Set up scroll to bottom button with unread count badge
        const scrollButton = document.getElementById('scroll-to-bottom');
        if (scrollButton) {
            // Create unread badge if it doesn't exist
            if (!scrollButton.querySelector('.unread-badge')) {
                const badge = document.createElement('div');
                badge.className = 'unread-badge';
                badge.textContent = '0';
                scrollButton.appendChild(badge);
            }
            
            scrollButton.addEventListener('click', () => scrollToBottom(true));
            
            // Initially hide the button
            scrollButton.classList.remove('visible');
        }
        
        // Load conversation history if available
        const storedHistory = loadFromStorage(STORAGE_KEYS.CONVERSATION_HISTORY);
        if (storedHistory) {
            try {
                // Handle different formats of stored history
                if (typeof storedHistory === 'object' && storedHistory !== null) {
                    conversationHistory = storedHistory;
                } else if (typeof storedHistory === 'string') {
                    conversationHistory = JSON.parse(storedHistory);
                } else {
                    throw new Error('Invalid history format');
                }
                
                // Check if we need to limit the stored history size
                if (conversationHistory.length > 500) {
                    logConnection('WARN', `Found very large conversation history (${conversationHistory.length} messages), truncating older messages`);
                    // Keep only the last 500 messages to maintain performance
                    conversationHistory = conversationHistory.slice(-500);
                    throttledSaveConversationHistory();
                }
                
                // Render the conversation history
                renderConversationHistory();
                
                // Scroll to bottom after loading history
                setTimeout(() => {
                    scrollToBottom(false);
                }, 100);
                
            } catch (e) {
                logConnection('ERROR', `Failed to parse stored conversation history: ${e.message}`);
                // Reset to empty array if there was an error
                conversationHistory = [];
            }
        }
    }
    
    // Handle scrolling in chat history with improved scroll detection and indicators
    function handleScroll() {
        const chatHistory = document.getElementById('chat-history');
        const scrollButton = document.getElementById('scroll-to-bottom');
        const unreadBadge = document.querySelector('.unread-badge');
        
        if (!chatHistory || !scrollButton) return;
        
        // Skip if this is a programmatic scroll
        if (isProcessingScroll) return;
        
        // Calculate scroll position and percentage
        const scrollPosition = chatHistory.scrollHeight - chatHistory.scrollTop - chatHistory.clientHeight;
        const scrollPercentage = (chatHistory.scrollTop / (chatHistory.scrollHeight - chatHistory.clientHeight)) * 100;
        
        // Update scroll indicator height based on scroll percentage
        chatHistory.style.setProperty('--scroll-indicator-height', `${scrollPercentage}%`);
        
        // Show scroll indicator while actively scrolling
        chatHistory.classList.add('scrolling');
        // Clear any existing timeout
        if (window.scrollIndicatorTimeout) {
            clearTimeout(window.scrollIndicatorTimeout);
        }
        // Hide scroll indicator after a delay
        window.scrollIndicatorTimeout = setTimeout(() => {
            chatHistory.classList.remove('scrolling');
        }, 1000);
        
        // Determine if scrolled to bottom (within threshold tolerance)
        const wasAtBottom = isScrolledToBottom;
        isScrolledToBottom = scrollPosition < scrollThreshold;
        
        // Update scroll button visibility with class for smooth transition
        if (isScrolledToBottom) {
            scrollButton.classList.remove('visible');
            // Reset unread count when scrolled to bottom
            if (unreadBadge) {
                unreadBadge.classList.remove('visible');
                setTimeout(() => { unreadMessageCount = 0; }, 300);
            }
        } else {
            scrollButton.classList.add('visible');
        }
        
        // Track if user has manually scrolled away from bottom
        if (wasAtBottom && !isScrolledToBottom && !isProcessingScroll) {
            autoScrollEnabled = false;
            logConnection('DEBUG', 'Auto-scroll disabled due to manual scroll');
        }
        
        // Re-enable auto-scroll if user manually scrolls to bottom
        if (!wasAtBottom && isScrolledToBottom && !isProcessingScroll) {
            autoScrollEnabled = true;
            logConnection('DEBUG', 'Auto-scroll re-enabled by manual scroll to bottom');
        }
    }
    
    // Scroll to bottom of chat with enhanced performance for long conversations
    function scrollToBottom(smooth = true) {
        const chatHistory = document.getElementById('chat-history');
        if (!chatHistory) return;
        
        logConnection('DEBUG', 'Scrolling to bottom');
        isProcessingScroll = true;
        
        // Update scroll button visibility immediately to avoid flicker
        const scrollButton = document.getElementById('scroll-to-bottom');
        
        if (scrollButton) {
            scrollButton.classList.remove('visible');
        }
        
        // Reset unread count
        unreadMessageCount = 0;
        
        // Disable smooth scrolling for very large conversations for performance
        const shouldUseSmooth = smooth && conversationHistory.length < 200;
        
        // Apply scrolling behavior based on conversation size
        if (shouldUseSmooth) {
            chatHistory.style.scrollBehavior = 'smooth';
        } else {
            chatHistory.style.scrollBehavior = 'auto';
        }
        
        // Use requestAnimationFrame to ensure DOM updates before scrolling
        requestAnimationFrame(() => {
            // Perform the scroll
            chatHistory.scrollTop = chatHistory.scrollHeight;
            
            // Add visual feedback for large scrolls
            if (conversationHistory.length > 50) {
                chatHistory.classList.add('scrolling');
                setTimeout(() => {
                    chatHistory.classList.remove('scrolling');
                }, 1000);
            }
            
            // Update state
            isScrolledToBottom = true;
            autoScrollEnabled = true;
            
            // Reset scroll behavior and processing flag after appropriate delay
            setTimeout(() => {
                if (chatHistory) {
                    chatHistory.style.scrollBehavior = 'smooth';
                }
                isProcessingScroll = false;
            }, shouldUseSmooth ? 300 : 50);
        });
    }
    
    // Maintain scroll position with enhanced performance for long conversations
    function maintainScrollPosition() {
        const chatHistory = document.getElementById('chat-history');
        const scrollButton = document.getElementById('scroll-to-bottom');
        const unreadBadge = document.querySelector('.unread-badge');
        
        if (!chatHistory) return;
        
        // Skip if processing another scroll operation
        if (isProcessingScroll) return;
        
        // If auto-scroll is enabled or we were at the bottom, scroll to bottom
        if (autoScrollEnabled || isScrolledToBottom) {
            // Save current scroll height before changes
            const prevScrollHeight = chatHistory.scrollHeight;
            
            // Schedule the scroll after DOM has updated
            requestAnimationFrame(() => {
                // For large changes, use smooth scrolling for better UX
                const heightDifference = chatHistory.scrollHeight - prevScrollHeight;
                const useSmoothScroll = heightDifference > 200;
                
                // Use appropriate scrolling method based on change size
                if (heightDifference > 10) {
                    scrollToBottom(useSmoothScroll);
                } else {
                    // For minor changes, just maintain position
                    chatHistory.scrollTop = chatHistory.scrollHeight;
                    isScrolledToBottom = true;
                }
            });
        } else {
            // We're not at the bottom and auto-scroll is disabled, so increment unread count
            unreadMessageCount++;
            
            // No longer updating unread badge - it's hidden by CSS
            
            // Make sure scroll button is visible and animated for attention
            if (scrollButton) {
                scrollButton.classList.add('visible');
                
                // Add attention-grabbing animation for higher unread counts
                if (unreadMessageCount > 5 && !scrollButton.classList.contains('attention')) {
                    scrollButton.classList.add('attention');
                    setTimeout(() => scrollButton.classList.remove('attention'), 1000);
                }
            }
            
            logConnection('DEBUG', `Not scrolling to bottom, unread messages: ${unreadMessageCount}`);
        }
    }
    
    // Add a message to the conversation history with optimized rendering
    function addToConversationHistory(text, isAgent, metadata = {}) {
        // Create message object
        const message = {
            text: text,
            isAgent: isAgent,
            timestamp: new Date().toISOString(),
            ...metadata
        };
        
        // Add to history array
        conversationHistory.push(message);
        
        // Save to storage - throttle for performance with large conversations
        throttledSaveConversationHistory();
        
        // Render just the new message instead of the entire history
        // for better performance with long conversations
        appendSingleMessage(message);
    }
    
    // Throttle function to prevent excessive storage operations
    let saveHistoryTimeout = null;
    function throttledSaveConversationHistory() {
        if (saveHistoryTimeout) {
            clearTimeout(saveHistoryTimeout);
        }
        
        saveHistoryTimeout = setTimeout(() => {
            saveToStorage(STORAGE_KEYS.CONVERSATION_HISTORY, JSON.stringify(conversationHistory));
            logConnection('DEBUG', 'Conversation history saved to storage');
        }, 1000); // Save after 1 second of inactivity
    }
    
    // Append a single message to the chat history with enhanced scroll position preservation
    function appendSingleMessage(message) {
        const chatHistory = document.getElementById('chat-history');
        if (!chatHistory) return;
        
        // Save scroll position information before adding content
        const wasAtBottom = isScrolledToBottom;
        const prevScrollTop = chatHistory.scrollTop;
        const prevScrollHeight = chatHistory.scrollHeight;
        
        // Create the new message element
        const messageEl = createMessageElement(message, conversationHistory.length - 1);
        
        // Use requestAnimationFrame for better performance
        requestAnimationFrame(() => {
            // Add the new message
            chatHistory.appendChild(messageEl);
            
            // If user was not at the bottom (reading older messages)
            if (!wasAtBottom) {
                // Calculate and restore scroll position to maintain the same view
                const newScrollTop = prevScrollTop + (chatHistory.scrollHeight - prevScrollHeight);
                
                // Temporarily disable scroll event handling
                isProcessingScroll = true;
                
                // Immediately apply the scroll position to avoid flicker
                chatHistory.scrollTop = newScrollTop;
                
                // Re-enable scroll handling after a short delay
                setTimeout(() => {
                    isProcessingScroll = false;
                }, 100);
            } else {
                // If at bottom, just maintain scroll position normally
                maintainScrollPosition();
            }
            
            // Add highlight animation for new messages with improved visual feedback
            messageEl.classList.add('new-message');
            
            // Use a more pronounced animation duration for better visibility
            setTimeout(() => {
                messageEl.classList.remove('new-message');
            }, 1500);
            
            // Add a subtle scroll animation to draw attention
            if (isScrolledToBottom) {
                messageEl.scrollIntoView({ behavior: 'smooth', block: 'end' });
            }
        });
    }
    
    // Render the conversation history with optimizations for long conversations
    function renderConversationHistory() {
        const chatHistory = document.getElementById('chat-history');
        if (!chatHistory) return;
        
        // Save scroll height before rendering
        lastScrollHeight = chatHistory.scrollHeight;
        
        // Set a flag to prevent scroll handling during bulk rendering
        isProcessingScroll = true;
        
        // Clear current content
        chatHistory.innerHTML = '';
        
        // For very long conversations, consider implementing virtualization
        // For now, we'll use a simple optimization to limit rendering when needed
        let messagesToRender = conversationHistory;
        const MAX_MESSAGES = 100; // Maximum number of messages to render at once
        
        if (conversationHistory.length > MAX_MESSAGES) {
            logConnection('INFO', `Optimizing rendering for large conversation (${conversationHistory.length} messages)`);
            messagesToRender = conversationHistory.slice(-MAX_MESSAGES);
            
            // Add a notice that some messages are not shown
            const noticeEl = document.createElement('div');
            noticeEl.className = 'message system-message';
            noticeEl.innerHTML = `<div class="message-bubble">
                <div class="message-text">
                    ${conversationHistory.length - MAX_MESSAGES} earlier messages are not displayed.
                    <button class="view-all-btn">View All</button>
                </div>
            </div>`;
            
            // Add button handler to view all messages
            const viewAllBtn = noticeEl.querySelector('.view-all-btn');
            if (viewAllBtn) {
                viewAllBtn.addEventListener('click', function() {
                    renderAllMessages();
                });
            }
            
            chatHistory.appendChild(noticeEl);
        }
        
        // Create a document fragment for better performance
        const fragment = document.createDocumentFragment();
        
        // Render each message
        messagesToRender.forEach((message, index) => {
            const messageEl = createMessageElement(message, index);
            fragment.appendChild(messageEl);
        });
        
        // Append all messages at once for better performance
        chatHistory.appendChild(fragment);
        
        // Reset processing flag
        setTimeout(() => {
            isProcessingScroll = false;
            // Maintain scroll position
            maintainScrollPosition();
        }, 50);
    }
    
    // Function to render all messages when requested
    function renderAllMessages() {
        const chatHistory = document.getElementById('chat-history');
        if (!chatHistory) return;
        
        logConnection('INFO', `Rendering all ${conversationHistory.length} messages`);
        
        // Show loading indicator
        // No UI notification as per requirements
        console.log('Loading all messages...');
        
        // Use setTimeout to allow UI to update before heavy operation
        setTimeout(() => {
            isProcessingScroll = true;
            
            // Clear current content
            chatHistory.innerHTML = '';
            
            // Create a document fragment for better performance
            const fragment = document.createDocumentFragment();
            
            // Render each message
            conversationHistory.forEach((message, index) => {
                const messageEl = createMessageElement(message, index);
                fragment.appendChild(messageEl);
            });
            
            // Append all messages at once
            chatHistory.appendChild(fragment);
            
            // Reset processing flag and maintain scroll
            setTimeout(() => {
                isProcessingScroll = false;
                maintainScrollPosition();
                // No UI notification as per requirements
                console.log('All messages loaded');
            }, 50);
        }, 100);
    }
    
    // Create a message element - simplified ChatGPT style
    function createMessageElement(message, index) {
        const messageContainer = document.createElement('div');
        messageContainer.className = `message ${message.isAgent ? 'agent-message' : 'user-message'}`;
        messageContainer.dataset.index = index;
        
        // Create message bubble
        const bubble = document.createElement('div');
        bubble.className = 'message-bubble';
        
        // Message text
        const textEl = document.createElement('div');
        textEl.className = 'message-text';
        textEl.textContent = message.text;
        
        // Message timestamp - formatted more nicely
        const timeEl = document.createElement('div');
        timeEl.className = 'message-time';
        const date = new Date(message.timestamp);
        timeEl.textContent = date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        
        // Assemble message (no avatar)
        bubble.appendChild(textEl);
        bubble.appendChild(timeEl);
        messageContainer.appendChild(bubble);
        
        return messageContainer;
    }
    
    // Show typing indicator (simplified with no animation)
    function showTypingIndicator() {
        const chatHistory = document.getElementById('chat-history');
        if (!chatHistory) return;
        
        // Remove any existing indicator
        removeTypingIndicator();
        
        // Create typing indicator (simpler version without animation)
        const indicator = document.createElement('div');
        indicator.className = 'message agent-message typing-indicator-container';
        indicator.id = 'typing-indicator';
        
        // Simple text-based indicator instead of animation
        const typing = document.createElement('div');
        typing.className = 'typing-indicator';
        typing.textContent = 'AI is typing...';
        
        indicator.appendChild(typing);
        
        chatHistory.appendChild(indicator);
        scrollToBottom();
        
        // Make sure stop button is shown when typing indicator appears (AI message is being generated)
        if (interruptButton) {
            interruptButton.style.display = 'inline-flex';
            // Set a data attribute to track that AI is generating a message
            interruptButton.setAttribute('data-ai-generating', 'true');
        }
    }
    
    // Remove typing indicator
    function removeTypingIndicator() {
        const indicator = document.getElementById('typing-indicator');
        if (indicator) {
            indicator.remove();
        }
        
        // Hide stop button when typing indicator is removed (AI message completed)
        if (interruptButton) {
            interruptButton.style.display = 'none';
            // Remove the data attribute when AI stops generating
            interruptButton.removeAttribute('data-ai-generating');
            // Ensure the button is really hidden by setting opacity to 0 as well
            interruptButton.style.opacity = '0';
        }
    }
    
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
                            // We don't need to block transcriptions anymore since we're just sending the interrupt message
                            // The agent will handle stopping on its own
                            
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
                            
                            // Only add final user transcriptions to the chat history
                            if (isFinal) {
                                displayUserMessage(message);
                            }
                        }
                    } else {
                        // DIRECT MESSAGE: Non-transcription message (rare, but handle it)
                        if (isAgentIdentity) {
                            // If from agent, put in agent area
                            logConnection('INFO', "Processing DIRECT AGENT MESSAGE (non-transcription)");
                            displayAgentMessage(message, false, false);
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
                    
                    // Check for interrupt commands from client
                    if (message === "!interrupt" || message === "/interrupt") {
                        logConnection('INFO', "Received interrupt command via chat");
                        return; // Don't display these
                    }
                    
                    // Skip language instruction messages (they start with "From now on only respond in")
                    if (message.startsWith("From now on only respond in")) {
                        logConnection('DEBUG', "Skipping language instruction message in display");
                        return;
                    }
                    
                    // We don't need to block chat messages anymore since we're just sending the interrupt message
                    // The agent will handle stopping on its own
                    
                    // Skip processing interrupt messages
                    // Check both the text content and the x-interrupt-command attribute
                    if (message === "stop talking for now" ||
                        (reader.info && reader.info.attributes &&
                         reader.info.attributes['x-interrupt-command'] === 'true')) {
                        logConnection('DEBUG', 'Skipping interrupt command message in UI display');
                        return;
                    }
                    
                    // Display agent message directly in the AGENT area
                    logConnection('INFO', "Showing agent response in UI from CHAT");
                    
                    // No UI notification as per requirements
                    console.log('Received response from agent');
                    
                    // Remove typing indicator first
                    removeTypingIndicator();
                    
                    // Make sure interrupt button is hidden when typing is done
                    if (interruptButton) {
                        interruptButton.style.display = 'none';
                    }
                    
                    // Add message to conversation history (not partial since it's a complete message)
                    displayAgentMessage(message, false, false);
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
                
                // Check for interrupt response acknowledgment
                if (data.type === 'control' && data.action === 'interrupt_ack') {
                    logConnection('INFO', 'Received interrupt acknowledgment from agent');
                    return;
                }
                
                if (data.type === 'message') {
                    // Skip language instruction messages
                    if (data.text && data.text.startsWith("From now on only respond in")) {
                        console.log("Skipping language instruction data message:", data.text);
                        return;
                    }
                    
                    // We don't need to block data messages anymore since we're just sending the interrupt message
                    // The agent will handle stopping on its own
                    
                    // Skip processing interrupt messages
                    // Check both the text content and the interrupt type
                    if (data.text === "stop talking for now" || data.type === 'interrupt') {
                        logConnection('DEBUG', 'Skipping interrupt command message in UI display');
                        return;
                    }
                    
                    console.log("Showing agent response from data:", data.text);
                    
                    // Remove typing indicator first
                    removeTypingIndicator();
                    
                    // Make sure interrupt button is hidden when typing is done
                    if (interruptButton) {
                        interruptButton.style.display = 'none';
                    }
                    
                    // Add to conversation history as a complete message (not partial)
                    displayAgentMessage(data.text, false, false);
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
    let partialMessageFragments = [];
    // Using the lastSpeakerId and lastClassification from the top state variables
    
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
    
    // Add utility function for string similarity comparison
    function calculateStringSimilarity(str1, str2) {
        // Simple similarity measure - can be enhanced if needed
        if (str1 === str2) return 1.0;
        if (str1.length === 0 || str2.length === 0) return 0.0;
        
        // Check for substring relationship
        if (str1.includes(str2)) return str2.length / str1.length;
        if (str2.includes(str1)) return str1.length / str2.length;
        
        // Count matching words
        const words1 = str1.split(/\s+/);
        const words2 = str2.split(/\s+/);
        let matches = 0;
        
        for (const word of words1) {
            if (word.length > 3 && words2.includes(word)) {
                matches++;
            }
        }
        
        return (2 * matches) / (words1.length + words2.length);
    }
    
    // IMPROVED: Display user transcriptions in the user text display with enhanced safety checks
    function displayUserTranscription(text, segmentId = null, isFinal = false) {
        // Safety check
        if (!text || text.trim() === '') return;
        
        // More comprehensive check for agent messages with stricter criteria
        const lowerText = text.toLowerCase();
        const agentPhrases = [
            "i'm ana", "sales professional", "assist you", "help you",
            "i can help", "i'd be happy", "please let me know",
            "is there anything", "would you like", "can i assist"
        ];
        
        // Count agent phrases
        const matchCount = agentPhrases.filter(phrase => lowerText.includes(phrase)).length;
        
        // Much stricter criteria to reject - must have multiple agent phrases to be rejected
        if (matchCount >= 2 && lowerText.length > 25) {
            console.log(`Skipping likely agent message incorrectly classified as user: "${text}" (matched ${matchCount} phrases)`);
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
                    // No UI notification as per requirements
                    console.log('Connection interrupted. Attempting to reconnect...');
                    connectionInfo.state = CONNECTION_STATE.RECONNECTING;
                    saveConnectionInfo();
                    break;
                    
                case ConnectionState.FAILED:
                    logConnection('ERROR', "Connection failed permanently");
                    updateStatus(CONNECTION_STATE.DISCONNECTED);
                    enableDisconnect(false);
                    isConnected = false;
                    // No UI notification as per requirements
                    console.log('Connection failed. Please try connecting again.');
                    break;
            }
        });
        
        // Participant tracking with enhanced logging
        room.on(RoomEvent.ParticipantConnected, (participant) => {
            logConnection('INFO', `Participant connected: ${participant.identity}`);
            
            // Special logging for agent connections
            if (participant.identity && participant.identity.startsWith('agent')) {
                logConnection('INFO', "✓ Agent joined the room");
                // No UI notification as per requirements
                console.log('Agent connected to the room');
            }
        });
        
        room.on(RoomEvent.ParticipantDisconnected, (participant) => {
            logConnection('INFO', `Participant disconnected: ${participant.identity}`);
            
            // Special logging for agent disconnections
            if (participant.identity && participant.identity.startsWith('agent')) {
                logConnection('WARN', "⚠ Agent left the room");
                // No UI notification as per requirements
                console.log('Agent disconnected from the room');
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
                
                // Apply current TTS mute state to this audio element
                audioElement.muted = isTtsMuted;
                
                // Special logging for agent audio
                if (participant.identity && participant.identity.startsWith('agent')) {
                    logConnection('INFO', "✓ Agent audio connected");
                    // No UI notification as per requirements
                    console.log('Connected successfully! You can now interact with the Caila.');
                    
                    // Track agent speaking state
                    isAgentSpeaking = true;
                    updateInterruptButtonVisibility();
                    
                    // Set up ended event to know when agent stops speaking
                    audioElement.onended = () => {
                        isAgentSpeaking = false;
                        updateInterruptButtonVisibility();
                    };
                    
                    // Also monitor playing state to detect when agent stops speaking
                    audioElement.addEventListener('pause', () => {
                        isAgentSpeaking = false;
                        updateInterruptButtonVisibility();
                    });
                    
                    // Monitor playing state to detect when agent starts speaking
                    audioElement.addEventListener('play', () => {
                        isAgentSpeaking = true;
                        updateInterruptButtonVisibility();
                    });
                }
            }
        });
        
        room.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
            logConnection('INFO', `Track unsubscribed: ${track.kind} from ${participant.identity}`);
            
            if (track.kind === 'audio' && participant.identity && participant.identity.startsWith('agent')) {
                logConnection('WARN', "⚠ Agent audio disconnected");
                // No UI notification as per requirements
                console.log('Agent audio disconnected');
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
                
                // FIXED CLASSIFICATION: More robust handling of identity and fallbacks
                // Start with definite null value to avoid undefined issues
                let isIdentityAgent = null;
                
                // Explicit check for sender identity, treating undefined properly
                if (segment.senderIdentity) {
                    isIdentityAgent = segment.senderIdentity.startsWith('agent');
                    logConnection('DEBUG', `Identity-based classification: ${isIdentityAgent} from identity "${segment.senderIdentity}"`);
                } else {
                    logConnection('DEBUG', `No sender identity available for classification`);
                }
                
                // Default to not agent when identity is missing (safer assumption)
                // This explicitly handles the undefined identity case
                let isAgent = isIdentityAgent === true;
                
                // Safety check against recent user input to prevent misclassification
                if (lastUserInput && lastUserInput.trim().length > 0) {
                    const segmentLower = segment.text.toLowerCase().trim();
                    const userInputLower = lastUserInput.toLowerCase().trim();
                    
                    // If this segment closely matches recent user input, it's definitely from user
                    // regardless of other classification signals
                    if (segmentLower === userInputLower ||
                        (segmentLower.length > 5 && userInputLower.includes(segmentLower)) ||
                        (userInputLower.length > 5 && segmentLower.includes(userInputLower))) {
                        logConnection('DEBUG', `Force classifying as USER message - matches recent user input`);
                        isAgent = false;
                    }
                }
                
                // Only attempt content-based classification if still uncertain and text is substantial
                if (isIdentityAgent !== true && segment.text.length > 10) {
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
                    
                    // Count agent phrases
                    const matchCount = agentPhrases.filter(phrase => textContent.includes(phrase)).length;
                    
                    // User-specific phrases that would indicate this is definitely a user message
                    const userPhrases = ["i need", "i want", "can you", "what is", "do you", "how do i"];
                    const userPhraseMatches = userPhrases.filter(phrase => textContent.includes(phrase)).length;
                    
                    // If we detect user phrases, keep this as a user message
                    if (userPhraseMatches > 0) {
                        isAgent = false;
                        logConnection('DEBUG', `Detected ${userPhraseMatches} user phrases, classifying as USER`);
                    }
                    // Otherwise use agent phrase detection with higher threshold for safety
                    else {
                        // Require stronger evidence to classify as agent when identity is missing:
                        // More matches and longer text
                        const isContentFromAgent = (matchCount >= 2 && textContent.length > 30) ||
                                                   (matchCount >= 3);
                        
                        // Look at active speakers to help with classification
                        let isActiveSpeakerAgent = false;
                        if (room.activeSpeakers) {
                            isActiveSpeakerAgent = room.activeSpeakers.some(
                                speaker => speaker.identity && speaker.identity.startsWith('agent')
                            );
                        }
                        
                        // Combined check - more conservative when identity is missing
                        if (isContentFromAgent || (isActiveSpeakerAgent && matchCount >= 1 && segment.text.length > 30)) {
                            isAgent = true;
                        }
                    }
                }
                
                // Ensure final result is always a definite boolean (not undefined or null)
                isAgent = isAgent === true;
                
                logConnection('DEBUG', `Final message classification: isIdentityAgent=${isIdentityAgent}, isAgent=${isAgent}`);
                
                // Store classification for this conversation turn
                if (lastClassification !== (isAgent ? 'agent' : 'user')) {
                    lastClassification = isAgent ? 'agent' : 'user';
                    logConnection('INFO', `Classification changed to: ${lastClassification}`);
                }
                
                // IMPROVED HANDLING: Additional safety check before display
                if (isAgent) {
                    // For agent messages - display all transcriptions, both final and non-final
                    logConnection('INFO', `Displaying AGENT message from transcription (final=${segment.final})`);
                    displayAgentMessage(segment.text, true, true);
                } else {
                    // For user messages - display all transcriptions
                    logConnection('INFO', `Displaying USER message from transcription (final=${segment.final})`);
                    
                    // Final safety check - don't let user transcriptions go to agent bubble
                    if (lastUserInput && segment.text.trim().length > 0) {
                        const similarity = calculateStringSimilarity(
                            segment.text.toLowerCase().trim(),
                            lastUserInput.toLowerCase().trim()
                        );
                        // If very similar to last user input, force as user message
                        if (similarity > 0.7) {
                            logConnection('DEBUG', `Similarity check confirms USER classification (${similarity.toFixed(2)})`);
                        }
                    }
                    
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
            // No UI notification as per requirements
            console.log('Disconnected from the Caila.');
            
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
                // No UI notification as per requirements
                console.log('Disconnected from voice agent');
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
            
            // Status text removed
            isRecording = true;
            
            // No UI notification as per requirements
            console.log('Microphone activated. Speak now...');
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
            
            // Status text removed
            isRecording = false;
            
            // No UI notification as per requirements
            console.log('Microphone deactivated.');
        }
    }

    // Send a text message
    async function sendTextMessage() {
        const text = textInput.value.trim();
        if (!text) return;
        
        if (!isConnected) {
            // No UI notification as per requirements
            console.log('Please connect first before sending messages.');
            return;
        }
        
        // Make sure text input container remains visible
        const textInputContainer = document.querySelector('.text-input-container');
        if (textInputContainer) {
            textInputContainer.classList.add('visible');
        }
        
        // Add the message to the conversation history
        displayUserMessage(text);
        
        // Show typing indicator for agent response
        showTypingIndicator();
        
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
                    // No UI notification as per requirements
                    console.log('Failed to send message. Please try again.');
                    
                    // Remove typing indicator if message failed
                    removeTypingIndicator();
                }
            }
        }
        
        // Clear the input
        textInput.value = '';
        
        // Ensure textInput is visible and focused after sending
        setTimeout(() => {
            if (textInput) {
                textInput.focus();
                
                // Make sure container stays visible
                const textInputContainer = document.querySelector('.text-input-container');
                if (textInputContainer) {
                    textInputContainer.classList.add('visible');
                }
            }
        }, 0);
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
    
    // Display user message in the conversation history
    function displayUserMessage(text) {
        if (!text || text.trim() === '') return;
        console.log('Displaying user message:', text);
        
        // Store the normalized content for deduplication
        const normalizedContent = text.toLowerCase().trim();
        
        // Add to user message tracking map
        userMessagesByContent.set(normalizedContent, null);
        
        // Add to conversation history
        addToConversationHistory(text, false);
        
        // Show typing indicator for agent response
        showTypingIndicator();
        
        // Save this as the last user input
        lastUserInput = text;
        console.log(`Saved last user input: "${lastUserInput}"`);
    }
    
    // Variables to track streaming state
    let currentStreamingMessage = null;
    
    // Display agent message with streaming/typing effect and enhanced safety checks
    function displayAgentMessage(text, isTranscription, isPartial = false) {
        // Safety check
        if (!text || text.trim() === '') return;
        
        // Make sure interrupt button is visible when agent is responding
        if (interruptButton) {
            interruptButton.style.display = 'inline-flex';
        }
        
        // SAFETY CHECK: Verify this doesn't look like a user message before displaying as agent
        let shouldDisplay = true;
        const normalizedText = text.trim().toLowerCase();
        
        // If we have recent user input, compare with this message
        if (lastUserInput && lastUserInput.trim().length > 0) {
            const userInputLower = lastUserInput.toLowerCase().trim();
            
            // Calculate similarity between this message and the last user input
            const similarity = calculateStringSimilarity(normalizedText, userInputLower);
            
            // If very similar to user input, this might be a misclassified user message
            if (similarity > 0.7) {
                logConnection('WARN', `Potential misclassification detected - agent message too similar to user input (similarity: ${similarity.toFixed(2)})`);
                logConnection('DEBUG', `User input: "${userInputLower}"`);
                logConnection('DEBUG', `Agent text: "${normalizedText}"`);
                
                // Don't suppress messages that are very long compared to user input
                // This handles cases where user input is echoed as part of a longer response
                if (normalizedText.length < userInputLower.length * 2) {
                    // Log the warning but continue showing as agent message
                    logConnection('DEBUG', `Potential similarity with user input detected (${similarity.toFixed(2)}) but continuing with agent display`);
                    // Don't set shouldDisplay = false anymore
                } else {
                    logConnection('DEBUG', `Displaying anyway due to length difference (agent: ${normalizedText.length}, user: ${userInputLower.length})`);
                }
            }
        }
        
        // Additional check for user question patterns that wouldn't make sense from an agent
        const userQuestionPatterns = [
            /^(can|could) you/i,
            /^(what|how|why|when|where) (is|are|can|do|does|did)/i,
            /^i need/i,
            /^i want/i,
            /^tell me/i
        ];
        
        // Only apply this check to shorter messages to avoid filtering agent responses
        // that might repeat the user's question
        if (shouldDisplay && text.length < 60) {
            for (const pattern of userQuestionPatterns) {
                if (pattern.test(text.trim())) {
                    logConnection('WARN', `Likely user question detected in agent message: "${text}"`);
                    logConnection('DEBUG', `Matched pattern: ${pattern}`);
                    shouldDisplay = false;
                    break;
                }
            }
        }
        
        // Only proceed if the safety checks pass
        if (shouldDisplay) {
            console.log(`AGENT MESSAGE: "${text}" (isTranscription=${isTranscription}, isPartial=${isPartial})`);
            
            // Add deduplication logic to prevent duplicate messages
            // Check if we already have this exact message in recent history
            const chatHistory = document.getElementById('chat-history');
            if (chatHistory) {
                const recentAgentMessages = chatHistory.querySelectorAll('.agent-message');
                let isDuplicate = false;
                
                // Check last 3 messages to see if this is a duplicate
                recentAgentMessages.forEach(msg => {
                    const msgText = msg.querySelector('.message-text')?.textContent;
                    if (msgText === text) {
                        isDuplicate = true;
                        logConnection('DEBUG', `Skipping duplicate agent message: "${text.substring(0, 30)}..."`);
                    }
                });
                
                // If it's a duplicate, don't add it again
                if (isDuplicate && !isPartial) {
                    return;
                }
            }
            
            // Remove typing indicator if this is a final message
            if (!isPartial) {
                removeTypingIndicator();
            }
            
            try {
                // If this is a partial message (streaming), update the last message if it exists
                if (isPartial) {
                    // Find the last agent message in the history
                    const chatHistory = document.getElementById('chat-history');
                    const lastAgentMessage = chatHistory?.querySelector('.agent-message:last-of-type');
                    
                    if (lastAgentMessage) {
                        // Update the existing message content
                        const textEl = lastAgentMessage.querySelector('.message-text');
                        if (textEl) {
                            textEl.textContent = text;
                            maintainScrollPosition();
                            return;
                        }
                    }
                    
                    // If we couldn't find a message to update, create a new one
                    addToConversationHistory(text, true, { isPartial: true });
                } else {
                    // For final messages, add as a new message
                    addToConversationHistory(text, true);
                    
                    // Make sure interrupt button is hidden for final messages (AI message completed)
                    if (interruptButton) {
                        interruptButton.style.display = 'none';
                        // Remove the data attribute when AI stops generating
                        interruptButton.removeAttribute('data-ai-generating');
                        // Force it to be hidden with opacity as well
                        interruptButton.style.opacity = '0';
                    }
                }
            } catch (error) {
                console.error("Error displaying agent message:", error);
            }
        } else {
            // Instead of displaying as agent, send to user message area if we're sure it's a user message
            logConnection('INFO', `Redirecting misclassified message to user display instead: "${text.substring(0, 30)}..."`);
            displayUserTranscription(text, null, true);
        }
    }
    
    // Helper function to force scroll to bottom with enhanced reliability and performance
    function forceScrollToBottom(container) {
        if (!container) return;
        
        // Set flag to prevent scroll handling during programmatic scrolling
        isProcessingScroll = true;
        
        // Use requestAnimationFrame for smoother scrolling that's aligned with the render cycle
        requestAnimationFrame(() => {
            // First, try without smooth scrolling for instant positioning
            container.style.scrollBehavior = 'auto';
            container.scrollTop = container.scrollHeight;
            
            // Multiple scheduled attempts with increasing delays for reliability
            const scrollAttempts = [10, 50, 150, 300];
            scrollAttempts.forEach(delay => {
                setTimeout(() => {
                    requestAnimationFrame(() => {
                        logConnection('DEBUG', `Additional scroll attempt (delay: ${delay}ms)`);
                        container.scrollTop = container.scrollHeight;
                        
                        // On the last attempt, restore smooth scrolling and reset flag
                        if (delay === scrollAttempts[scrollAttempts.length - 1]) {
                            container.style.scrollBehavior = 'smooth';
                            isProcessingScroll = false;
                        }
                    });
                }, delay);
            });
        });
        
        // Set up a more efficient MutationObserver with better performance characteristics
        if (!window.aiMessageObserver) {
            window.aiMessageObserver = new MutationObserver((mutations) => {
                // Process multiple mutations as a single batch
                if (mutations.length > 0) {
                    // Only scroll if auto-scroll is enabled
                    if (autoScrollEnabled) {
                        requestAnimationFrame(() => {
                            logConnection('DEBUG', "Content changed, scrolling to bottom");
                            container.scrollTop = container.scrollHeight;
                        });
                    }
                }
            });
            
            // Use a more selective observation strategy
            window.aiMessageObserver.observe(container, {
                childList: true,  // Watch for added/removed children
                subtree: false,   // Don't observe all descendants, just direct children
                characterData: false // Don't watch for text changes, just structure
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
                
                // Hide voice button container
                const voiceButtonContainer = document.querySelector('.voice-button-container');
                if (voiceButtonContainer) {
                    voiceButtonContainer.style.display = 'none';
                }
                
                // Hide bottom controls
                const bottomControls = document.querySelector('.bottom-controls');
                if (bottomControls) {
                    bottomControls.style.display = 'none';
                }
                break;
                
            case CONNECTION_STATE.CONNECTING:
                // Status text removed
                
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
                
                // Keep text input visible if we were previously connected
                // No need to change the screens here - keep them as they are
                break;
                
            case CONNECTION_STATE.CONNECTED:
                micButton.classList.add('connected');
                // Status text removed
                
                // Show mute icon and hide others
                document.getElementById('mic-icon-connect').style.display = 'none';
                document.getElementById('mic-icon-mute').style.display = 'inline-block';
                document.getElementById('mic-icon-active').style.display = 'none';
                
                // Always ensure text input is visible
                if (textInputContainer) {
                    textInputContainer.classList.add('visible');
                    
                    // Force visibility with inline style as backup
                    textInputContainer.style.opacity = '1';
                    textInputContainer.style.display = 'flex';
                }
                
                // Show conversation screen, hide welcome screen
                document.getElementById('welcome-screen').style.display = 'none';
                document.getElementById('conversation-screen').style.display = 'block';
                
                // Focus the text input after connecting
                setTimeout(() => {
                    const textInput = document.getElementById('text-input');
                    if (textInput) {
                        textInput.focus();
                    }
                }, 300);
                break;
                
            case CONNECTION_STATE.ERROR:
                micButton.classList.remove('connected');
                micButton.classList.remove('active');
                // Status text removed
                
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
    
    // Function to update interrupt button visibility based on agent speaking state
    function updateInterruptButtonVisibility() {
        if (interruptButton) {
            // Show button when agent is actively speaking OR a message is being generated
            const aiGenerating = interruptButton.hasAttribute('data-ai-generating');
            const shouldShowButton = isAgentSpeaking || aiGenerating;
            
            // Show/hide using display property directly instead of CSS classes
            if (shouldShowButton) {
                interruptButton.style.display = 'inline-flex';
                interruptButton.style.opacity = '1';
            } else {
                // Hide completely when agent stops speaking and no message is being generated
                interruptButton.style.display = 'none';
                interruptButton.style.opacity = '0';
            }
            
            // Make sure it's visible when typing indicator is present
            if (document.querySelector('.typing-indicator-container')) {
                interruptButton.style.display = 'inline-flex';
                interruptButton.style.opacity = '1';
            }
            
            // Set default title for interrupt button
            interruptButton.setAttribute('title', 'Stop AI');
            
            // Ensure the button is clickable
            interruptButton.style.pointerEvents = 'auto';
            interruptButton.style.cursor = 'pointer';
        }
    }
    
    // Function to interrupt the agent - simplified to just send a text message
    async function interruptAgent() {
        if (!room || !room.localParticipant) return;
        
        try {
            logConnection('INFO', 'Sending interrupt signal to agent');
            
            // Send a simple message to stop talking
            const interruptMessage = "stop talking for now";
            
            // Send via text method (preferred method)
            try {
                await room.localParticipant.sendText(interruptMessage, {
                    topic: 'lk.chat',
                    // Add metadata to mark this as an interrupt command that shouldn't be displayed
                    attributes: {
                        'x-interrupt-command': 'true'
                    }
                });
                logConnection('DEBUG', 'Sent interrupt as text message');
            } catch (err) {
                // Fallback to data channel if text method fails
                try {
                    const data = {
                        type: 'interrupt',
                        text: interruptMessage
                    };
                    const encodedData = new TextEncoder().encode(JSON.stringify(data));
                    await room.localParticipant.publishData(encodedData, { reliable: true });
                    logConnection('DEBUG', 'Sent interrupt as data message');
                } catch (error) {
                    logConnection('ERROR', `Failed to send interrupt: ${error.message}`);
                }
            }
            
            // Log to console instead of showing UI message
            console.log('Interrupted agent');
        } catch (error) {
            logConnection('ERROR', `Failed to interrupt agent: ${error.message}`);
            console.log('Failed to interrupt agent');
        }
    }
    
    // Audio control is now handled by the agent side
});