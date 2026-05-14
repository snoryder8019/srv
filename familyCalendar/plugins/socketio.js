import { Server } from 'socket.io';

let io;

export function initSocketIO(server) {
  io = new Server(server, {
    cors: { origin: true, credentials: true },
  });

  io.on('connection', (socket) => {
    socket.on('family:join', (familyId) => {
      if (familyId) socket.join(`family:${familyId}`);
    });
  });
}

export function emitFamily(familyId, event, payload) {
  if (!io) return;
  io.to(`family:${familyId}`).emit(event, payload);
}
