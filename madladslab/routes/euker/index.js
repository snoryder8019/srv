// routes/euker/index.js
import { Router } from 'express';
import EukerTable from '../../api/v1/models/euker/EukerTable.js';
import EukerPlayer from '../../api/v1/models/euker/EukerPlayer.js';
import EukerBot from '../../api/v1/models/euker/EukerBot.js';
import User from '../../api/v1/models/User.js';
import { EukerBot as BotAI, BOT_NAMES } from '../../services/euker/BotPlayer.js';

const router = Router();

// Helper functions to replace table methods
function getPlayerPosition(table, userId) {
  const positions = ['North', 'East', 'South', 'West'];
  for (const pos of positions) {
    if (table.seats[pos].user) {
      const seatUserId = table.seats[pos].user._id || table.seats[pos].user;
      if (seatUserId.toString() === userId.toString()) {
        return pos;
      }
    }
  }
  return null;
}

function isFull(table) {
  const positions = ['North', 'East', 'South', 'West'];
  return positions.every(pos => table.seats[pos].user);
}

function isEmpty(table) {
  const positions = ['North', 'East', 'South', 'West'];
  return positions.every(pos => !table.seats[pos].user);
}

function canStart(table) {
  const positions = ['North', 'East', 'South', 'West'];
  return positions.every(pos => table.seats[pos].user && table.seats[pos].isReady);
}

// Helper function to populate seats with both users and bots
async function populateTableSeats(table) {
  const positions = ['North', 'East', 'South', 'West'];

  // Convert to plain object if it's a Mongoose document
  const tableObj = table.toObject ? table.toObject() : table;

  for (const pos of positions) {
    if (tableObj.seats[pos].user) {
      const userId = tableObj.seats[pos].user;

      // Try to find as User first
      let user = await User.findById(userId).select('_id displayName email').lean();

      // If not found, try as Bot
      if (!user) {
        user = await EukerBot.findById(userId).select('_id displayName email difficulty').lean();
      }

      if (user) {
        tableObj.seats[pos].user = user;
      }
    }
  }

  return tableObj;
}

async function populateTables(tables) {
  const populated = [];
  for (const table of tables) {
    populated.push(await populateTableSeats(table));
  }
  return populated;
}

const SUITS = ['H','D','C','S'];
const RANKS = ['9','10','J','Q','K','A'];

const sameColor = { H:'D', D:'H', C:'S', S:'C' };

const makeDeck = () => SUITS.flatMap(s => RANKS.map(r => r + s));
const shuffle = a => { for (let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]];} return a; };

// Helper functions
const leftOf = i => (i+1)%4;
const playerAt = (i, positions) => positions[i];
const teamOf = p => (p==='North'||p==='South') ? 'teamNS' : 'teamEW';

function dealAndStartBidding(table) {
  const gs = table.gameState;
  gs.deck = shuffle(makeDeck());
  // deal 5 each
  gs.hands = { North:[], East:[], South:[], West:[] };
  const positions = ['North', 'East', 'South', 'West'];
  for (let r=0;r<5;r++) positions.forEach(p => gs.hands[p].push(gs.deck.shift()));
  gs.upcard = gs.deck.shift();
  gs.trump = null;
  gs.table = [];
  gs.trickCount = { teamNS: 0, teamEW: 0 };
  gs.maker = null;
  gs.goingAlone = false;
  gs.phase = 'bidding1';
  gs.turnIdx = leftOf(gs.dealerIdx);
}

function rankValue(card, leadSuit, trump) {
  const rank = card.slice(0, -1);
  const suit = card.slice(-1);
  const left = sameColor[trump];

  // Right bower (J of trump)
  if (rank==='J' && suit===trump) return 100;
  // Left bower (J of same color) counts as trump
  if (rank==='J' && suit===left) return 99;

  // trump cards outrank non-trump
  const isTrump = (suit===trump) || (rank==='J' && suit===left);
  const isLead = (suit===leadSuit) || (rank==='J' && suit===left && left===leadSuit);

  const base = { 'A':6,'K':5,'Q':4,'10':3,'9':2,'J':1 }[rank] || 0;

  if (isTrump) return 50 + base;
  if (isLead)  return 20 + base;
  return base;
}

// Middleware to ensure user is logged in
const requireAuth = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
};

