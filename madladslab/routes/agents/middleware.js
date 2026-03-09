import axios from "axios";
import AgentAction from "../../api/v1/models/AgentAction.js";

export async function isAdmin(req, res, next) {
    const user = req.user;
    if (user && user.isAdmin === true) {
        return next();
    } else {
        return res.status(401).send('Unauthorized');
    }
}

export async function runResearcherMiddleware(agent, message, ollamaBaseUrl, ollamaApiKey) {
    const res = await axios.post(`${ollamaBaseUrl}/v1/chat/completions`, {
        model: agent.model,
        messages: [
            { role: 'system', content: 'You are a research assistant. Analyze the query and generate a concise TLDR research outline: 1) Core question, 2) Key points to address, 3) Relevant context. Be brief and structured.' },
            { role: 'user', content: message }
        ],
        temperature: 0.3,
        stream: false
    }, { headers: { 'Authorization': `Bearer ${ollamaApiKey}`, 'Content-Type': 'application/json' } });

    const action = new AgentAction({
        agentId: agent._id,
        type: 'tldr',
        title: `TLDR: ${message.substring(0, 60)}`,
        content: res.data.choices?.[0]?.message?.content || '',
        tokens: res.data.usage?.completion_tokens || 0,
        status: 'complete',
        fromMiddleware: true
    });
    await action.save();
    return action;
}

export async function runVibecoderMiddleware(agent, message, ollamaBaseUrl, ollamaApiKey) {
    const res = await axios.post(`${ollamaBaseUrl}/v1/chat/completions`, {
        model: agent.model,
        messages: [
            { role: 'system', content: 'You are a task planner. Break the user request into a clear numbered task list. Output only the task list, no introduction or commentary.' },
            { role: 'user', content: message }
        ],
        temperature: 0.3,
        stream: false
    }, { headers: { 'Authorization': `Bearer ${ollamaApiKey}`, 'Content-Type': 'application/json' } });

    const action = new AgentAction({
        agentId: agent._id,
        type: 'task_list',
        title: `Tasks: ${message.substring(0, 60)}`,
        content: res.data.choices?.[0]?.message?.content || '',
        tokens: res.data.usage?.completion_tokens || 0,
        status: 'complete',
        fromMiddleware: true
    });
    await action.save();
    return action;
}
