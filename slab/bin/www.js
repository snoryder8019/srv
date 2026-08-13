import '../plugins/secretGuard.js'; // FIRST — redact key-shaped secrets from all console output before anything logs
import http from 'http';
import app from '../app.js';
import { config } from '../config/config.js';
import { initSocketIO } from '../plugins/socketio.js';
import { startRecurringInvoiceCron } from '../plugins/recurringCron.js';
import { startSocialScheduler, startSocialTokenRefresh, startAutoSocialCron, startSocialScoring, reapAllSocialJobs, reapStuckSocialPosts } from '../plugins/socialCron.js';
import { startBlogScheduler } from '../plugins/blogSchedule.js';
import { startCampaignScheduler } from '../plugins/campaignSchedule.js';
import { startImapPoller } from '../plugins/imapPoller.js';
import { startSubscriptionSweep } from '../plugins/subscriptionCron.js';

const port = config.PORT || 3601;
const server = http.createServer(app);

initSocketIO(server);

server.listen(port, () => {
  console.log(`[slab] Running on port ${port}`);
  startRecurringInvoiceCron();
  startSocialScheduler();
  startSocialTokenRefresh();
  startAutoSocialCron();
  startSocialScoring();
  startBlogScheduler();
  startCampaignScheduler();
  setTimeout(() => { reapAllSocialJobs(); reapStuckSocialPosts(); }, 20000);   // after DB connect settles
  startImapPoller();
  startSubscriptionSweep();
});
