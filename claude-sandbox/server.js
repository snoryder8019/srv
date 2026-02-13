import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server as SocketIO } from 'socket.io';
import session from 'express-session';
import cors from 'cors';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';

import apiRouter from './routes/api.js';
import pagesRouter from './routes/pages.js';
import { connectDB } from './plugins/mongo.js';
import { setupSockets } from './plugins/sockets.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new SocketIO(httpServer, { cors: { origin: '*' } });

const PORT = process.env.PORT || 4000;

// --- Middleware ---
app.use(morgan('dev'));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'sandbox-secret',
  resave: false,
  saveUninitialized: false,
}));

// --- View engine ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- Static files ---
app.use(express.static(path.join(__dirname, 'public')));

// --- Routes ---
app.use('/', pagesRouter);
app.use('/api', apiRouter);

// --- Socket.IO ---
setupSockets(io);

// --- Start ---
async function start() {
  await connectDB();
  httpServer.listen(PORT, () => {
    console.log(`Claude Sandbox running on http://localhost:${PORT}`);
  });
}

start().catch(console.error);

export default app;