// === LOBBY & TABLE MANAGEMENT ===

// Show lobby with all tables
router.get('/', async (req, res) => {
  try {
    let tables = await EukerTable.find({ status: { $in: ['waiting', 'playing'] } })
      .sort('-createdAt')
      .limit(20);

    // Manually populate seats with both users and bots
    tables = await populateTables(tables);

    const user = req.user;
    let playerData = null;

    if (user) {
      playerData = await EukerPlayer.findOne({ user: user._id });
      if (!playerData) {
        playerData = await EukerPlayer.create({ user: user._id });
      }
    }

    res.render('euker/lobby', {
      message: 'Euker Card Game',
      tables,
      user,
      playerData
    });
  } catch (error) {
    console.error('Euker lobby error:', error);
    res.status(500).json({ error: 'Failed to load lobby' });
  }
});

// Create a new table
router.post('/tables/create', requireAuth, async (req, res) => {
  try {
    const { name, private: isPrivate, password } = req.body;

    const table = await EukerTable.create({
      name: name || `${req.user.displayName || req.user.email}'s Table`,
      createdBy: req.user._id,
      private: isPrivate || false,
      password: password || undefined
    });

    table.addLog(`Table created by ${req.user.displayName || req.user.email}`);
    await table.save();

    res.json({ success: true, tableId: table._id });
  } catch (error) {
    console.error('Create table error:', error);
    res.status(500).json({ error: 'Failed to create table' });
  }
});

// Join a table
router.post('/tables/:tableId/join', requireAuth, async (req, res) => {
  try {
    const { tableId } = req.params;
    const { position, password } = req.body;

    const table = await EukerTable.findById(tableId);
    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }

    // Check password if private
    if (table.private && table.password !== password) {
      return res.status(403).json({ error: 'Incorrect password' });
    }

    // Check if table is full
    if (isFull(table)) {
      return res.status(400).json({ error: 'Table is full' });
    }

    // Check if user is already at table
    const currentPos = getPlayerPosition(table, req.user._id);
    if (currentPos) {
      return res.json({ success: true, position: currentPos, message: 'Already at table' });
    }

    // Find available seat or use requested position
    let targetPosition = position;
    if (!targetPosition || table.seats[targetPosition].user) {
      // Find first available seat
      const available = ['North', 'East', 'South', 'West'].find(
        pos => !table.seats[pos].user
      );
      if (!available) {
        return res.status(400).json({ error: 'No available seats' });
      }
      targetPosition = available;
    }

    // Assign seat
    table.seats[targetPosition].user = req.user._id;
    table.seats[targetPosition].isReady = false;
    table.addLog(`${req.user.displayName || req.user.email} joined as ${targetPosition}`);

    // Update player's current table
    await EukerPlayer.findOneAndUpdate(
      { user: req.user._id },
      { currentTable: table._id },
      { upsert: true }
    );

    await table.save();

    res.json({ success: true, position: targetPosition });
  } catch (error) {
    console.error('Join table error:', error);
    res.status(500).json({ error: 'Failed to join table' });
  }
});

// Delete a table (creator only)
router.post('/tables/:tableId/delete', requireAuth, async (req, res) => {
  try {
    const { tableId } = req.params;

    const table = await EukerTable.findById(tableId);
    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }

    // Check if user is the creator
    if (table.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Only the table creator can delete it' });
    }

    await EukerTable.findByIdAndDelete(tableId);

    res.json({ success: true });
  } catch (error) {
    console.error('Delete table error:', error);
    res.status(500).json({ error: 'Failed to delete table' });
  }
});

// Leave a table
router.post('/tables/:tableId/leave', requireAuth, async (req, res) => {
  try {
    const { tableId } = req.params;

    const table = await EukerTable.findById(tableId);
    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }

    const position = getPlayerPosition(table, req.user._id);
    if (!position) {
      return res.status(400).json({ error: 'Not at this table' });
    }

    // Remove from seat
    table.seats[position].user = null;
    table.seats[position].isReady = false;
    table.addLog(`${req.user.displayName || req.user.email} left ${position} seat`);

    // If table is empty, delete it
    if (isEmpty(table)) {
      await EukerTable.findByIdAndDelete(tableId);
    } else {
      await table.save();
    }

    // Update player
    await EukerPlayer.findOneAndUpdate(
      { user: req.user._id },
      { currentTable: null }
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Leave table error:', error);
    res.status(500).json({ error: 'Failed to leave table' });
  }
});

