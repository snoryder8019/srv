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

    // ========================================
    // SURVIVAL SYSTEM SOCKET HANDLERS
    // ========================================

    // Tester supply command - max out all supplies
    socket.on('testerSupply', async (data) => {
      try {
        const { getDb } = await import('../../plugins/mongo/mongo.js');
        const { collections } = await import('../../config/database.js');
        const { ObjectId } = await import('mongodb');

        const db = getDb();
        const character = await db.collection(collections.characters).findOne({
          _id: new ObjectId(data.characterId)
        });

        if (!character) {
          socket.emit('error', { message: 'Character not found' });
          return;
        }

        // Check if user is tester (for now, allow all for testing)
        // TODO: Add proper role check when user roles are implemented
        // const user = await db.collection(collections.users).findOne({ _id: new ObjectId(character.userId) });
        // if (!user || !user.roles?.includes('tester')) {
        //   socket.emit('error', { message: 'Tester access required' });
        //   return;
        // }

        // Max out all supplies
        await db.collection(collections.characters).updateOne(
          { _id: character._id },
          {
            $set: {
              'ship.fittings.fuelTanks.remaining': character.ship?.fittings?.fuelTanks?.capacity || 1000,
              'ship.fittings.lifeSupport.foodRemaining': character.ship?.fittings?.lifeSupport?.foodCapacity || 100,
              'ship.fittings.lifeSupport.oxygenRemaining': character.ship?.fittings?.lifeSupport?.oxygenCapacity || 1000,
              'ship.fittings.medicalBay.medKitsRemaining': character.ship?.fittings?.medicalBay?.medKitsCapacity || 20
            }
          }
        );

        console.log(`✅ Tester supply granted to ${character.name}`);
        socket.emit('testerSupplyGranted', { success: true });

      } catch (error) {
        console.error('❌ Tester supply error:', error);
        socket.emit('error', { message: 'Failed to grant tester supply' });
      }
    });

    // Resupply from storehouse
    socket.on('resupplyFromStorehouse', async (data) => {
      try {
        const { getDb } = await import('../../plugins/mongo/mongo.js');
        const { collections } = await import('../../config/database.js');
        const { ObjectId } = await import('mongodb');

        const db = getDb();
        const { characterId, galaxyId, item, amount } = data;

        const character = await db.collection(collections.characters).findOne({
          _id: new ObjectId(characterId)
        });
        const storehouse = await db.collection(collections.storehouses).findOne({
          galaxyId: new ObjectId(galaxyId)
        });

        if (!character || !storehouse) {
          socket.emit('error', { message: 'Character or storehouse not found' });
          return;
        }

        // Check if enough in storehouse
        if (storehouse.inventory[item] < amount) {
          socket.emit('error', {
            message: `Not enough ${item} in storehouse`,
            available: storehouse.inventory[item]
          });
          return;
        }

        // Transfer from storehouse to ship
        const newStorehouseAmount = storehouse.inventory[item] - amount;
        await db.collection(collections.storehouses).updateOne(
          { _id: storehouse._id },
          {
            $set: {
              [`inventory.${item}`]: newStorehouseAmount,
              lastUpdated: new Date()
            }
          }
        );

        // Add to character ship
        let updateField = '';
        let currentAmount = 0;

        switch(item) {
          case 'fuel':
            updateField = 'ship.fittings.fuelTanks.remaining';
            currentAmount = character.ship?.fittings?.fuelTanks?.remaining || 0;
            break;
          case 'food':
            updateField = 'ship.fittings.lifeSupport.foodRemaining';
            currentAmount = character.ship?.fittings?.lifeSupport?.foodRemaining || 0;
            break;
          case 'oxygen':
            updateField = 'ship.fittings.lifeSupport.oxygenRemaining';
            currentAmount = character.ship?.fittings?.lifeSupport?.oxygenRemaining || 0;
            break;
          case 'medkits':
            updateField = 'ship.fittings.medicalBay.medKitsRemaining';
            currentAmount = character.ship?.fittings?.medicalBay?.medKitsRemaining || 0;
            break;
          default:
            socket.emit('error', { message: `Unknown item type: ${item}` });
            return;
        }

        const newCharAmount = currentAmount + amount;
        await db.collection(collections.characters).updateOne(
          { _id: character._id },
          { $set: { [updateField]: newCharAmount } }
        );

        console.log(`✅ ${character.name} resupplied ${amount} ${item} from storehouse`);

        socket.emit('resupplySuccess', {
          success: true,
          item: item,
          amount: amount,
          newAmount: newCharAmount
        });

      } catch (error) {
        console.error('❌ Resupply error:', error);
        socket.emit('error', { message: 'Failed to resupply' });
      }
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

    // ===== ZONE-SPECIFIC EVENTS =====

    // Handle character entering a zone
    socket.on('zone:enter', async (data) => {
      console.log('🚪 Character entering zone:', data.characterId, 'zone:', data.zoneId);

      // Join socket room for this zone
      socket.join(`zone:${data.zoneId}`);
      socket.currentZone = data.zoneId;
      socket.currentCharacterId = data.characterId;
      socket.currentCharacterName = data.characterName;

      // Store character info in zone-specific registry
      if (!onlinePlayers.has(socket.id)) {
        onlinePlayers.set(socket.id, {});
      }

      const player = onlinePlayers.get(socket.id);
      player.characterId = data.characterId;
      player.characterName = data.characterName;
      player.location = {
        type: 'zone',
        zoneId: data.zoneId,
        zoneName: data.zoneName,
        x: data.x,
        y: data.y
      };
      onlinePlayers.set(socket.id, player);

      // Broadcast to other players in the zone
      socket.to(`zone:${data.zoneId}`).emit('zone:playerJoined', {
        characterId: data.characterId,
        characterName: data.characterName,
        x: data.x,
        y: data.y,
        timestamp: new Date()
      });

      // Send list of players already in zone (with character info)
      const playersInZone = Array.from(onlinePlayers.values())
        .filter(p => p.location?.type === 'zone' && p.location?.zoneId === data.zoneId)
        .map(p => ({
          characterId: p.characterId,
          characterName: p.characterName,
          location: p.location
        }));

      socket.emit('zone:playersInZone', playersInZone);
    });

    // Handle character exiting a zone
    socket.on('zone:exit', (data) => {
      console.log('🚪 Character exiting zone:', data.characterId, 'from zone:', data.zoneId);

      // Leave socket room
      if (socket.currentZone) {
        socket.leave(`zone:${socket.currentZone}`);

        // Broadcast to other players in the zone
        socket.to(`zone:${socket.currentZone}`).emit('zone:playerLeft', {
          characterId: data.characterId,
          characterName: data.characterName,
          timestamp: new Date()
        });

        socket.currentZone = null;
      }

      // Update online player location back to galactic
      if (onlinePlayers.has(socket.id)) {
        const player = onlinePlayers.get(socket.id);
        player.location = data.galacticLocation || {
          type: 'galactic',
          x: 0,
          y: 0,
          z: 0
        };
        onlinePlayers.set(socket.id, player);
      }
    });

    // Handle character movement within zone
    socket.on('zone:move', (data) => {
      // Broadcast position update to other players in the zone
      if (socket.currentZone) {
        socket.to(`zone:${socket.currentZone}`).emit('zone:playerMoved', {
          characterId: data.characterId,
          x: data.x,
          y: data.y,
          vx: data.vx || 0,
          vy: data.vy || 0,
          timestamp: new Date()
        });

        // Update online player position
        if (onlinePlayers.has(socket.id)) {
          const player = onlinePlayers.get(socket.id);
          if (player.location && player.location.type === 'zone') {
            player.location.x = data.x;
            player.location.y = data.y;
            onlinePlayers.set(socket.id, player);
          }
        }
      }
    });

    // Handle zone chat messages
    socket.on('zone:chat', (data) => {
      if (socket.currentZone) {
        // Broadcast chat message to all players in zone (including sender)
        io.to(`zone:${socket.currentZone}`).emit('zone:chatMessage', {
          characterId: data.characterId,
          characterName: data.characterName,
          message: data.message,
          timestamp: new Date()
        });
      }
    });

    // Handle zone action (interaction with objects/NPCs)
    socket.on('zone:action', (data) => {
      if (socket.currentZone) {
        // Broadcast action to other players in zone
        socket.to(`zone:${socket.currentZone}`).emit('zone:playerAction', {
          characterId: data.characterId,
          characterName: data.characterName,
          action: data.action,
          targetId: data.targetId,
          targetType: data.targetType,
          timestamp: new Date()
        });
      }
    });

    socket.on('disconnect', () => {
      console.log('🔌 User disconnected:', socket.id);

      // If player was in a zone, notify other players
      if (socket.currentZone && socket.currentCharacterId) {
        socket.to(`zone:${socket.currentZone}`).emit('zone:playerLeft', {
          characterId: socket.currentCharacterId,
          characterName: socket.currentCharacterName,
          timestamp: new Date()
        });
      }

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

  // Expose method to get connected character IDs (active characters only)
  io.getConnectedCharacterIds = () => {
    const characterIds = new Set();
    for (const player of onlinePlayers.values()) {
      if (player.characterId) {
        characterIds.add(player.characterId.toString());
      }
    }
    return Array.from(characterIds);
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
