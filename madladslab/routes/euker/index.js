// routes/euker.js
import { Router } from 'express';
const router = Router();

const SUITS = ['H','D','C','S'];
const RANKS = ['9','10','J','Q','K','A'];

const sameColor = { H:'D', D:'H', C:'S', S:'C' };

const makeDeck = () => SUITS.flatMap(s => RANKS.map(r => r + s));
const shuffle = a => { for (let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]];} return a; };

let gs = {
  players: ['North','East','South','West'],
  dealerIdx: 0,
  turnIdx: 0,            // bidding/play turn pointer
  phase: 'idle',         // 'bidding1' | 'bidding2' | 'play'
  deck: [],
  upcard: null,
  trump: null,
  hands: { North:[], East:[], South:[], West:[] },
  table: [],             // [{player, card}]
  score: { teamNS:0, teamEW:0 },
  gamesWon: { teamNS:0, teamEW:0 }
};

const leftOf = i => (i+1)%4;
const playerAt = i => gs.players[i];
const teamOf = p => (p==='North'||p==='South') ? 'teamNS' : 'teamEW';

function dealAndStartBidding() {
  gs.deck = shuffle(makeDeck());
  // deal 5 each
  gs.hands = { North:[], East:[], South:[], West:[] };
  for (let r=0;r<5;r++) gs.players.forEach(p => gs.hands[p].push(gs.deck.shift()));
  gs.upcard = gs.deck.shift();
  gs.trump = null;
  gs.table = [];
  gs.phase = 'bidding1';
  gs.turnIdx = leftOf(gs.dealerIdx); // first to act is left of dealer
}

function rankValue(card, leadSuit) {
  const rank = card.slice(0, -1);
  const suit = card.slice(-1);
  const trump = gs.trump;
  const left = sameColor[trump];

  // Right bower (J of trump)
  if (rank==='J' && suit===trump) return 100;
  // Left bower (J of same color) counts as trump
  if (rank==='J' && suit===left) return 99;

  // trump cards outrank non-trump
  const isTrump = (suit===trump) || (rank==='J' && suit===left);
  const isLead = (suit===leadSuit) || (rank==='J' && suit===left && left===leadSuit);

  const base = { 'A':6,'K':5,'Q':4,'10':3,'9':2,'J':1 }[rank] || 0;

  if (isTrump) return 50 + base;         // trump tier
  if (isLead)  return 20 + base;         // follow-suit tier
  return base;                           // off-suit
}

router.get('/', (req,res)=> {
  res.render('euker', {
    message: 'Euker — NS vs EW. First to 10 points wins a game.',
    rules: 'Round 1: order up upcard suit. Round 2: choose other suit (dealer must decide by end). Round 3: play — Right bower > Left bower > A…',
    gameState: gs
  });
});

// Start a new hand (deal + bidding round 1)
router.post('/start', (req,res)=>{
  dealAndStartBidding();
  return res.json({ message:'Dealt. Bidding round 1.', upcard: gs.upcard, dealer: playerAt(gs.dealerIdx), turn: playerAt(gs.turnIdx), phase: gs.phase });
});

// Bid endpoint
// body: { action: 'order' | 'pass' | 'choose', suit? }
router.post('/bid', (req,res)=>{
  const { action, suit } = req.body;
  if (!['bidding1','bidding2'].includes(gs.phase)) return res.status(400).json({ error:'Not in bidding.' });

  const actor = playerAt(gs.turnIdx);
  const dealer = playerAt(gs.dealerIdx);
  const upSuit = gs.upcard.slice(-1);

  if (gs.phase==='bidding1') {
    if (action==='order') {
      gs.trump = upSuit;
      gs.phase = 'play';
      gs.turnIdx = leftOf(gs.dealerIdx); // leader of first trick
      return res.json({ message:`${actor} ordered up ${upSuit}. Trump set.`, trump: gs.trump, phase: gs.phase, lead: playerAt(gs.turnIdx) });
    }
    // pass
    if (gs.turnIdx === gs.dealerIdx) {
      // dealer passed, flip down -> round 2
      gs.phase = 'bidding2';
      gs.turnIdx = leftOf(gs.dealerIdx);
      return res.json({ message:`Dealer (${dealer}) passed. Upcard flipped down. Round 2.`, phase: gs.phase, turn: playerAt(gs.turnIdx) });
    } else {
      gs.turnIdx = leftOf(gs.turnIdx);
      return res.json({ message:`${actor} passed.`, turn: playerAt(gs.turnIdx), phase: gs.phase });
    }
  }

  // bidding2
  if (action==='choose') {
    if (!suit || !SUITS.includes(suit) || suit===upSuit) return res.status(400).json({ error:'Choose a valid non-upcard suit.' });
    gs.trump = suit;
    gs.phase = 'play';
    gs.turnIdx = leftOf(gs.dealerIdx);
    return res.json({ message:`${actor} chose ${suit}. Trump set.`, trump: gs.trump, phase: gs.phase, lead: playerAt(gs.turnIdx) });
  } else {
    // pass; if dealer and last pass -> dealer must choose
    const nextIdx = leftOf(gs.turnIdx);
    const isDealerPassingLast = (gs.turnIdx===gs.dealerIdx);
    if (isDealerPassingLast) {
      return res.status(400).json({ error:`Dealer (${dealer}) must choose a suit at end of round 2.` });
    }
    gs.turnIdx = nextIdx;
    return res.json({ message:`${actor} passed.`, turn: playerAt(gs.turnIdx), phase: gs.phase });
  }
});

