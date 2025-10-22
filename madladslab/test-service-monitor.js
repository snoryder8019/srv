/**
 * Test Service Monitor
 * This script tests the service monitoring and email alert functionality
 */

import dotenv from 'dotenv';
dotenv.config();

import { getAllAppsStatus } from './lib/systemMonitor.js';
import nodemailer from 'nodemailer';

async function testMonitoringSystem() {
  console.log('=== Service Monitor Test ===\n');

  // Test 1: Check all services
  console.log('1. Fetching status of all services...');
  const services = await getAllAppsStatus();

  console.log(`\nFound ${services.length} services:\n`);

  services.forEach(service => {
    const statusIcon = service.status === 'healthy' ? '✅' :
                       service.status === 'unhealthy' ? '⚠️' : '❌';
    console.log(`${statusIcon} ${service.appName.padEnd(20)} - ${service.status.toUpperCase()}`);
    console.log(`   Port: ${service.port}, Running: ${service.running}, Domain: ${service.domain}`);
  });

  // Test 2: Find a service that is down
  const downService = services.find(s => s.status !== 'healthy');

  if (downService) {
    console.log(`\n2. Testing email alert for down service: ${downService.appName}`);
    await sendTestAlert(downService);
  } else {
    console.log('\n2. All services are healthy! Simulating a down service alert...');
    const testService = services[0];
    const simulatedDownService = {
      ...testService,
      status: 'stopped',
      running: false,
      health: {
        responding: false,
        error: 'Simulated failure for testing'
      }
    };
    await sendTestAlert(simulatedDownService);
  }

  console.log('\n=== Test Complete ===');
}

async function sendTestAlert(service) {
  try {
    const transporter = nodemailer.createTransport({
      host: 'smtp.zoho.com',
      port: 465,
      secure: true,
      auth: {
        user: process.env.ZOHO_USER,
        pass: process.env.ZOHO_PASS,
      },
    });

    const timestamp = new Date().toLocaleString('en-US', {
      timeZone: 'America/New_York',
      dateStyle: 'full',
      timeStyle: 'long'
    });

    const emailBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
        <div style="background-color: #ff375f; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; font-size: 24px;">🧪 TEST ALERT: ${service.appName}</h1>
        </div>

        <div style="background-color: white; padding: 20px; border-radius: 0 0 8px 8px;">
          <p style="font-size: 16px; color: #333; margin-bottom: 20px;">
            This is a <strong>TEST EMAIL</strong> from the Service Monitor system.<br><br>
            <strong>Service Name:</strong> ${service.appName}<br>
            <strong>Status:</strong> <span style="color: #ff375f; font-weight: bold;">${service.status.toUpperCase()}</span><br>
            <strong>Time:</strong> ${timestamp}
          </p>

          <div style="background-color: #ffe8ec; padding: 15px; border-left: 4px solid #ff375f; margin: 20px 0;">
            <h3 style="margin: 0 0 10px 0; color: #ff375f;">Service Details:</h3>
            <ul style="margin: 0; padding-left: 20px; color: #333;">
              <li><strong>Domain:</strong> ${service.domain || 'N/A'}</li>
              <li><strong>Port:</strong> ${service.port || 'N/A'}</li>
              <li><strong>Process Running:</strong> ${service.running ? 'Yes' : 'No'}</li>
              <li><strong>Health Check:</strong> ${service.health?.responding ? 'Responding' : 'Not Responding'}</li>
            </ul>
          </div>

          <div style="background-color: #e3f2fd; padding: 15px; border-left: 4px solid #2196f3; margin: 20px 0;">
            <h3 style="margin: 0 0 10px 0; color: #2196f3;">✅ Email System Working</h3>
            <p style="margin: 0; color: #333;">
              The service monitoring and email alert system is functioning correctly.
              You will receive similar emails when services go down or recover.
            </p>
          </div>

          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
            <p style="margin: 0; color: #666; font-size: 14px;">
              Monitor Dashboard: <a href="https://madladslab.com/admin/monitor" style="color: #00a859;">https://madladslab.com/admin/monitor</a>
            </p>
          </div>
        </div>

        <div style="text-align: center; margin-top: 20px; padding: 10px; color: #888; font-size: 12px;">
          <p>MadLadsLab Service Monitor | Test Email</p>
        </div>
      </div>
    `;

    const result = await transporter.sendMail({
      from: process.env.ZOHO_USER,
      to: process.env.ALERT_EMAIL || 'scott@madladslab.com',
      subject: `🧪 TEST: Service Monitor Alert for ${service.appName}`,
      html: emailBody,
    });

    console.log(`\n✅ Test email sent successfully!`);
    console.log(`   To: ${process.env.ALERT_EMAIL || 'scott@madladslab.com'}`);
    console.log(`   Message ID: ${result.messageId}`);
    console.log(`   Response: ${result.response}`);

  } catch (error) {
    console.error(`\n❌ Failed to send test email:`, error.message);
  }
}

// Run the test
testMonitoringSystem().catch(console.error);