// Toggle ready status
router.post('/tables/:tableId/ready', requireAuth, async (req, res) => {
  try {
    const { tableId } = req.params;

    const table = await EukerTable.findById(tableId);
    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }

    const position = getPlayerPosition(table, req.user._id);
    if (!position) {
      return res.status(400).json({ error: 'Not at this table' });
    }

    table.seats[position].isReady = !table.seats[position].isReady;
    const readyStatus = table.seats[position].isReady ? 'ready' : 'not ready';
    table.addLog(`${req.user.displayName || req.user.email} is ${readyStatus}`);

    await table.save();

    res.json({ success: true, isReady: table.seats[position].isReady });
  } catch (error) {
    console.error('Ready toggle error:', error);
    res.status(500).json({ error: 'Failed to toggle ready' });
  }
});

// View a specific table
router.get('/tables/:tableId', async (req, res) => {
  try {
    const { tableId } = req.params;

    console.log('=== TABLE VIEW DEBUG ===');
    console.log('req.user:', req.user ? req.user._id : 'NULL');
    console.log('req.session:', req.session ? 'EXISTS' : 'NULL');
    console.log('req.isAuthenticated():', req.isAuthenticated ? req.isAuthenticated() : 'NO METHOD');

    const tableDoc = await EukerTable.findById(tableId);

    if (!tableDoc) {
      return res.status(404).json({ error: 'Table not found' });
    }

    // Manually populate seats (returns plain object)
    const table = await populateTableSeats(tableDoc);

    const user = req.user;
    let playerPosition = null;

    if (user) {
      // Find player position manually since table is now a plain object
      const positions = ['North', 'East', 'South', 'West'];
      for (const pos of positions) {
        if (table.seats[pos].user) {
          const userId = table.seats[pos].user._id || table.seats[pos].user;
          if (userId.toString() === user._id.toString()) {
            playerPosition = pos;
            break;
          }
        }
      }
    }

    res.render('euker/table', {
      table,
      gameState: table.gameState,
      user,
      playerPosition,
      positions: ['North', 'East', 'South', 'West']
    });
  } catch (error) {
    console.error('Table view error:', error);
    res.status(500).json({ error: 'Failed to load table' });
  }
});

// === GAME ACTIONS ===

// Start a new hand (deal + bidding round 1)
router.post('/tables/:tableId/start', requireAuth, async (req, res) => {
  try {
    const { tableId } = req.params;

    const table = await EukerTable.findById(tableId);
    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }

    if (!canStart(table)) {
      return res.status(400).json({ error: 'Need 4 ready players to start' });
    }

    dealAndStartBidding(table);
    table.status = 'playing';
    const positions = ['North', 'East', 'South', 'West'];
    table.addLog(`New hand dealt. ${positions[table.gameState.dealerIdx]} is dealer.`);

    await table.save();

    const dealer = positions[table.gameState.dealerIdx];
    const turn = positions[table.gameState.turnIdx];

    res.json({
      success: true,
      message: 'Dealt. Bidding round 1.',
      upcard: table.gameState.upcard,
      dealer,
      turn,
      phase: table.gameState.phase
    });
  } catch (error) {
    console.error('Start game error:', error);
    res.status(500).json({ error: 'Failed to start game' });
  }
});

