import { Server } from 'socket.io';

// Track online players
const onlinePlayers = new Map(); // socketId -> { characterId, characterName, userId, location }

export default function initSockets(server) {
  const io = new Server(server, {
    cors: {
      origin: process.env.CORS_ORIGIN || '*',
      methods: ['GET', 'POST']
    }
  });

  io.on('connection', (socket) => {
    console.log('🔌 A user connected:', socket.id);

    // Send current online count
    io.emit('onlineCount', onlinePlayers.size);

    // Handle character joining (entering the universe)
    socket.on('characterJoin', (data) => {
      console.log('🎯 Character joined:', data.characterId, 'name:', data.characterName, 'userId:', data.userId, 'at asset:', data.assetId);
      socket.characterId = data.characterId;
      socket.characterName = data.characterName;
      socket.userId = data.userId;

      // Add to online players registry
      onlinePlayers.set(socket.id, {
        socketId: socket.id,
        characterId: data.characterId,
        characterName: data.characterName,
        userId: data.userId,
        location: data.location,
        assetId: data.assetId,
        stringDomain: data.stringDomain || 'Time String',
        joinedAt: new Date()
      });

      // Broadcast to all other players
      socket.broadcast.emit('characterJoined', {
        characterId: data.characterId,
        characterName: data.characterName,
        location: data.location,
        assetId: data.assetId,
        stringDomain: data.stringDomain || 'Time String',
        timestamp: new Date()
      });

      // Send updated online count
      io.emit('onlineCount', onlinePlayers.size);

      // Send list of all online players to newly joined player
      const playersList = Array.from(onlinePlayers.values());
      socket.emit('onlinePlayers', playersList);
    });

    // Handle character docking at asset
    socket.on('characterDock', (data) => {
      console.log('Character docked:', data.characterId, 'at:', data.assetId);

      // Broadcast to all players
      io.emit('characterDocked', {
        characterId: data.characterId,
        characterName: data.characterName,
        assetId: data.assetId,
        assetName: data.assetName,
        location: data.location,
        timestamp: new Date()
      });
    });

    // Handle character undocking
    socket.on('characterUndock', (data) => {
      console.log('Character undocked:', data.characterId);

      // Broadcast to all players
      io.emit('characterUndocked', {
        characterId: data.characterId,
        characterName: data.characterName,
        location: data.location,
        timestamp: new Date()
      });
    });

    // Handle character navigation (starting travel)
    socket.on('characterNavigate', (data) => {
      console.log('Character navigating:', data.characterId, 'to:', data.destination);

      // Broadcast to all players
      io.emit('characterNavigating', {
        characterId: data.characterId,
        characterName: data.characterName,
        destination: data.destination,
        eta: data.eta,
        timestamp: new Date()
      });
    });

    // Handle planetary grid handoff
    socket.on('gridHandoff', (data) => {
      console.log('Grid handoff request:', data);
      socket.emit('gridHandoffResponse', {
        success: true,
        nextGrid: data.nextGrid,
        handoffServer: data.handoffServer
      });
    });

    // Handle player movement (real-time position updates)
    socket.on('playerMove', (data) => {
      socket.broadcast.emit('playerMoved', data);
    });

    // Handle character updates (general)
    socket.on('characterUpdate', (data) => {
      socket.broadcast.emit('characterUpdated', data);
    });

    // Handle character info requests (when clicking on another ship)
    socket.on('requestCharacterInfo', async (data) => {
      try {
        const { Character } = await import('../../api/v1/models/Character.js');
        const character = await Character.findById(data.characterId);

        if (character) {
          socket.emit('characterInfo', {
            characterId: character._id,
            name: character.name,
            level: character.level,
            species: character.species,
            primaryClass: character.primaryClass,
            location: character.location,
            ship: {
              name: character.ship?.name,
              class: character.ship?.class,
              hull: character.ship?.hull
            },
            stats: character.stats
          });
        } else {
          socket.emit('characterInfo', { error: 'Character not found' });
        }
      } catch (error) {
        console.error('Error fetching character info:', error);
        socket.emit('characterInfo', { error: 'Failed to fetch character info' });
      }
    });

    // Handle chat messages
    socket.on('chatMessage', (data) => {
      io.emit('chatMessage', {
        user: data.user,
        characterName: data.characterName,
        message: data.message,
        userId: data.userId,
        timestamp: new Date()
      });
    });

    // Handle ping for latency measurement
    socket.on('ping', (timestamp) => {
      socket.emit('pong', timestamp);
    });

    // Handle character location updates
    socket.on('characterLocationUpdate', (data) => {
      // Update in registry
      if (onlinePlayers.has(socket.id)) {
        const player = onlinePlayers.get(socket.id);
        player.location = data.location;
        player.assetId = data.assetId || null;
        onlinePlayers.set(socket.id, player);
      }

      // Broadcast to all other players
      socket.broadcast.emit('characterLocationUpdate', {
        characterId: data.characterId,
        characterName: data.characterName,
        location: data.location,
        assetId: data.assetId,
        timestamp: new Date()
      });
    });

    socket.on('disconnect', () => {
      console.log('🔌 User disconnected:', socket.id);

      // Remove from online players registry
      if (onlinePlayers.has(socket.id)) {
        onlinePlayers.delete(socket.id);

        // Send updated online count
        io.emit('onlineCount', onlinePlayers.size);
      }

      // Broadcast character leaving if they were in the universe
      if (socket.characterId) {
        socket.broadcast.emit('characterLeft', {
          characterId: socket.characterId,
          characterName: socket.characterName,
          timestamp: new Date()
        });
      }
    });
  });

  // Expose method to get connected user IDs
  io.getConnectedUserIds = () => {
    const userIds = new Set();
    for (const player of onlinePlayers.values()) {
      if (player.userId) {
        userIds.add(player.userId.toString());
      }
    }
    return Array.from(userIds);
  };

  return io;
}

// Export helper to get online players (for other modules)
export function getConnectedUserIds(io) {
  if (io && io.getConnectedUserIds) {
    return io.getConnectedUserIds();
  }
  return [];
}
