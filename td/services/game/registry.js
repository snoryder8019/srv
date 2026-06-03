/**
 * Active games registry - maps runId -> live GameInstance.
 * Kept separate from the engine so handlers can look games up without
 * importing the whole instance module graph.
 */
const activeGames = new Map();

export function getGame(runId) { return activeGames.get(String(runId)); }
export function registerGame(runId, game) { activeGames.set(String(runId), game); }
export function unregisterGame(runId) { activeGames.delete(String(runId)); }
export function listGames() { return Array.from(activeGames.values()); }