// Bid endpoint
router.post('/tables/:tableId/bid', requireAuth, async (req, res) => {
  try {
    const { tableId } = req.params;
    const { action, suit } = req.body;

    const table = await EukerTable.findById(tableId);
    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }

    const gs = table.gameState;
    const positions = ['North', 'East', 'South', 'West'];

    if (!['bidding1','bidding2'].includes(gs.phase)) {
      return res.status(400).json({ error: 'Not in bidding.' });
    }

    const playerPosition = getPlayerPosition(table, req.user._id);
    if (!playerPosition) {
      return res.status(400).json({ error: 'Not at this table' });
    }

    if (positions[gs.turnIdx] !== playerPosition) {
      return res.status(400).json({ error: 'Not your turn' });
    }

    const actor = positions[gs.turnIdx];
    const dealer = positions[gs.dealerIdx];
    const upSuit = gs.upcard.slice(-1);

    if (gs.phase === 'bidding1') {
      if (action === 'order') {
        gs.trump = upSuit;
        gs.maker = actor;
        gs.phase = 'play';
        gs.turnIdx = leftOf(gs.dealerIdx);
        table.addLog(`${actor} ordered up ${upSuit}`);
        await table.save();
        return res.json({
          success: true,
          message: `${actor} ordered up ${upSuit}. Trump set.`,
          trump: gs.trump,
          phase: gs.phase,
          lead: positions[gs.turnIdx]
        });
      }
      // pass
      if (gs.turnIdx === gs.dealerIdx) {
        gs.phase = 'bidding2';
        gs.turnIdx = leftOf(gs.dealerIdx);
        table.addLog(`${dealer} passed. Round 2 bidding.`);
        await table.save();
        return res.json({
          success: true,
          message: `Dealer (${dealer}) passed. Round 2.`,
          phase: gs.phase,
          turn: positions[gs.turnIdx]
        });
      } else {
        gs.turnIdx = leftOf(gs.turnIdx);
        table.addLog(`${actor} passed`);
        await table.save();
        return res.json({
          success: true,
          message: `${actor} passed.`,
          turn: positions[gs.turnIdx],
          phase: gs.phase
        });
      }
    }

    // bidding2
    if (action === 'choose') {
      if (!suit || !SUITS.includes(suit) || suit === upSuit) {
        return res.status(400).json({ error: 'Choose a valid non-upcard suit.' });
      }
      gs.trump = suit;
      gs.maker = actor;
      gs.phase = 'play';
      gs.turnIdx = leftOf(gs.dealerIdx);
      table.addLog(`${actor} chose ${suit} as trump`);
      await table.save();
      return res.json({
        success: true,
        message: `${actor} chose ${suit}. Trump set.`,
        trump: gs.trump,
        phase: gs.phase,
        lead: positions[gs.turnIdx]
      });
    } else {
      const isDealerPassingLast = (gs.turnIdx === gs.dealerIdx);
      if (isDealerPassingLast) {
        return res.status(400).json({ error: `Dealer (${dealer}) must choose a suit.` });
      }
      gs.turnIdx = leftOf(gs.turnIdx);
      table.addLog(`${actor} passed`);
      await table.save();
      return res.json({
        success: true,
        message: `${actor} passed.`,
        turn: positions[gs.turnIdx],
        phase: gs.phase
      });
    }
  } catch (error) {
    console.error('Bid error:', error);
    res.status(500).json({ error: 'Failed to process bid' });
  }
});

