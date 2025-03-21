import nodemailer from 'nodemailer';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { getDb } from '../mongo/mongo.js';
import { config } from '../../config/config.js';
import querystring from 'querystring';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const emailHeaderUrl = `${config.baseUrl}images/logoTransp.png`;
////////////////////////////////
let transporter = null;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'Gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS,
      },
    });
  }
  return transporter;
}

export const sendDynamicEmail = async (to, emailType, user, dynamicLink) => {
  // Removed the call to initializeTransporter() as it's unnecessary for a Gmail setup
  const settings = {
    confirmation: {
      subject: 'Confirm Your Email',
      templateName: 'confirmation.html',
    },
    passwordReset: {
      subject: 'Password Reset Instructions',
      templateName: 'passwordReset.html',
    },
    orderComplete: {
      subject: 'Your Order is Complete',
      templateName: 'orderComplete.html',
    },
    orderNotify: {
      subject: 'You have a new Order',
      templateName: 'orderNotify.html',
    },
    ticketAdded: {
      subject: 'New Ticket Opened',
      templateName: 'newTicket.html',
    },
    general: {
      subject: 'Mad Lads Lab sent you a message',
      templateName: 'generalBody.html',
    },
  }[emailType];

  if (!settings) throw new Error(`Unknown email type: ${emailType}`);

  const templatePath = path.join(__dirname, 'templates', settings.templateName);  let htmlTemplate = fs
    .readFileSync(templatePath, 'utf8')
    .replace('{firstName}', user.firstName)
    .replace('{dynamicLink}', dynamicLink)
    .replace('{emailheader}', emailHeaderUrl);

  const mailOptions = {
    from: process.env.GMAIL_USER,
    to: to,
    subject: settings.subject,
    html: htmlTemplate,
  };

  // Use the singleton transporter
  const emailTransporter = getTransporter();
  return emailTransporter.sendMail(mailOptions);
};


export const oauthCallbackHandler = async (req, res) => {
  const requestBody = querystring.stringify({
    client_id: process.env.MS_CID,
    client_secret: process.env.MS_SEC_VALUE,
    code: req.query.code,
    redirect_uri: 'http://localhost:3000/oauth/callback',
    grant_type: 'authorization_code',
  });

  try {
    const response = await axios.post(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      requestBody,
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }
    );
    const { token_type, scope, access_token, refresh_token, expiresIn } =
      response.data;
    const db = await getDb();
    await db.collection('tokens').updateOne(
      {},
      {
        $set: {
          name: 'access_tokens',
          token_type,
          scope,
          access_token,
          refresh_token,

          expires: new Date(Date.now() + expiresIn * 1000),
        },
      },
      { upsert: true }
    );
    res.send('Authorization successful. Tokens updated in the database.');
  } catch (error) {
    console.error('Error exchanging authorization code:', error);
    res.status(500).send('Failed to exchange authorization code.');
  }
};

export const emailOutGeneral = async (req, res) => {
  try {
    const { to, emailBody, username } = req.body;

    // Read the email template
    const templatePath = path.join(__dirname, 'templates', 'generalBody.html');
    const htmlTemplate = fs
      .readFileSync(templatePath, 'utf8')
      .replace('{dynamicBody}', emailBody)
      .replace('{dynamicLink}', 'https://madladslab.com')
      .replace(
        '{unsubscribeLink}',
        'https://madladslab.com/unsubscribe'
      ); // Assuming you have an unsubscribe link

    // Create nodemailer transporter
    const transporter = nodemailer.createTransport({
      service: 'Gmail', // Update with your email service provider
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS,
      },
    });

    // Set mail options
    const mailOptions = {
      from: process.env.GMAIL_USER, // Sender's email address
      to: to, // Recipient's email address
      subject: 'Message from madLadsLab', // Email subject
      html: htmlTemplate, // Email content
    };

    // Send email
    await transporter.sendMail(mailOptions);

    // Send a response indicating that the email was sent successfully
    res.status(200).send('Email sent successfully.');
  } catch (error) {
    console.error(`Error sending email: ${error}`);
    res.status(500).send(`Error sending email: ${error}`);
  }
};