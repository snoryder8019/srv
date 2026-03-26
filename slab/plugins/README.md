# Plugins README

## Purpose
This directory contains shared utilities for various functionalities used across the application.

## Key Files
- **Core Infrastructure**
  - `mongo.js`: MongoDB connections
  - `crypto.js`: AES-256-GCM encryption
  - `passport.js`: Legacy Google OAuth strategy
  - `brandContext.js`: Brand profile for LLM prompts

- **AI & Content**
  - `agentMcp.js`: Shared AI/MCP tools

- **Email & Communication**
  - `mailer.js`: Tenant-aware Zoho SMTP
  - `imapPoller.js`: Inbound email polling

- **Storage & External**
  - `s3.js`: Linode Object Storage client
  - `reviews.js`: Google Places reviews

- **Payments**
  - `stripe.js`: Stripe integration
  - `paypal.js`: PayPal integration

- **Real-Time**
  - `socketio.js`: WebRTC signaling, notes, transcription
  - `meetingNotetaker.js`: LLM-powered transcript summarization
  - `recurringCron.js`: Recurring invoice automation

- **Provisioning**
  - `provision.js`: Full tenant provisioning

## Quick Reference
- **mongo.js**: `connectDB()`, `getSlabDb()`, `getTenantDb(name)`
- **crypto.js**: `encrypt(text)`, `decrypt(blob)`
- **passport.js**: Legacy Google OAuth strategy
- **brandContext.js**: `buildBrandContext()`, `loadBrandContext()`
- **agentMcp.js**: `callLLM()`, `braveSearch()`, `tryParseAgentResponse()`, `getSuggestions()`
- **mailer.js**: Tenant-aware Zoho SMTP
- **imapPoller.js**: Inbound email polling
- **s3.js**: Linode Object Storage client
- **reviews.js**: Google Places reviews
- **stripe.js**: Stripe integration
- **paypal.js**: PayPal integration
- **socketio.js**: WebRTC signaling, notes, transcription
- **meetingNotetaker.js**: LLM-powered transcript summarization
- **recurringCron.js**: Recurring invoice automation
- **provision.js**: Full tenant provisioning