// Play a card
router.post('/tables/:tableId/play', requireAuth, async (req, res) => {
  try {
    const { tableId } = req.params;
    const { card } = req.body;

    const table = await EukerTable.findById(tableId)
      .populate('seats.North.user seats.East.user seats.South.user seats.West.user', 'displayName email');

    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }

    const gs = table.gameState;
    const positions = ['North', 'East', 'South', 'West'];

    if (gs.phase !== 'play') {
      return res.status(400).json({ error: 'Not in play phase.' });
    }

    const playerPosition = getPlayerPosition(table, req.user._id);
    if (!playerPosition) {
      return res.status(400).json({ error: 'Not at this table' });
    }

    if (positions[gs.turnIdx] !== playerPosition) {
      return res.status(400).json({ error: 'Not your turn' });
    }

    if (!gs.hands[playerPosition]?.includes(card)) {
      return res.status(400).json({ error: 'Card not in hand.' });
    }

    // Play the card
    gs.hands[playerPosition] = gs.hands[playerPosition].filter(c => c !== card);
    gs.table.push({ player: playerPosition, card });
    table.addLog(`${playerPosition} played ${card}`);

    // Check if trick is complete
    if (gs.table.length < 4) {
      gs.turnIdx = leftOf(gs.turnIdx);
      await table.save();
      return res.json({
        success: true,
        message: `${playerPosition} played ${card}`,
        table: gs.table,
        next: positions[gs.turnIdx]
      });
    }

    // Resolve trick
    const leadSuit = gs.table[0].card.slice(-1);
    let best = gs.table[0];
    for (let i = 1; i < gs.table.length; i++) {
      const a = gs.table[i];
      if (rankValue(a.card, leadSuit, gs.trump) > rankValue(best.card, leadSuit, gs.trump)) {
        best = a;
      }
    }

    const winner = best.player;
    gs.table = [];
    gs.turnIdx = positions.indexOf(winner);

    const team = teamOf(winner);
    gs.trickCount[team]++;
    table.addLog(`${winner} won the trick`);

    // Check if hand is over (5 tricks)
    const totalTricks = gs.trickCount.teamNS + gs.trickCount.teamEW;
    if (totalTricks >= 5) {
      // Score the hand
      const makerTeam = teamOf(gs.maker);
      const makerTricks = gs.trickCount[makerTeam];
      const defenderTricks = 5 - makerTricks;

      let points = 0;
      if (makerTricks >= 3) {
        points = makerTricks === 5 ? 2 : 1; // March = 2, 3-4 tricks = 1
        gs.score[makerTeam] += points;
        table.addLog(`${makerTeam} scored ${points} point(s)`);
      } else {
        // Euchred!
        const defenderTeam = makerTeam === 'teamNS' ? 'teamEW' : 'teamNS';
        gs.score[defenderTeam] += 2;
        table.addLog(`${makerTeam} got euchred! ${defenderTeam} scores 2 points`);
      }

      // Check for game win (10 points)
      let winnerMsg = null;
      if (gs.score.teamNS >= 10 || gs.score.teamEW >= 10) {
        const gameWinner = gs.score.teamNS >= 10 ? 'teamNS' : 'teamEW';
        gs.gamesWon[gameWinner]++;
        winnerMsg = `${gameWinner === 'teamNS' ? 'North/South' : 'East/West'} win the game!`;
        table.addLog(winnerMsg);
        gs.score = { teamNS: 0, teamEW: 0 };
      }

      // Rotate dealer and start new hand
      gs.dealerIdx = leftOf(gs.dealerIdx);
      dealAndStartBidding(table);
      table.addLog(`New hand. ${positions[gs.dealerIdx]} is dealer.`);

      await table.save();

      return res.json({
        success: true,
        trickWinner: winner,
        team,
        handComplete: true,
        winnerMsg,
        nextHand: {
          dealer: positions[gs.dealerIdx],
          upcard: gs.upcard,
          phase: gs.phase,
          turn: positions[gs.turnIdx]
        },
        score: gs.score,
        gamesWon: gs.gamesWon
      });
    }

    await table.save();

    res.json({
      success: true,
      trickWinner: winner,
      team,
      next: positions[gs.turnIdx],
      trickCount: gs.trickCount
    });
  } catch (error) {
    console.error('Play card error:', error);
    res.status(500).json({ error: 'Failed to play card' });
  }
});

// Get table state
router.get('/tables/:tableId/state', async (req, res) => {
  try {
    const { tableId } = req.params;

    let table = await EukerTable.findById(tableId);

    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }

    table = await populateTableSeats(table);

    res.json({ success: true, table });
  } catch (error) {
    console.error('Get state error:', error);
    res.status(500).json({ error: 'Failed to get state' });
  }
});

// === BOT MANAGEMENT ===

// Add a bot to the table
router.post('/tables/:tableId/add-bot', requireAuth, async (req, res) => {
  try {
    const { tableId } = req.params;
    const { difficulty } = req.body;

    const table = await EukerTable.findById(tableId);
    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }

    if (isFull(table)) {
      return res.status(400).json({ error: 'Table is full' });
    }

    // Find available position
    const availablePos = ['North', 'East', 'South', 'West'].find(
      pos => !table.seats[pos].user
    );

    if (!availablePos) {
      return res.status(400).json({ error: 'No available seats' });
    }

    // Pick a random bot name/difficulty
    const botConfig = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
    const botDifficulty = difficulty || botConfig.difficulty;

    // Create bot in database
    const bot = await EukerBot.create({
      displayName: botConfig.name,
      difficulty: botDifficulty
    });

    // Add bot to table
    table.seats[availablePos].user = bot._id;
    table.seats[availablePos].isReady = true; // Bots are always ready
    table.addLog(`Bot ${bot.displayName} joined as ${availablePos}`);

    await table.save();

    res.json({ success: true, position: availablePos, bot: bot.displayName });
  } catch (error) {
    console.error('Add bot error:', error);
    res.status(500).json({ error: 'Failed to add bot' });
  }
});

