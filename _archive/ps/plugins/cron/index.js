import cron from 'node-cron';
import generateDocsTree from '../../scripts/generate-docs-tree.js';
import updatePatchNotes from '../../scripts/update-patch-notes.js';
import { cleanupExpiredTokens, createActivityTokenIndexes } from '../../utilities/activityTokens.js';

/**
 * Cron Job Plugin
 *
 * Manages scheduled tasks for the Stringborn Universe application.
 * Uses node-cron for task scheduling with cron expression syntax.
 *
 * Cron Expression Format:
 * * * * * * *
 * | | | | | |
 * | | | | | day of week (0-7, 0 or 7 is Sunday)
 * | | | | month (1-12)
 * | | | day of month (1-31)
 * | | hour (0-23)
 * | minute (0-59)
 * second (optional, 0-59)
 */

const jobs = [];
const jobHistory = [];

/**
 * Log job execution to history
 */
function logJobExecution(jobName, success, message = '', duration = 0) {
  const entry = {
    jobName,
    success,
    message,
    duration,
    timestamp: new Date().toISOString()
  };

  jobHistory.unshift(entry);

  // Keep only last 100 entries
  if (jobHistory.length > 100) {
    jobHistory.pop();
  }

  // Detailed console logging
  const emoji = success ? '✅' : '❌';
  const status = success ? 'SUCCESS' : 'FAILED';
  console.log(`${emoji} CRON [${jobName}] ${status} - ${duration}ms`);
  if (message) {
    console.log(`   └─ ${message}`);
  }

  return entry;
}

/**
 * Initialize cron jobs
 */
export function initializeCronJobs() {
  console.log('🕐 Initializing cron jobs...');

  // Documentation Tree Update
  // Runs every day at 3:00 AM
  const docsUpdateJob = cron.schedule('0 3 * * *', async () => {
    const startTime = Date.now();
    console.log('📚 Running scheduled documentation tree update...');
    try {
      const result = await generateDocsTree();
      const duration = Date.now() - startTime;
      const message = `Generated tree with ${result.totalFiles} files in ${result.categories.length} categories`;
      logJobExecution('Documentation Tree Update', true, message, duration);
    } catch (error) {
      const duration = Date.now() - startTime;
      logJobExecution('Documentation Tree Update', false, error.message, duration);
      console.error('❌ Error updating documentation tree via cron:', error);
    }
  }, {
    scheduled: true,
    timezone: "America/New_York" // Adjust to your timezone
  });

  jobs.push({
    name: 'Documentation Tree Update',
    schedule: '0 3 * * *',
    description: 'Updates documentation tree daily at 3:00 AM',
    job: docsUpdateJob
  });

  // Patch Notes Update
  // Runs every day at 3:30 AM (30 minutes after docs update)
  const patchNotesUpdateJob = cron.schedule('30 3 * * *', async () => {
    const startTime = Date.now();
    console.log('📝 Running scheduled patch notes update...');
    try {
      await updatePatchNotes();
      const duration = Date.now() - startTime;
      logJobExecution('Patch Notes Update', true, 'Patch notes index and changelog updated', duration);
    } catch (error) {
      const duration = Date.now() - startTime;
      logJobExecution('Patch Notes Update', false, error.message, duration);
      console.error('❌ Error updating patch notes via cron:', error);
    }
  }, {
    scheduled: true,
    timezone: "America/New_York"
  });

  jobs.push({
    name: 'Patch Notes Update',
    schedule: '30 3 * * *',
    description: 'Updates patch notes index and changelog daily at 3:30 AM',
    job: patchNotesUpdateJob
  });

  // Activity Token Cleanup
  // Runs every 15 minutes to clean up expired tokens
  const tokenCleanupJob = cron.schedule('*/15 * * * *', async () => {
    const startTime = Date.now();
    console.log('🧹 Running activity token cleanup...');
    try {
      const result = await cleanupExpiredTokens();
      const duration = Date.now() - startTime;
      const removed = result?.deletedCount || 0;
      logJobExecution('Activity Token Cleanup', true, `Removed ${removed} expired tokens`, duration);
    } catch (error) {
      const duration = Date.now() - startTime;
      logJobExecution('Activity Token Cleanup', false, error.message, duration);
      console.error('❌ Error cleaning up activity tokens:', error);
    }
  }, {
    scheduled: true,
    timezone: "America/New_York"
  });

  jobs.push({
    name: 'Activity Token Cleanup',
    schedule: '*/15 * * * *',
    description: 'Cleans up expired activity tokens every 15 minutes',
    job: tokenCleanupJob
  });

  console.log(`✅ Initialized ${jobs.length} cron job(s):`);
  jobs.forEach(job => {
    console.log(`   - ${job.name}: ${job.schedule}`);
    console.log(`     ${job.description}`);
  });

  // Generate docs tree immediately on startup
  console.log('📚 Generating documentation tree on startup...');
  generateDocsTree()
    .then(() => console.log('✅ Initial documentation tree generated'))
    .catch(error => console.error('❌ Error generating initial documentation tree:', error));

  // Update patch notes immediately on startup
  console.log('📝 Updating patch notes on startup...');
  updatePatchNotes()
    .then(() => console.log('✅ Initial patch notes update complete'))
    .catch(error => console.error('❌ Error updating patch notes on startup:', error));

  // Create activity token indexes on startup (with delay to ensure DB is connected)
  setTimeout(() => {
    console.log('📊 Creating activity token database indexes...');
    createActivityTokenIndexes()
      .then(() => console.log('✅ Activity token indexes created'))
      .catch(error => console.error('❌ Error creating activity token indexes:', error));
  }, 2000); // Wait 2 seconds for DB connection

  return jobs;
}

/**
 * Stop all cron jobs
 */
export function stopAllJobs() {
  console.log('🛑 Stopping all cron jobs...');
  jobs.forEach(({ name, job }) => {
    job.stop();
    console.log(`   - Stopped: ${name}`);
  });
}

/**
 * Get status of all jobs
 */
export function getJobsStatus() {
  return jobs.map(({ name, schedule, description, job }) => ({
    name,
    schedule,
    description,
    running: job.getStatus() !== 'stopped'
  }));
}

/**
 * Get job execution history
 */
export function getJobHistory(limit = 20) {
  return jobHistory.slice(0, limit);
}

/**
 * Get latest execution for each job
 */
export function getLatestExecutions() {
  const latest = {};
  for (const entry of jobHistory) {
    if (!latest[entry.jobName]) {
      latest[entry.jobName] = entry;
    }
  }
  return latest;
}

/**
 * Manually trigger a job by name
 */
export async function triggerJob(jobName) {
  console.log(`🔄 Manually triggering job: ${jobName}`);

  switch (jobName) {
    case 'Documentation Tree Update':
      await generateDocsTree();
      break;
    case 'Patch Notes Update':
      await updatePatchNotes();
      break;
    case 'Activity Token Cleanup':
      await cleanupExpiredTokens();
      break;
    default:
      throw new Error(`Unknown job: ${jobName}`);
  }
}

export default {
  initializeCronJobs,
  stopAllJobs,
  getJobsStatus,
  getJobHistory,
  getLatestExecutions,
  triggerJob
};
