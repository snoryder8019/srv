export const PRIORITY_SCORE = { high: 3, medium: 2, low: 1 };

export function buildTaskDoc(agentId, task, source) {
    const priority = ['high', 'medium', 'low'].includes(task.priority) ? task.priority : 'medium';
    return {
        agentId,
        title: String(task.title || '').substring(0, 200),
        description: String(task.description || '').substring(0, 500),
        priority,
        priorityScore: PRIORITY_SCORE[priority],
        status: 'pending',
        source,
        createdAt: new Date()
    };
}

// Inserts tasks up to a pending cap. Returns the number of docs inserted.
export async function insertTasksCapped(col, agentId, tasks, source, max = 10) {
    const valid = (Array.isArray(tasks) ? tasks : []).filter(t => t?.title);
    if (!valid.length) return 0;
    const pending = await col.countDocuments({ agentId, status: 'pending' });
    const slots = Math.max(0, max - pending);
    if (!slots) return 0;
    const docs = valid.slice(0, slots).map(t => buildTaskDoc(agentId, t, source));
    await col.insertMany(docs);
    return docs.length;
}