// Remove a bot from the table
router.post('/tables/:tableId/remove-bot/:position', requireAuth, async (req, res) => {
  try {
    const { tableId, position } = req.params;

    const table = await EukerTable.findById(tableId)
      .populate('seats.North.user seats.East.user seats.South.user seats.West.user');

    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }

    if (!table.seats[position].user) {
      return res.status(400).json({ error: 'No player in that seat' });
    }

    const userId = table.seats[position].user._id || table.seats[position].user;

    // Check if it's a bot
    const bot = await EukerBot.findById(userId);
    if (!bot) {
      return res.status(400).json({ error: 'That player is not a bot' });
    }

    // Remove bot
    table.seats[position].user = null;
    table.seats[position].isReady = false;
    table.addLog(`Bot removed from ${position}`);

    await table.save();
    await EukerBot.findByIdAndDelete(bot._id);

    res.json({ success: true });
  } catch (error) {
    console.error('Remove bot error:', error);
    res.status(500).json({ error: 'Failed to remove bot' });
  }
});

// Fill empty seats with bots
router.post('/tables/:tableId/fill-with-bots', requireAuth, async (req, res) => {
  try {
    const { tableId } = req.params;

    const table = await EukerTable.findById(tableId);
    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }

    const emptySeats = ['North', 'East', 'South', 'West'].filter(
      pos => !table.seats[pos].user
    );

    const botsAdded = [];

    for (const position of emptySeats) {
      const botConfig = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];

      const bot = await EukerBot.create({
        displayName: botConfig.name,
        difficulty: botConfig.difficulty
      });

      table.seats[position].user = bot._id;
      table.seats[position].isReady = true;
      table.addLog(`Bot ${bot.displayName} (${bot.difficulty}) joined as ${position}`);

      botsAdded.push({ position, name: bot.displayName, difficulty: bot.difficulty });
    }

    await table.save();

    res.json({ success: true, botsAdded });
  } catch (error) {
    console.error('Fill with bots error:', error);
    res.status(500).json({ error: 'Failed to fill with bots' });
  }
});

