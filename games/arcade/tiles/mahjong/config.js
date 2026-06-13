/**
 * Mahjong configuration — 136-tile set (no bonus), 13 tiles each, draw-and-
 * discard self-draw race (no claiming yet). A declared win is worth `win`, a
 * wall-exhaustion consolation is `wash`; first to `winScore` wins (1 = single
 * decisive hand for v1; raise once discard-claiming + richer scoring land).
 */
export default {
  id: 'mahjong',
  tiles: { set: 'mahjong', bonus: false },
  deal: { players: 4, wallPer: 13 },
  scoring: { winScore: 1, win: 2, wash: 1 },
  rules: { flowers: false, claiming: false },
  seating: { seats: 4, partnerships: null, fillWithBots: true },
};
