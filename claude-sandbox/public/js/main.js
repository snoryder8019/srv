// Health check
fetch('/api/health')
  .then(r => r.json())
  .then(data => {
    document.getElementById('health').textContent =
      `Status: ${data.status} | Uptime: ${Math.round(data.uptime)}s | ${data.timestamp}`;
  })
  .catch(() => {
    document.getElementById('health').textContent = 'Failed to reach API';
  });

// Socket.IO
const socket = io();
const log = document.getElementById('socket-log');

function appendLog(msg) {
  log.textContent += msg + '\n';
  log.scrollTop = log.scrollHeight;
}

socket.on('connect', () => appendLog(`Connected: ${socket.id}`));
socket.on('pong', (data) => appendLog(`Pong: ${JSON.stringify(data)}`));
socket.on('disconnect', () => appendLog('Disconnected'));

document.getElementById('ping-btn').addEventListener('click', () => {
  const msg = { time: Date.now() };
  appendLog(`Ping: ${JSON.stringify(msg)}`);
  socket.emit('ping', msg);
});