// Bot makes a move (called automatically or manually for testing)
router.post('/tables/:tableId/bot-move/:position', async (req, res) => {
  try {
    const { tableId, position } = req.params;

    const table = await EukerTable.findById(tableId)
      .populate('seats.North.user seats.East.user seats.South.user seats.West.user');

    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }

    const positions = ['North', 'East', 'South', 'West'];
    const currentTurnPos = positions[table.gameState.turnIdx];

    if (currentTurnPos !== position) {
      return res.status(400).json({ error: 'Not this bot\'s turn' });
    }

    const seat = table.seats[position];
    if (!seat.user) {
      return res.status(400).json({ error: 'No player in seat' });
    }

    // Get bot data
    const botData = await EukerBot.findById(seat.user._id || seat.user);
    if (!botData) {
      return res.status(400).json({ error: 'Not a bot' });
    }

    const bot = new BotAI(botData.displayName, botData.difficulty);
    const gs = table.gameState;

    let action = null;

    // Bidding phase
    if (gs.phase === 'bidding1') {
      const shouldOrder = bot.decideBidRound1(
        gs.hands[position],
        gs.upcard,
        positions.indexOf(position),
        gs.dealerIdx
      );

      action = shouldOrder ? { type: 'bid', action: 'order' } : { type: 'bid', action: 'pass' };
    } else if (gs.phase === 'bidding2') {
      const chosenSuit = bot.decideBidRound2(
        gs.hands[position],
        gs.upcard.slice(-1),
        positions.indexOf(position),
        gs.dealerIdx
      );

      if (chosenSuit) {
        action = { type: 'bid', action: 'choose', suit: chosenSuit };
      } else {
        // Check if dealer must choose
        if (positions.indexOf(position) === gs.dealerIdx) {
          // Force choose best suit
          const excludeSuit = gs.upcard.slice(-1);
          const suits = SUITS.filter(s => s !== excludeSuit);
          const chosenSuit = suits[Math.floor(Math.random() * suits.length)];
          action = { type: 'bid', action: 'choose', suit: chosenSuit };
        } else {
          action = { type: 'bid', action: 'pass' };
        }
      }
    } else if (gs.phase === 'play') {
      const card = bot.chooseCard(gs.hands[position], gs.table, gs.trump);
      action = { type: 'play', card };
    }

    if (!action) {
      return res.status(400).json({ error: 'Bot could not decide action' });
    }

    // Execute the action
    if (action.type === 'bid') {
      const actor = positions[gs.turnIdx];
      const dealer = positions[gs.dealerIdx];
      const upSuit = gs.upcard.slice(-1);

      if (gs.phase === 'bidding1') {
        if (action.action === 'order') {
          gs.trump = upSuit;
          gs.maker = actor;
          gs.phase = 'play';
          gs.turnIdx = leftOf(gs.dealerIdx);
          table.addLog(`${actor} ordered up ${upSuit}`);
        } else {
          if (gs.turnIdx === gs.dealerIdx) {
            gs.phase = 'bidding2';
            gs.turnIdx = leftOf(gs.dealerIdx);
            table.addLog(`${dealer} passed. Round 2 bidding.`);
          } else {
            gs.turnIdx = leftOf(gs.turnIdx);
            table.addLog(`${actor} passed`);
          }
        }
      } else if (gs.phase === 'bidding2') {
        if (action.action === 'choose') {
          gs.trump = action.suit;
          gs.maker = actor;
          gs.phase = 'play';
          gs.turnIdx = leftOf(gs.dealerIdx);
          table.addLog(`${actor} chose ${action.suit} as trump`);
        } else {
          gs.turnIdx = leftOf(gs.turnIdx);
          table.addLog(`${actor} passed`);
        }
      }

      await table.save();
      return res.json({ success: true, action, gameState: gs });
    } else if (action.type === 'play') {
      // Play the card
      gs.hands[position] = gs.hands[position].filter(c => c !== action.card);
      gs.table.push({ player: position, card: action.card });
      table.addLog(`${position} played ${action.card}`);

      // Check if trick is complete
      if (gs.table.length >= 4) {
        const leadSuit = gs.table[0].card.slice(-1);
        let best = gs.table[0];
        for (let i = 1; i < gs.table.length; i++) {
          const a = gs.table[i];
          if (rankValue(a.card, leadSuit, gs.trump) > rankValue(best.card, leadSuit, gs.trump)) {
            best = a;
          }
        }

        const winner = best.player;
        gs.table = [];
        gs.turnIdx = positions.indexOf(winner);

        const team = teamOf(winner);
        gs.trickCount[team]++;
        table.addLog(`${winner} won the trick`);

        // Check if hand is over
        const totalTricks = gs.trickCount.teamNS + gs.trickCount.teamEW;
        if (totalTricks >= 5) {
          const makerTeam = teamOf(gs.maker);
          const makerTricks = gs.trickCount[makerTeam];

          if (makerTricks >= 3) {
            const points = makerTricks === 5 ? 2 : 1;
            gs.score[makerTeam] += points;
            table.addLog(`${makerTeam} scored ${points} point(s)`);
          } else {
            const defenderTeam = makerTeam === 'teamNS' ? 'teamEW' : 'teamNS';
            gs.score[defenderTeam] += 2;
            table.addLog(`${makerTeam} got euchred! ${defenderTeam} scores 2 points`);
          }

          if (gs.score.teamNS >= 10 || gs.score.teamEW >= 10) {
            const gameWinner = gs.score.teamNS >= 10 ? 'teamNS' : 'teamEW';
            gs.gamesWon[gameWinner]++;
            table.addLog(`${gameWinner === 'teamNS' ? 'North/South' : 'East/West'} win the game!`);
            gs.score = { teamNS: 0, teamEW: 0 };
          }

          gs.dealerIdx = leftOf(gs.dealerIdx);
          dealAndStartBidding(table);
          table.addLog(`New hand. ${positions[gs.dealerIdx]} is dealer.`);
        }
      } else {
        gs.turnIdx = leftOf(gs.turnIdx);
      }

      await table.save();
      return res.json({ success: true, action, gameState: gs });
    }
  } catch (error) {
    console.error('Bot move error:', error);
    res.status(500).json({ error: 'Failed to execute bot move' });
  }
});

export default router;
