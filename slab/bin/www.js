import http from 'http';
import app from '../app.js';
import { config } from '../config/config.js';
import { initSocketIO } from '../plugins/socketio.js';
import { startRecurringInvoiceCron } from '../plugins/recurringCron.js';
import { startImapPoller } from '../plugins/imapPoller.js';

const port = config.PORT || 3601;
const server = http.createServer(app);

initSocketIO(server);

server.listen(port, () => {
  console.log(`[slab] Running on port ${port}`);
  startRecurringInvoiceCron();
  startImapPoller();
});
