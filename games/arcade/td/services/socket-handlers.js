/**
 * Socket.IO handlers - bridge between client UI and the wave engine.
 *
 * Auth: Express session + passport are shared with Socket.IO (app.js), so
 * socket.request.user is the authed User. Play REQUIRES auth.
 *
 * Two card layers:
 *   - Equipment (towers) dealt by the engine's Deck -> placed on the board.
 *   - Action cards: a hand built pre-game from (collection picks + generics),
 *     played ONTO placed towers to buff them. New generics are rewarded on
 *     wave clears; collection cards/XP are rewarded at run end.
 *
 * Lifecycle: run:start (auth + loadout) -> play -> end (persist + stats + XP + reward).
 */
import Run from '../api/v1/models/Run.js';
import GameMap from '../api/v1/models/Map.js';
import Level from '../api/v1/models/Level.js';
import Tower from '../api/v1/models/Tower.js';
import User from '../api/v1/models/User.js';
import EnemyType from '../api/v1/models/EnemyType.js';
import Story from '../api/v1/models/Story.js';
import { GameInstance, getGame, registerGame, unregisterGame, GAME_TICK_HZ } from './game/index.js';
import { buildActionHand, drawGeneric, xpForRun, levelFromXp, rollRewardCard } from './cards/actions.js';
import { reportScore } from './platform/report.js';
import walletClient from './platform/wallet.js';
import { PRICES } from '../api/v1/routes/economy.js';

export { GAME_TICK_HZ };

const getUser = (socket) => socket.request?.user || null;
const isAdmin = (socket) => (getUser(socket)?.roles || []).includes('admin');

/** End-of-run hook: persist run, update lifetime stats, grant XP + reward card. */
function makeOnEnd(userId, io) {
  return async ({ run, status, score = 0, waveReached = 0, towersBuilt = 0, loot = null, ammoLeft = null, deployableLeft = null }) => {
    const room = `run:${run._id}`;
    try {
      await run.save();

      const xpGain = xpForRun({ status, score, waveReached });
      const inc = {
        'stats.gamesPlayed': 1,
        'stats.totalScore': score,
        'stats.towersBuilt': towersBuilt,
        xp: xpGain,
      };
      if (status === 'won') inc['stats.gamesWon'] = 1;
      else if (status === 'lost') inc['stats.gamesLost'] = 1;
      else inc['stats.gamesAbandoned'] = 1;

      await User.updateOne(
        { _id: userId },
        {
          $inc: inc,
          $max: { 'stats.bestScore': score, 'stats.highestWave': waveReached },
          $set: { 'stats.lastPlayedAt': new Date() },
        }
      );

      // ---- Economy reconcile: looted ammo+components persist; tokens -> chips;
      //      remaining deployable inventory is written back (spent towers consumed). ----
      const econ = await User.findById(userId);
      if (econ) {
        econ.inventory = econ.inventory || { components: 0, ammo: 0, builtTowers: [] };
        if (loot) {
          econ.inventory.ammo = (econ.inventory.ammo || 0) + (loot.ammo || 0);
          econ.inventory.components = (econ.inventory.components || 0) + (loot.components || 0);
        }
        // write back the deployable pool the run ended with (built towers consumed
        // on placement are reflected here; base-loadout entries are not persisted).
        if (deployableLeft && typeof deployableLeft === 'object') {
          const builtIds = new Set((econ.inventory.builtTowers || []).map(t => String(t.towerId)));
          econ.inventory.builtTowers = (econ.inventory.builtTowers || []).map(t => ({
            towerId: String(t.towerId),
            count: Math.max(0, deployableLeft[String(t.towerId)] ?? t.count ?? 0),
          })).filter(t => t.count > 0);
        }
        // ammoLeft is the in-run remaining arm-stock; we already added loot ammo
        // above to the persisted pool, so DON'T double count — only loot persists.
        await econ.save();
        // tokens looted convert to global chips (the only money)
        if (loot && loot.tokens > 0) {
          walletClient.credit(econ.platformId, loot.tokens, 'towers-loot-tokens',
            { runId: String(run._id) }, econ.displayName).catch(() => {});
        }
      }

      // Recompute level; emit level-up if it changed.
      const fresh = await User.findById(userId);
      const newLevel = levelFromXp(fresh.xp || 0);
      if (newLevel !== (fresh.level || 1)) {
        fresh.level = newLevel;
        await fresh.save();
        io.to(room).emit('run:levelup', { level: newLevel });
      }

      // Reward a collection card on a win.
      if (status === 'won') {
        const reward = await rollRewardCard();
        if (reward) {
          const existing = fresh.cardCollection.find(c => c.slug === reward.slug);
          if (existing) existing.count += 1;
          else fresh.cardCollection.push({ slug: reward.slug, count: 1 });
          await fresh.save();
          io.to(room).emit('run:reward', {
            card: { slug: reward.slug, name: reward.name, icon: reward.icon, rarity: reward.rarity },
          });
        }
      }

      io.to(room).emit('run:xp', { gained: xpGain });

      // Report to platform master leaderboard (best-effort; never blocks).
      reportScore({ platformId: fresh.platformId, displayName: fresh.displayName, score, wave: waveReached, status });
      console.log(`[stats] ${userId} ${status} score=${score} wave=${waveReached} +${xpGain}xp`);
    } catch (err) {
      console.error('[stats] update failed:', err.message);
    } finally {
      unregisterGame(run._id);
    }
  };
}

