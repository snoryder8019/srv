import http from 'http';
import app from '../app.js';
import { attachSockets } from '../lib/socket.js';
import { startUplandMailListener } from '../lib/zoho-imap.js';

const PORT = parseInt(process.env.PORT || '3608', 10);
const HOST = process.env.HOST || '127.0.0.1';

const server = http.createServer(app);
const io = attachSockets(server);
app.set('io', io);

server.listen(PORT, HOST, () => {
  console.log(`[mllPitches] listening on http://${HOST}:${PORT}`);
});

startUplandMailListener(io).catch((err) => {
  console.warn('[mllPitches] upland mail listener disabled:', err?.message || err);
});
