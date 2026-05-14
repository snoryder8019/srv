import http from 'http';
import app from '../app.js';
import { config } from '../config/config.js';
import { initSocketIO } from '../plugins/socketio.js';

const port = config.PORT;
const server = http.createServer(app);

initSocketIO(server);

server.listen(port, () => {
  console.log(`[familyCalendar] Running on port ${port}`);
});
