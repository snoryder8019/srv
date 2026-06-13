/**
 * Global Chat Window
 * Real-time chat for all players using Socket.IO
 */

class GlobalChat {
  constructor(socket, user, character) {
    this.socket = socket;
    this.user = user;
    this.character = character;
    this.messages = [];
    this.maxMessages = 100;

    this.createChatWindow();
    this.attachEventListeners();
    this.attachSocketListeners();
  }

  createChatWindow() {
    const chatWindow = document.createElement('div');
    chatWindow.id = 'global-chat-window';
    chatWindow.className = 'global-chat-window hidden';
    chatWindow.innerHTML = `
      <div class="chat-header">
        <div class="chat-title">
          <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
            <path d="M2 5a2 2 0 012-2h7a2 2 0 012 2v4a2 2 0 01-2 2H9l-3 3v-3H4a2 2 0 01-2-2V5z"/>
            <path d="M15 7v2a4 4 0 01-4 4H9.828l-1.766 1.767c.28.149.599.233.938.233h2l3 3v-3h2a2 2 0 002-2V9a2 2 0 00-2-2h-1z"/>
          </svg>
          <span>Global Chat</span>
          <span class="chat-online-count" id="chat-online-count">0 online</span>
        </div>
        <button class="chat-close-btn" onclick="globalChat.toggleChat()">&times;</button>
      </div>
      <div class="chat-messages" id="chat-messages">
        <div class="chat-welcome">
          <p>Welcome to the global chat! Press Enter to send messages.</p>
        </div>
      </div>
      <div class="chat-input-container">
        <input type="text" id="chat-input" placeholder="Type a message..." maxlength="500">
        <button id="chat-send-btn" class="chat-send-btn">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z"/>
          </svg>
        </button>
      </div>
    `;

    document.body.appendChild(chatWindow);
    this.chatWindow = chatWindow;
    this.messagesContainer = document.getElementById('chat-messages');
    this.input = document.getElementById('chat-input');
  }

  attachEventListeners() {
    // Send button
    document.getElementById('chat-send-btn').addEventListener('click', () => {
      this.sendMessage();
    });

    // Enter key
    this.input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.sendMessage();
      }
    });
  }

  attachSocketListeners() {
    // Receive chat messages
    this.socket.on('chatMessage', (data) => {
      this.addMessage(data);
    });

    // Player joined notification
    this.socket.on('characterJoined', (data) => {
      this.addSystemMessage(`${data.characterName} entered the universe`);
    });

    // Player left notification
    this.socket.on('characterLeft', (data) => {
      this.addSystemMessage(`${data.characterName} left the universe`);
    });

    // Update online count
    this.socket.on('onlineCount', (count) => {
      document.getElementById('chat-online-count').textContent = `${count} online`;
    });
  }

  sendMessage() {
    const message = this.input.value.trim();
    if (!message) return;

    // Send via socket
    this.socket.emit('chatMessage', {
      user: this.user.username,
      characterName: this.character?.name || this.user.username,
      message: message,
      userId: this.user._id || this.user.id,
      characterId: this.character?._id
    });

    // Clear input
    this.input.value = '';
  }

  addMessage(data) {
    const messageEl = document.createElement('div');
    messageEl.className = 'chat-message';

    const isOwnMessage = data.userId === (this.user._id || this.user.id);
    if (isOwnMessage) {
      messageEl.classList.add('own-message');
    }

    const timestamp = data.timestamp ? new Date(data.timestamp) : new Date();
    const timeStr = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    messageEl.innerHTML = `
      <div class="chat-message-header">
        <span class="chat-username">${data.characterName || data.user}</span>
        <span class="chat-timestamp">${timeStr}</span>
      </div>
      <div class="chat-message-content">${this.escapeHtml(data.message)}</div>
    `;

    this.messagesContainer.appendChild(messageEl);
    this.scrollToBottom();

    // Keep only last N messages
    this.messages.push(data);
    if (this.messages.length > this.maxMessages) {
      this.messages.shift();
      this.messagesContainer.removeChild(this.messagesContainer.firstChild);
    }
  }

  addSystemMessage(message) {
    const messageEl = document.createElement('div');
    messageEl.className = 'chat-message system-message';
    messageEl.innerHTML = `
      <div class="chat-message-content">
        <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/>
        </svg>
        ${message}
      </div>
    `;

    this.messagesContainer.appendChild(messageEl);
    this.scrollToBottom();
  }

  scrollToBottom() {
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  toggleChat() {
    this.chatWindow.classList.toggle('hidden');
    if (!this.chatWindow.classList.contains('hidden')) {
      this.input.focus();
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Global instance
let globalChat = null;

function initGlobalChat(socket, user, character) {
  if (!globalChat) {
    globalChat = new GlobalChat(socket, user, character);
  }
  return globalChat;
}
