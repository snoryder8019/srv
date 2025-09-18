// /api/v1/ep/contest.js
import Player from "../models/contest/Player.js";
import ContestAction from "../models/contest/ContestAction.js";
import Contest from "../models/contest/Contest.js";

// Player joins contest
export async function joinPlayer(data) {
  return await new Player().create(data);
}

// Submit action

const POINTS = { foodRun: 1, drinkRun: 1, preBus: 2, mistake: -1, steal: 1 };

// Submit action (auto-approve for now)
export async function submitAction(playerId, data) {
  const points = POINTS[data.action] ?? 0;
  return await new ContestAction().create({
    playerId,
    action: data.action,
    points,
    status: "approved",
    createdAt: new Date()
  });
}

// List pending actions
export async function listPending() {
  return await new ContestAction().getAll({ status: "pending" });
}

// Verify action (approve/reject)
export async function verifyAction(actionId, status, approvedBy) {
  return await new ContestAction().updateById(actionId, {
    status,
    approvedBy,
    updatedAt: new Date()
  });
}
// /api/v1/ep/contest.js
// /api/v1/ep/contest.js

//
// PLAYER HELPERS
//
export async function getPlayers() {
  return await new Player().getAll();
}

export async function getPlayerById(id) {
  return await new Player().getById(id);
}

export async function createPlayer(data) {
  return await new Player().create({
    ...data,
    joinedAt: new Date()
  });
}

export async function updatePlayer(id, data) {
  return await new Player().updateById(id, data);
}

//
// CONTEST HELPERS
//
export async function getContests() {
  return await new Contest().getAll();
}

export async function getContestById(id) {
  return await new Contest().getById(id);
}

export async function createContest(data) {
  return await new Contest().create({
    ...data,
    startDate: new Date(),
    status: "active"
  });
}

export async function updateContest(id, data) {
  return await new Contest().updateById(id, data);
}

export async function endContest(id) {
  return await new Contest().updateById(id, {
    status: "ended",
    endDate: new Date()
  });
}

export async function getScoreboard() {
  const actions = await new ContestAction().getAll({ status: "approved" });

  const scoreboard = {};

  actions.forEach(a => {
    const pid = a.playerId.toString();

    if (!scoreboard[pid]) {
      scoreboard[pid] = { playerId: pid, totalPoints: 0, steals: 0 };
    }

    scoreboard[pid].totalPoints += a.points || 0;
    if (a.action === "steal") {
      scoreboard[pid].steals += 1;
    }
  });

  // return as sorted array
  return Object.values(scoreboard).sort((a, b) => b.totalPoints - a.totalPoints);
}
