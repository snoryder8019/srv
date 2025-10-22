/**
 * Service Monitor Daemon
 * Continuously monitors all services and sends email notifications when services go down
 */

import { getAllAppsStatus } from './systemMonitor.js';
import nodemailer from 'nodemailer';
import { getDb } from '../plugins/mongo/mongo.js';

// Configuration
const CHECK_INTERVAL = 60000; // Check every 60 seconds
const ALERT_COOLDOWN = 300000; // Don't send repeated alerts within 5 minutes
const ALERT_EMAIL = process.env.ALERT_EMAIL || 'scott@madladslab.com';

// In-memory state for tracking service status
const serviceState = new Map();
const lastAlertTime = new Map();

/**
 * Create Zoho email transporter
 */
function createEmailTransporter() {
  return nodemailer.createTransport({
    host: 'smtp.zoho.com',
    port: 465,
    secure: true,
    auth: {
      user: process.env.ZOHO_USER,
      pass: process.env.ZOHO_PASS,
    },
  });
}

/**
 * Send alert email when a service goes down
 */
async function sendServiceDownAlert(serviceName, currentStatus, previousStatus) {
  try {
    const transporter = createEmailTransporter();

    const timestamp = new Date().toLocaleString('en-US', {
      timeZone: 'America/New_York',
      dateStyle: 'full',
      timeStyle: 'long'
    });

    const emailBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
        <div style="background-color: #ff375f; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; font-size: 24px;">🚨 Service Alert: ${serviceName} is DOWN</h1>
        </div>

        <div style="background-color: white; padding: 20px; border-radius: 0 0 8px 8px;">
          <p style="font-size: 16px; color: #333; margin-bottom: 20px;">
            <strong>Service Name:</strong> ${serviceName}<br>
            <strong>Status:</strong> <span style="color: #ff375f; font-weight: bold;">${currentStatus.status.toUpperCase()}</span><br>
            <strong>Time:</strong> ${timestamp}
          </p>

          <div style="background-color: #ffe8ec; padding: 15px; border-left: 4px solid #ff375f; margin: 20px 0;">
            <h3 style="margin: 0 0 10px 0; color: #ff375f;">Details:</h3>
            <ul style="margin: 0; padding-left: 20px; color: #333;">
              <li><strong>Domain:</strong> ${currentStatus.domain || 'N/A'}</li>
              <li><strong>Port:</strong> ${currentStatus.port || 'N/A'}</li>
              <li><strong>Process Running:</strong> ${currentStatus.running ? 'Yes' : 'No'}</li>
              <li><strong>Port Listening:</strong> ${currentStatus.port?.listening ? 'Yes' : 'No'}</li>
              <li><strong>Health Check:</strong> ${currentStatus.health?.responding ? 'Responding' : 'Not Responding'}</li>
            </ul>
          </div>

          ${currentStatus.health?.error ? `
          <div style="background-color: #fff3cd; padding: 15px; border-left: 4px solid #ff9500; margin: 20px 0;">
            <h3 style="margin: 0 0 10px 0; color: #ff9500;">Error Details:</h3>
            <p style="margin: 0; font-family: monospace; color: #333;">${currentStatus.health.error}</p>
          </div>
          ` : ''}

          ${previousStatus ? `
          <div style="background-color: #e8f5e9; padding: 15px; border-left: 4px solid #00ff88; margin: 20px 0;">
            <h3 style="margin: 0 0 10px 0; color: #00a859;">Previous Status:</h3>
            <p style="margin: 0; color: #333;"><strong>${previousStatus.status.toUpperCase()}</strong> at ${new Date(previousStatus.lastChecked).toLocaleString()}</p>
          </div>
          ` : ''}

          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
            <p style="margin: 0; color: #666; font-size: 14px;">
              <strong>Action Required:</strong> Please check the service logs and restart if necessary.
            </p>
            <p style="margin: 10px 0 0 0; color: #666; font-size: 14px;">
              Monitor Dashboard: <a href="https://madladslab.com/admin/monitor" style="color: #00a859;">https://madladslab.com/admin/monitor</a>
            </p>
          </div>
        </div>

        <div style="text-align: center; margin-top: 20px; padding: 10px; color: #888; font-size: 12px;">
          <p>MadLadsLab Service Monitor | Automated Alert System</p>
        </div>
      </div>
    `;

    await transporter.sendMail({
      from: process.env.ZOHO_USER,
      to: ALERT_EMAIL,
      subject: `🚨 ALERT: ${serviceName} Service is DOWN`,
      html: emailBody,
    });

    console.log(`✓ Alert email sent for ${serviceName} to ${ALERT_EMAIL}`);
    return true;
  } catch (error) {
    console.error(`✗ Failed to send alert email for ${serviceName}:`, error.message);
    return false;
  }
}

/**
 * Send recovery email when a service comes back up
 */
async function sendServiceRecoveryAlert(serviceName, currentStatus) {
  try {
    const transporter = createEmailTransporter();

    const timestamp = new Date().toLocaleString('en-US', {
      timeZone: 'America/New_York',
      dateStyle: 'full',
      timeStyle: 'long'
    });

    const emailBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
        <div style="background-color: #00ff88; color: #000; padding: 20px; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; font-size: 24px;">✅ Service Recovered: ${serviceName} is UP</h1>
        </div>

        <div style="background-color: white; padding: 20px; border-radius: 0 0 8px 8px;">
          <p style="font-size: 16px; color: #333; margin-bottom: 20px;">
            <strong>Service Name:</strong> ${serviceName}<br>
            <strong>Status:</strong> <span style="color: #00a859; font-weight: bold;">${currentStatus.status.toUpperCase()}</span><br>
            <strong>Recovery Time:</strong> ${timestamp}
          </p>

          <div style="background-color: #e8f5e9; padding: 15px; border-left: 4px solid #00ff88; margin: 20px 0;">
            <h3 style="margin: 0 0 10px 0; color: #00a859;">Service Details:</h3>
            <ul style="margin: 0; padding-left: 20px; color: #333;">
              <li><strong>Domain:</strong> ${currentStatus.domain || 'N/A'}</li>
              <li><strong>Port:</strong> ${currentStatus.port || 'N/A'}</li>
              <li><strong>Response Time:</strong> ${currentStatus.health?.responseTime || 'N/A'}ms</li>
              <li><strong>Status Code:</strong> ${currentStatus.health?.statusCode || 'N/A'}</li>
            </ul>
          </div>

          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
            <p style="margin: 0; color: #666; font-size: 14px;">
              ✓ The service has recovered and is now responding normally.
            </p>
          </div>
        </div>

        <div style="text-align: center; margin-top: 20px; padding: 10px; color: #888; font-size: 12px;">
          <p>MadLadsLab Service Monitor | Automated Alert System</p>
        </div>
      </div>
    `;

    await transporter.sendMail({
      from: process.env.ZOHO_USER,
      to: ALERT_EMAIL,
      subject: `✅ RECOVERY: ${serviceName} Service is UP`,
      html: emailBody,
    });

    console.log(`✓ Recovery email sent for ${serviceName} to ${ALERT_EMAIL}`);
    return true;
  } catch (error) {
    console.error(`✗ Failed to send recovery email for ${serviceName}:`, error.message);
    return false;
  }
}

