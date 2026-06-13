/**
 * table.js — seating, partnerships and turn rotation for a 4-seat table.
 *
 * Seats are 0..N-1 clockwise. For 4-player partnership games (euchre), partners
 * sit across: team A = {0,2}, team B = {1,3}. The engine tracks the dealer and
 * whose turn it is; the variant decides what a "turn" means (bid, play, etc.).
 *
 * State here is intentionally small and serializable so the game engine on the
 * cards platform can snapshot/restore a table and survive reconnects.
 */

export class Table {
  constructor({ seats = 4, dealer = 0 } = {}) {
    this.seats = seats;
    this.dealer = dealer;
    this.turn = this.next(dealer); // left of dealer acts first by default
  }

  next(seat) {
    return (seat + 1) % this.seats;
  }

  prev(seat) {
    return (seat - 1 + this.seats) % this.seats;
  }

  // Seats in play order starting left of a given seat (default: left of dealer).
  order(from = this.next(this.dealer)) {
    const out = [];
    let s = from;
    for (let i = 0; i < this.seats; i++) {
      out.push(s);
      s = this.next(s);
    }
    return out;
  }

  // Partnership of a seat for 4-player cross-partner games: 0 = {0,2}, 1 = {1,3}.
  team(seat) {
    return seat % 2;
  }

  partner(seat) {
    return (seat + 2) % this.seats;
  }

  advanceTurn() {
    this.turn = this.next(this.turn);
    return this.turn;
  }

  rotateDealer() {
    this.dealer = this.next(this.dealer);
    this.turn = this.next(this.dealer);
    return this.dealer;
  }

  snapshot() {
    return { seats: this.seats, dealer: this.dealer, turn: this.turn };
  }

  static restore(s) {
    const t = new Table({ seats: s.seats, dealer: s.dealer });
    t.turn = s.turn;
    return t;
  }
}
