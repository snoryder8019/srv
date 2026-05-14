/**
 * Socket.IO handlers - the bridge between client UI and the wave engine.
 *
 * Events received from client:
 *   run:join         { runId }
 *   run:start        { runId, mapId }    -> creates GameInstance
 *   run:place-tower  { runId, towerId, q, r }
 *   run:leave        { runId }
 *
 * Events emitted to client (see wave-engine.js):
 *   run:started, wave:start, wave:cleared, run:ended
 *   enemy:spawned, enemy:killed, enemy:reached-base
 *   tower:placed, tower:fired
 *   state:tick                             (4 Hz authoritative snapshot)
 */
import Run from '../api/v1/models/Run.js';
import GameMap from '../api/v1/models/Map.js';
import Tower from '../api/v1/models/Tower.js';
import { GameInstance, getGame, registerGame, unregisterGame, GAME_TICK_HZ } from './wave-engine.js';

export { GAME_TICK_HZ };

export function attachSocket(io) {
  io.on('connection', (socket) => {
    console.log(`[socket] connected: ${socket.id}`);

    socket.on('run:join', ({ runId }) => {
      socket.join(`run:${runId}`);
      socket.emit('run:joined', { runId });
    });

    socket.on('run:leave', ({ runId }) => {
      socket.leave(`run:${runId}`);
    });

    socket.on('run:start', async ({ runId, mapId, playerName }) => {
      try {
        let run = runId ? await Run.findById(runId) : null;
        const map = await GameMap.findById(mapId);
        if (!map) return socket.emit('run:error', { error: 'Map not found' });

        if (!run) {
          run = await Run.create({ mapId: map._id, playerName: playerName || 'guest' });
        }

        socket.join(`run:${run._id}`);

        let game = getGame(run._id);
        if (!game) {
          game = new GameInstance({ run, map, io });
          registerGame(run._id, game);
          const ok = game.start();
          if (!ok) {
            unregisterGame(run._id);
            return socket.emit('run:error', { error: 'Failed to start - check map path' });
          }
        }
        socket.emit('run:joined', { runId: String(run._id) });
      } catch (err) {
        console.error('[socket] run:start error:', err);
        socket.emit('run:error', { error: err.message });
      }
    });

    socket.on('run:place-tower', async ({ runId, towerId, q, r }) => {
      const game = getGame(runId);
      if (!game) return socket.emit('run:error', { error: 'No active game' });
      try {
        const towerDef = await Tower.findById(towerId);
        if (!towerDef) return socket.emit('run:error', { error: 'Tower not found' });
        const result = game.placeTower(towerDef, q, r);
        if (!result.ok) socket.emit('place:rejected', { reason: result.error, q, r });
      } catch (err) {
        socket.emit('run:error', { error: err.message });
      }
    });

    socket.on('disconnect', () => {
      console.log(`[socket] disconnected: ${socket.id}`);
    });
  });

  console.log(`[socket] handlers attached, tick rate: ${GAME_TICK_HZ}Hz`);
}