/**
 * Log service status to database
 */
async function logServiceStatus(serviceName, status) {
  try {
    const db = await getDb();
    await db.collection('service_monitor_logs').insertOne({
      serviceName,
      status: status.status,
      running: status.running,
      port: status.port,
      domain: status.domain,
      health: status.health,
      timestamp: new Date(),
      details: {
        tmux: status.tmux,
        resources: status.resources
      }
    });
  } catch (error) {
    console.error(`Error logging status for ${serviceName}:`, error.message);
  }
}

/**
 * Check if we should send an alert (respects cooldown period)
 */
function shouldSendAlert(serviceName) {
  const lastAlert = lastAlertTime.get(serviceName);
  if (!lastAlert) return true;

  const timeSinceLastAlert = Date.now() - lastAlert;
  return timeSinceLastAlert >= ALERT_COOLDOWN;
}

/**
 * Main monitoring loop
 */
async function checkServices() {
  try {
    const services = await getAllAppsStatus();

    for (const service of services) {
      const previousState = serviceState.get(service.appName);
      const isCurrentlyDown = service.status !== 'healthy';
      const wasDown = previousState && previousState.status !== 'healthy';

      // Service went down
      if (isCurrentlyDown && !wasDown) {
        console.log(`🚨 SERVICE DOWN: ${service.appName} (${service.status})`);

        if (shouldSendAlert(service.appName)) {
          await sendServiceDownAlert(service.appName, service, previousState);
          lastAlertTime.set(service.appName, Date.now());
        }

        await logServiceStatus(service.appName, service);
      }
      // Service recovered
      else if (!isCurrentlyDown && wasDown) {
        console.log(`✅ SERVICE RECOVERED: ${service.appName}`);
        await sendServiceRecoveryAlert(service.appName, service);
        await logServiceStatus(service.appName, service);
        lastAlertTime.delete(service.appName); // Clear cooldown on recovery
      }
      // Service still down - log every check but respect email cooldown
      else if (isCurrentlyDown && wasDown) {
        await logServiceStatus(service.appName, service);

        // Send reminder email if cooldown has passed
        if (shouldSendAlert(service.appName)) {
          console.log(`🚨 SERVICE STILL DOWN: ${service.appName} - Sending reminder`);
          await sendServiceDownAlert(service.appName, service, previousState);
          lastAlertTime.set(service.appName, Date.now());
        }
      }

      // Update state
      serviceState.set(service.appName, service);
    }
  } catch (error) {
    console.error('Error in monitoring check:', error);
  }
}

/**
 * Start the monitoring daemon
 */
export function startMonitoring() {
  console.log('🔍 Service Monitor Daemon Starting...');
  console.log(`   Check Interval: ${CHECK_INTERVAL / 1000}s`);
  console.log(`   Alert Cooldown: ${ALERT_COOLDOWN / 60000} minutes`);
  console.log(`   Alert Email: ${ALERT_EMAIL}`);

  // Initial check
  checkServices();

  // Start interval
  const intervalId = setInterval(checkServices, CHECK_INTERVAL);

  console.log('✓ Service Monitor Daemon is running');

  return intervalId;
}

/**
 * Stop the monitoring daemon
 */
export function stopMonitoring(intervalId) {
  if (intervalId) {
    clearInterval(intervalId);
    console.log('Service Monitor Daemon stopped');
  }
}

/**
 * Get current service states
 */
export function getServiceStates() {
  return Array.from(serviceState.entries()).map(([name, status]) => ({
    name,
    status,
    lastAlert: lastAlertTime.get(name) || null
  }));
}

export default {
  startMonitoring,
  stopMonitoring,
  getServiceStates
};
