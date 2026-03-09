/**
 * Socket.io Namespace for AI Agents
 * Handles real-time log streaming and agent updates
 */

import Agent from "../../api/v1/models/Agent.js";

export function registerAgents(io) {
  const agentsNamespace = io.of('/agents');

  agentsNamespace.on('connection', (socket) => {
    console.log('Agent socket connected:', socket.id);

    // Subscribe to specific agent's room
    socket.on('subscribe', (agentId) => {
      if (!agentId) {
        socket.emit('error', { message: 'Agent ID is required' });
        return;
      }

      const room = `agent-${agentId}`;
      socket.join(room);
      console.log(`Socket ${socket.id} subscribed to ${room}`);

      socket.emit('subscribed', {
        agentId,
        room,
        message: 'Successfully subscribed to agent updates'
      });
    });

    // Unsubscribe from agent's room
    socket.on('unsubscribe', (agentId) => {
      if (!agentId) return;

      const room = `agent-${agentId}`;
      socket.leave(room);
      console.log(`Socket ${socket.id} unsubscribed from ${room}`);

      socket.emit('unsubscribed', { agentId, room });
    });

    // Request initial logs for an agent
    socket.on('requestLogs', async (agentId) => {
      try {
        const agent = await Agent.findById(agentId);

        if (!agent) {
          socket.emit('error', { message: 'Agent not found' });
          return;
        }

        // Send last 50 logs
        const recentLogs = agent.logs.slice(-50).reverse();
        socket.emit('logs:initial', {
          agentId,
          logs: recentLogs
        });
      } catch (error) {
        console.error('Error fetching initial logs:', error);
        socket.emit('error', { message: 'Failed to fetch logs' });
      }
    });

    // Request memory data
    socket.on('requestMemory', async (agentId) => {
      try {
        const agent = await Agent.findById(agentId);

        if (!agent) {
          socket.emit('error', { message: 'Agent not found' });
          return;
        }

        socket.emit('memory:data', {
          agentId,
          memory: {
            conversations: agent.memory.conversations.slice(-20).reverse(),
            knowledgeBase: agent.memory.knowledgeBase,
            stats: agent.memory.stats
          }
        });
      } catch (error) {
        console.error('Error fetching memory:', error);
        socket.emit('error', { message: 'Failed to fetch memory' });
      }
    });

    socket.on('disconnect', () => {
      console.log('Agent socket disconnected:', socket.id);
    });
  });

  return agentsNamespace;
}

/**
 * Emit new log to all clients subscribed to this agent
 * Call this from routes when a new log is added
 */
export function emitAgentLog(io, agentId, log) {
  const agentsNamespace = io.of('/agents');
  agentsNamespace.to(`agent-${agentId}`).emit('log:new', {
    agentId,
    log
  });
}

/**
 * Emit agent status change to all subscribed clients
 */
export function emitAgentStatusChange(io, agentId, status) {
  const agentsNamespace = io.of('/agents');
  agentsNamespace.to(`agent-${agentId}`).emit('status:change', {
    agentId,
    status
  });
}

/**
 * Emit memory update to all subscribed clients
 */
export function emitMemoryUpdate(io, agentId, memoryType, data) {
  const agentsNamespace = io.of('/agents');
  agentsNamespace.to(`agent-${agentId}`).emit('memory:update', {
    agentId,
    memoryType,
    data
  });
}

/**
 * Emit tuning update to all subscribed clients
 */
export function emitTuningUpdate(io, agentId, tuningData) {
  const agentsNamespace = io.of('/agents');
  agentsNamespace.to(`agent-${agentId}`).emit('tuning:update', {
    agentId,
    tuningData
  });
}

/**
 * Emit new agent action (TLDR, task list, background finding, file write)
 */
export function emitActionNew(io, agentId, action) {
  const agentsNamespace = io.of('/agents');
  agentsNamespace.to(`agent-${agentId}`).emit('action:new', { agentId, action });
}

/**
 * Emit background process status change
 */
export function emitBackgroundStatus(io, agentId, status, data = {}) {
  const agentsNamespace = io.of('/agents');
  agentsNamespace.to(`agent-${agentId}`).emit(`background:${status}`, { agentId, ...data });
}

/**
 * Emit tool call start event (before executing the tool)
 */
export function emitToolCall(io, agentId, { callId, tool, args }) {
  const agentsNamespace = io.of('/agents');
  agentsNamespace.to(`agent-${agentId}`).emit('tool:call', { agentId, callId, tool, args });
}

/**
 * Emit tool result event (after executing the tool)
 */
export function emitToolResult(io, agentId, { callId, tool, success, error }) {
  const agentsNamespace = io.of('/agents');
  agentsNamespace.to(`agent-${agentId}`).emit('tool:result', { agentId, callId, tool, success, error: error || null });
}

/**
 * Push a proactive agent message into the chat window
 * Emit when agent has something to say without a user prompt
 */
export function emitAgentPush(io, agentId, { type, title, content, actionId }) {
  const agentsNamespace = io.of('/agents');
  agentsNamespace.to(`agent-${agentId}`).emit('agent:push', {
    agentId, type, title, content, actionId, timestamp: new Date()
  });
}

export default {
  registerAgents,
  emitAgentLog,
  emitAgentStatusChange,
  emitMemoryUpdate,
  emitTuningUpdate,
  emitToolCall,
  emitToolResult,
  emitActionNew,
  emitBackgroundStatus,
  emitAgentPush
};