export function attachSocket(io) {
  io.on('connection', (socket) => {
    const user = getUser(socket);
    console.log(`[socket] connected: ${socket.id}${user ? ` (${user.displayName})` : ' (guest)'}`);

    socket.on('run:join', ({ runId }) => {
      socket.join(`run:${runId}`);
      socket.emit('run:joined', { runId });
    });

    socket.on('run:leave', ({ runId }) => socket.leave(`run:${runId}`));

    socket.on('run:start', async ({ runId, mapId, levelId, loadout = {} }) => {
      try {
        const sUser = getUser(socket);
        if (!sUser) return socket.emit('run:error', { error: 'Sign in to play', code: 'auth_required' });

        const player = await User.findById(sUser._id);
        if (!player) return socket.emit('run:error', { error: 'Account not found', code: 'auth_required' });

        // Campaign mode: a Level supplies its own waves + difficulty modifiers and
        // names the board (Map) it plays on. The board's mapId wins over the client
        // mapId. Free-play (no levelId) loads the board by the client mapId as before.
        const campaignLevel = levelId ? await Level.findById(levelId) : null;
        const map = await GameMap.findById(campaignLevel ? campaignLevel.mapId : mapId);
        if (!map) return socket.emit('run:error', { error: 'Map not found' });

        // The object the engine reads waves off. For a level, swap in the level's
        // waves while spawn/base/path/loadout hexes still come from the real map.
        const engineMap = campaignLevel
          ? { ...map.toObject(), waves: campaignLevel.waves }
          : map;

        let run = runId ? await Run.findById(runId) : null;
        if (!run || run.status !== 'active') {
          run = await Run.create({
            mapId: map._id,
            levelId: campaignLevel ? campaignLevel._id : null,
            playerId: player._id,
            playerName: player.displayName,
          });
        } else if (campaignLevel && String(run.levelId || '') !== String(campaignLevel._id)) {
          run.levelId = campaignLevel._id;
          await run.save();
        }

        socket.data.runId = String(run._id);
        socket.join(`run:${run._id}`);

        let game = getGame(run._id);
        if (!game) {
          const level = levelFromXp(player.xp || 0);
          const ownedSlugs = (player.cardCollection || []).map(c => c.slug);
          const collectionSlugs = Array.isArray(loadout.collectionSlugs) ? loadout.collectionSlugs : [];
          const { hand, slots } = await buildActionHand({ level, collectionSlugs, ownedSlugs });

          const story = await Story.findOne({ mapId: map._id, status: { $in: ['approved', 'featured'] } }).lean()
            || await Story.findOne({ mapId: map._id, status: 'draft' }).lean();
          const towers = await Tower.find({ status: { $in: ['approved', 'featured'] } }).lean();
          const etDocs = await EnemyType.find({ enabled: true }).lean();
          const enemyTypes = Object.fromEntries(
            etDocs.map(e => [e.slug, { hp: e.hp, speed: e.speed, reward: e.reward, color: e.color }])
          );

          // Apply the level's difficulty modifiers before the engine starts:
          //  - starting currency / base health override the Run defaults (when set)
          //  - hp/speed/reward multipliers scale every enemy type for this run
          if (campaignLevel && campaignLevel.modifiers) {
            const m = campaignLevel.modifiers;
            if (m.startingCurrency != null) run.currency = m.startingCurrency;
            if (m.baseHealth != null) run.baseHealth = m.baseHealth;
            const hpMult = m.enemyHpMult || 1;
            const speedMult = m.enemySpeedMult || 1;
            const rewardMult = m.rewardMult || 1;
            if (hpMult !== 1 || speedMult !== 1 || rewardMult !== 1) {
              for (const et of Object.values(enemyTypes)) {
                et.hp = Math.round(et.hp * hpMult);
                et.speed = et.speed * speedMult;
                et.reward = Math.round(et.reward * rewardMult);
              }
            }
          }

          game = new GameInstance({
            run, map: engineMap, io, towers, enemyTypes, story,
            actionHand: hand, actionSlots: slots, level,
            drawCard: () => drawGeneric(level),
            inventory: player.inventory || {},
            armCost: PRICES.armCost,
            onEnd: makeOnEnd(player._id, io),
          });
          registerGame(run._id, game);
          if (!game.start()) {
            unregisterGame(run._id);
            return socket.emit('run:error', { error: 'Failed to start - map has no valid path' });
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

    // Play an action card onto a tower (or the base for base-heal cards).
    socket.on('run:play-card', ({ runId, instanceId, towerId }) => {
      const game = getGame(runId);
      if (!game) return socket.emit('run:error', { error: 'No active game' });
      const result = game.playActionCard(instanceId, towerId);
      if (!result.ok) socket.emit('card:rejected', { reason: result.error });
    });

    // ---- PUBLIC tactical pause (any player) -----------------------------
    socket.on('run:tactical-pause', ({ runId } = {}) => {
      const game = getGame(runId || socket.data?.runId);
      if (!game) return socket.emit('run:tactical-result', { ok: false, error: 'no active game' });
      const res = game.tacticalPause();
      socket.emit('run:tactical-result', res);
    });

    socket.on('run:tactical-resume', ({ runId } = {}) => {
      const game = getGame(runId || socket.data?.runId);
      if (game && typeof game.resumeFromTactical === 'function') game.resumeFromTactical();
    });

    // Where's-Waldo: tap an enemy during a tactical pause to expose a disguised one.
    socket.on('run:expose', ({ runId, enemyId } = {}) => {
      const game = getGame(runId || socket.data?.runId);
      if (!game) return;
      const res = game.exposeDisguised(enemyId);
      socket.emit('run:expose-result', { ...res, enemyId });
    });

    // ---- Bug button (admin only): pause / resume / live-tune ------------
    socket.on('run:pause', ({ runId }) => {
      if (!isAdmin(socket)) return;
      const game = getGame(runId || socket.data?.runId);
      if (game) game.pause();
    });

    socket.on('story:dismiss', ({ runId }) => {
      const game = getGame(runId || socket.data?.runId);
      if (game && typeof game.resumeFromStory === 'function') game.resumeFromStory();
    });

    socket.on('run:resume', ({ runId }) => {
      if (!isAdmin(socket)) return;
      const game = getGame(runId || socket.data?.runId);
      if (game) game.resume();
    });

    socket.on('run:tune', ({ runId, target, id, slug, field, value }) => {
      if (!isAdmin(socket)) return socket.emit('run:tuned', { ok: false, error: 'admin only' });
      const game = getGame(runId || socket.data?.runId);
      if (!game) return socket.emit('run:tuned', { ok: false, error: 'no active game' });
      const res = game.tune({ target, id, slug, field, value });
      socket.emit('run:tuned', { ...res, target, id, slug, field, value });
    });

    socket.on('disconnect', () => {
      console.log(`[socket] disconnected: ${socket.id}`);
      const runId = socket.data?.runId;
      if (!runId) return;
      const room = io.sockets.adapter.rooms.get(`run:${runId}`);
      if (room && room.size > 0) return;
      const game = getGame(runId);
      if (game && !game._stopped) game.stop('abandoned');
    });
  });

  console.log(`[socket] handlers attached, tick rate: ${GAME_TICK_HZ}Hz`);
}
