# Claude Sandbox

A lightweight sandbox environment for prototyping and testing features for MadLabs Lab services.

## Tech Stack

- **Runtime**: Node.js (ESM)
- **Framework**: Express 4
- **View Engine**: EJS
- **Database**: MongoDB / Mongoose
- **Real-time**: Socket.IO
- **Session**: express-session

## Quick Start

```bash
cp .env.example .env
npm install
npm run dev
```

Open [http://localhost:4000](http://localhost:4000).

## Project Structure

```
claude-sandbox/
  server.js          # Entry point
  routes/
    api.js           # REST API endpoints
    pages.js         # Page rendering routes
  plugins/
    mongo.js         # MongoDB connection
    sockets.js       # Socket.IO event handlers
  views/
    index.ejs        # Main page template
  public/
    css/style.css    # Styles
    js/main.js       # Client-side JS
  tests/
    api.test.js      # Node test runner tests
```

## API Endpoints

| Method | Path              | Description          |
|--------|-------------------|----------------------|
| GET    | `/api/health`     | Health check         |
| POST   | `/api/echo`       | Echo request body    |
| GET    | `/api/store/:key` | Get value by key     |
| PUT    | `/api/store/:key` | Set value for key    |
| DELETE | `/api/store/:key` | Delete value by key  |

## Socket.IO Events

| Event  | Direction       | Description          |
|--------|-----------------|----------------------|
| `ping` | client -> server | Send ping with data |
| `pong` | server -> client | Response with echo  |
