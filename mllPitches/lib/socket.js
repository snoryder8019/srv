import { Server } from 'socket.io';

const ROOM_PREFIX = 'pitch:';

const liveRooms = new Map();

function roomKey(slug) {
  return `${ROOM_PREFIX}${slug}`;
}

function getRoomState(slug) {
  if (!liveRooms.has(slug)) {
    liveRooms.set(slug, {
      role: 'upland-superadmin',
      workflow: null,
      lastActivity: new Date().toISOString(),
      emails: [],
      workflowPatches: {},      // map: keyed merge of all incoming workflow patches
      permissionChanges: {},    // map: keyed by perm or change id, last-write-wins
      taskDoneById: {},         // map: taskId -> boolean (true if done)
    });
  }
  return liveRooms.get(slug);
}

export function attachSockets(server) {
  const io = new Server(server, {
    cors: { origin: true, credentials: true },
    path: '/socket.io',
  });

  io.on('connection', (socket) => {
    socket.on('pitch:join', ({ slug }) => {
      if (!slug || typeof slug !== 'string') return;
      socket.join(roomKey(slug));
      const state = getRoomState(slug);
      socket.emit('pitch:state', state);
    });

    socket.on('pitch:role', ({ slug, role }) => {
      if (!slug || !role) return;
      const state = getRoomState(slug);
      state.role = role;
      state.lastActivity = new Date().toISOString();
      io.to(roomKey(slug)).emit('pitch:role', { role, ts: state.lastActivity });
    });

    // patch may include: { taskId, done, nodeId, nodeCompletedTaskIds:[ids] } — last two enable node-complete eval
    socket.on('pitch:workflow', ({ slug, patch }) => {
      if (!slug || !patch) return;
      const state = getRoomState(slug);
      state.workflow = { ...(state.workflow || {}), ...patch };
      // accumulate patches for replay on join
      const patchKey = patch.taskId || patch.id || `p_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      state.workflowPatches[patchKey] = { ...(state.workflowPatches[patchKey] || {}), ...patch };
      // track task completion if .done is present
      if (patch.taskId && typeof patch.done === 'boolean') {
        state.taskDoneById[patch.taskId] = patch.done;
      }
      state.lastActivity = new Date().toISOString();
      socket.to(roomKey(slug)).emit('pitch:workflow', patch);

      // server-side node-complete evaluation when client supplies node membership
      if (patch.nodeId && Array.isArray(patch.nodeCompletedTaskIds) && patch.nodeCompletedTaskIds.length) {
        const allDone = patch.nodeCompletedTaskIds.every((id) => state.taskDoneById[id] === true);
        if (allDone) {
          const ts = new Date().toISOString();
          io.to(roomKey(slug)).emit('pitch:node-complete', { nodeId: patch.nodeId, ts });
        }
      }
    });

    // change payload: { perm, role, control } — accepted as-is, broadcast unchanged
    socket.on('pitch:permission', ({ slug, change }) => {
      if (!slug || !change) return;
      const state = getRoomState(slug);
      const permKey = change.perm || change.id || `c_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      state.permissionChanges[permKey] = { ...(state.permissionChanges[permKey] || {}), ...change };
      state.lastActivity = new Date().toISOString();
      socket.to(roomKey(slug)).emit('pitch:permission', change);
    });

    socket.on('pitch:assign', ({ slug, assignment }) => {
      if (!slug || !assignment) return;
      const state = getRoomState(slug);
      state.lastActivity = new Date().toISOString();
      socket.to(roomKey(slug)).emit('pitch:assign', assignment);
    });
  });

  return io;
}

export function pushEmailToPitch(io, slug, email) {
  if (!io || !slug || !email) return;
  const state = getRoomState(slug);
  state.emails.unshift(email);
  if (state.emails.length > 50) state.emails.length = 50;
  state.lastActivity = new Date().toISOString();
  io.to(roomKey(slug)).emit('pitch:email', email);
}

export { roomKey, getRoomState };
