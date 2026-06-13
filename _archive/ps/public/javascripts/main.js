// Initialize Socket.io
const socket = io();

socket.on('connect', () => {
  console.log('Connected to server');
});

socket.on('disconnect', () => {
  console.log('Disconnected from server');
});

// Logout function
async function logout() {
  try {
    const response = await fetch('/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      window.location.href = '/';
    }
  } catch (err) {
    console.error('Logout error:', err);
  }
}

// Chat functionality
socket.on('chatMessage', (data) => {
  console.log('Chat message:', data);
  // Handle incoming chat messages
});

// Player movement updates
socket.on('playerMoved', (data) => {
  console.log('Player moved:', data);
  // Handle player movement
});

// Character updates
socket.on('characterUpdated', (data) => {
  console.log('Character updated:', data);
  // Handle character updates
});

// Grid handoff response
socket.on('gridHandoffResponse', (data) => {
  console.log('Grid handoff:', data);
  // Handle grid transitions
});