// Dealer forced choose in round 2
// body: { suit }
router.post('/dealer-choose', (req,res)=>{
  if (gs.phase!=='bidding2') return res.status(400).json({ error:'Not in round 2.' });
  if (playerAt(gs.turnIdx)!==playerAt(gs.dealerIdx)) return res.status(400).json({ error:'Not dealer turn.' });
  const { suit } = req.body;
  const upSuit = gs.upcard.slice(-1);
  if (!suit || !SUITS.includes(suit) || suit===upSuit) return res.status(400).json({ error:'Dealer must choose a different suit.' });
  gs.trump = suit;
  gs.phase = 'play';
  gs.turnIdx = leftOf(gs.dealerIdx);
  return res.json({ message:`Dealer chose ${suit}. Trump set.`, trump: gs.trump, lead: playerAt(gs.turnIdx) });
});

// Play a card (Round 3)
router.post('/play', (req,res)=>{
  if (gs.phase!=='play') return res.status(400).json({ error:'Not in play phase.' });
  const { player, card } = req.body;
  if (playerAt(gs.turnIdx)!==player) return res.status(400).json({ error:`Not ${player}'s turn.` });
  if (!gs.hands[player]?.includes(card)) return res.status(400).json({ error:'Card not in hand.' });

  // play
  gs.hands[player] = gs.hands[player].filter(c => c !== card);
  gs.table.push({ player, card });

  // advance turn or resolve trick
  if (gs.table.length < 4) {
    gs.turnIdx = leftOf(gs.turnIdx);
    return res.json({ message:`${player} played ${card}`, table: gs.table, next: playerAt(gs.turnIdx) });
  }

  // resolve trick
  const leadSuit = gs.table[0].card.slice(-1);
  let best = gs.table[0];
  for (let i=1;i<gs.table.length;i++){
    const a = gs.table[i];
    if (rankValue(a.card, leadSuit) > rankValue(best.card, leadSuit)) best = a;
  }
  const winner = best.player;
  gs.table = [];
  gs.turnIdx = gs.players.indexOf(winner); // winner leads next

  // (optional) increment points per trick; here award 1 point to winner's team per trick
  const t = teamOf(winner);
  gs.score[t]++;

  // check game to 10
  let winnerMsg = null;
  if (gs.score.teamNS>=10 || gs.score.teamEW>=10) {
    if (gs.score.teamNS>=10) gs.gamesWon.teamNS++; else gs.gamesWon.teamEW++;
    winnerMsg = gs.score.teamNS>=10 ? 'North/South win the game' : 'East/West win the game';
    // rotate dealer, reset for next hand
    gs.dealerIdx = leftOf(gs.dealerIdx);
    gs.score = { teamNS:0, teamEW:0 };
    dealAndStartBidding(); // auto-deal next hand
    return res.json({ trickWinner:winner, team:t, winnerMsg, nextHand:{ dealer: playerAt(gs.dealerIdx), upcard: gs.upcard, phase: gs.phase, turn: playerAt(gs.turnIdx) }, gamesWon: gs.gamesWon });
  }

  return res.json({ trickWinner:winner, team:t, next: playerAt(gs.turnIdx), score: gs.score });
});

router.get('/state', (req,res)=> res.json({ gameState: gs }));

export default router;
