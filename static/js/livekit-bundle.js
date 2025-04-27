import { Room, RoomEvent, RemoteTrack, LocalTrack, Track, ConnectionState } from 'livekit-client';

// Initialize LiveKit client functionality when the document is ready
document.addEventListener('DOMContentLoaded', () => {
  const livekitClient = {
    room: null,
    isConnected: false,
    isRecording: false,

    // Connect to LiveKit room
    async connect(url, token) {
      try {
        // Create a new room with optimized settings
        this.room = new Room({
          adaptiveStream: true,
          dynacast: true
        });

        // Set up event listeners
        this.setupEventListeners();

        // Pre-warm connection for faster connection
        await this.room.prepareConnection(url, token);
        
        // Connect to the room
        await this.room.connect(url, token);
        
        this.isConnected = true;
        this.updateUI('connected');
        this.addMessage('System', 'Connected successfully! You can now interact with the Caila.', 'agent');
        
        return true;
      } catch (error) {
        console.error('Failed to connect to LiveKit room:', error);
        this.updateUI('disconnected');
        this.addMessage('System', 'Connection failed: ' + error.message, 'agent');
        return false;
      }
    },

    // Set up event listeners
    setupEventListeners() {
      if (!this.room) return;

      this.room
        .on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
          console.log('Track subscribed:', track.kind, 'from', participant.identity);
          
          // If audio track, attach it
          if (track.kind === Track.Kind.Audio) {
            const audioElement = track.attach();
            document.body.appendChild(audioElement);
            audioElement.style.display = 'none'; // Hide but keep audio playing
            
            this.addMessage('System', `Receiving audio from ${participant.identity}`, 'agent');
          }
        })
        .on(RoomEvent.TrackUnsubscribed, (track) => {
          // Detach track when unsubscribed
          track.detach();
        })
        .on(RoomEvent.ParticipantConnected, (participant) => {
          console.log('Participant connected:', participant.identity);
          this.addMessage('System', `${participant.identity} joined the room`, 'agent');
        })
        .on(RoomEvent.ParticipantDisconnected, (participant) => {
          console.log('Participant disconnected:', participant.identity);
          this.addMessage('System', `${participant.identity} left the room`, 'agent');
        })
        .on(RoomEvent.DataReceived, (data, participant) => {
          try {
            const decodedData = new TextDecoder().decode(data);
            const parsedData = JSON.parse(decodedData);
            
            if (parsedData.type === 'message') {
              this.addMessage('Agent', parsedData.text, 'agent');
            }
          } catch (error) {
            console.error('Error processing received data:', error);
          }
        })
        .on(RoomEvent.Disconnected, () => {
          this.isConnected = false;
          this.isRecording = false;
          this.updateUI('disconnected');
          this.addMessage('System', 'Disconnected from the voice agent.', 'agent');
        })
        .on(RoomEvent.AudioPlaybackStatusChanged, () => {
          // Handle audio playback status changes
          if (this.room.canPlaybackAudio) {
            console.log('Audio playback is now available');
          } else {
            console.log('Audio playback is not available');
          }
        });
    },

    // Disconnect from the room
    async disconnect() {
      if (this.room) {
        if (this.isRecording) {
          await this.toggleMicrophone();
        }
        
        await this.room.disconnect();
        this.room = null;
        this.isConnected = false;
        this.updateUI('disconnected');
      }
    },

    // Toggle microphone on/off
    async toggleMicrophone() {
      if (!this.room || !this.isConnected) {
        this.addMessage('System', 'Please connect first before using the microphone.', 'agent');
        return;
      }
      
      try {
        if (this.isRecording) {
          // Turn off microphone
          await this.room.localParticipant.setMicrophoneEnabled(false);
          this.isRecording = false;
          
          // Update UI
          document.getElementById('mic-button').classList.remove('active');
          document.getElementById('mic-button').innerHTML = '<i class="fas fa-microphone"></i>';
          
          this.addMessage('System', 'Microphone deactivated.', 'agent');
        } else {
          // Turn on microphone
          await this.room.localParticipant.setMicrophoneEnabled(true);
          this.isRecording = true;
          
          // Update UI
          document.getElementById('mic-button').classList.add('active');
          document.getElementById('mic-button').innerHTML = '<i class="fas fa-microphone-slash"></i>';
          
          this.addMessage('System', 'Microphone activated. Speak now...', 'agent');
        }
      } catch (error) {
        console.error('Error toggling microphone:', error);
        this.addMessage('System', 'Failed to access microphone: ' + error.message, 'agent');
      }
    },

    // Send a text message
    sendTextMessage(text) {
      if (!text || !this.room || !this.isConnected) {
        if (!this.isConnected) {
          this.addMessage('System', 'Please connect first before sending messages.', 'agent');
        }
        return;
      }
      
      // Display the message
      this.addMessage('You', text, 'user');
      
      // Send the message to the room
      const data = {
        type: 'message',
        text: text
      };
      
      // Encode and publish the data
      const encodedData = new TextEncoder().encode(JSON.stringify(data));
      this.room.localParticipant.publishData(encodedData, { reliable: true });
    },

    // Add a message to the chat container
    addMessage(sender, text, type) {
      const chatContainer = document.getElementById('chat-container');
      if (!chatContainer) return;
      
      const messageDiv = document.createElement('div');
      messageDiv.className = `message ${type}-message`;
      messageDiv.innerHTML = `
        <strong>${sender}:</strong>
        <p>${text}</p>
        <small>${new Date().toLocaleTimeString()}</small>
      `;
      
      chatContainer.appendChild(messageDiv);
      chatContainer.scrollTop = chatContainer.scrollHeight;
    },

    // Update UI based on connection status
    updateUI(status) {
      const statusIndicator = document.getElementById('status-indicator');
      const connectionStatus = document.getElementById('connection-status');
      const connectButton = document.getElementById('connect-button');
      const disconnectButton = document.getElementById('disconnect-button');
      
      if (!statusIndicator || !connectionStatus || !connectButton || !disconnectButton) return;
      
      // Update status indicator
      statusIndicator.className = '';
      statusIndicator.classList.add('status-' + status);
      
      // Update status text
      switch (status) {
        case 'disconnected':
          connectionStatus.textContent = 'Disconnected';
          connectButton.disabled = false;
          disconnectButton.disabled = true;
          break;
        case 'connecting':
          connectionStatus.textContent = 'Connecting...';
          connectButton.disabled = true;
          disconnectButton.disabled = true;
          break;
        case 'connected':
          connectionStatus.textContent = 'Connected';
          connectButton.disabled = true;
          disconnectButton.disabled = false;
          break;
      }
    },

    // Initialize the client
    init() {
      // Set up event listeners for buttons
      const connectButton = document.getElementById('connect-button');
      const disconnectButton = document.getElementById('disconnect-button');
      const micButton = document.getElementById('mic-button');
      const sendButton = document.getElementById('send-button');
      const textInput = document.getElementById('text-input');
      
      if (!connectButton || !disconnectButton || !micButton || !sendButton || !textInput) {
        console.error('Required UI elements not found');
        return;
      }
      
      // Connect button
      connectButton.addEventListener('click', async () => {
        this.updateUI('connecting');
        
        try {
          // Get token from the server
          const response = await fetch('/api/token');
          const data = await response.json();
          
          if (!data.success) {
            throw new Error(data.error || 'Failed to get token');
          }
          
          // Connect to LiveKit
          await this.connect(data.livekit_url, data.token);
        } catch (error) {
          console.error('Connection error:', error);
          this.updateUI('disconnected');
          this.addMessage('System', 'Failed to connect: ' + error.message, 'agent');
        }
      });
      
      // Disconnect button
      disconnectButton.addEventListener('click', () => {
        this.disconnect();
      });
      
      // Mic button
      micButton.addEventListener('click', () => {
        this.toggleMicrophone();
      });
      
      // Send button
      sendButton.addEventListener('click', () => {
        const text = textInput.value.trim();
        if (text) {
          this.sendTextMessage(text);
          textInput.value = '';
        }
      });
      
      // Enter key to send message
      textInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          const text = textInput.value.trim();
          if (text) {
            this.sendTextMessage(text);
            textInput.value = '';
          }
        }
      });
      
      // Initialize UI
      this.updateUI('disconnected');
      
      // Set up heartbeat
      setInterval(async () => {
        if (this.isConnected) {
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
    }
  };

  // Initialize the LiveKit client
  livekitClient.init();

  // Make the client available globally
  window.livekitClient = livekitClient;
});