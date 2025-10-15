import { Server } from 'socket.io';

export default function initSockets(server) {
  const io = new Server(server, {
    cors: {
      origin: process.env.CORS_ORIGIN || '*',
      methods: ['GET', 'POST']
    }
  });

  io.on('connection', (socket) => {
    console.log('🔌 A user connected:', socket.id);

    // Handle planetary grid handoff
    socket.on('gridHandoff', (data) => {
      console.log('Grid handoff request:', data);
      socket.emit('gridHandoffResponse', {
        success: true,
        nextGrid: data.nextGrid,
        handoffServer: data.handoffServer
      });
    });

    // Handle player movement
    socket.on('playerMove', (data) => {
      socket.broadcast.emit('playerMoved', data);
    });

    // Handle character updates
    socket.on('characterUpdate', (data) => {
      socket.broadcast.emit('characterUpdated', data);
    });

    // Handle chat messages
    socket.on('chatMessage', (data) => {
      io.emit('chatMessage', {
        user: data.user,
        message: data.message,
        timestamp: new Date()
      });
    });

    socket.on('disconnect', () => {
      console.log('🔌 User disconnected:', socket.id);
    });
  });

  return io;
}
