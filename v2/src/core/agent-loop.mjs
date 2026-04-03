/**
 * Agent Loop — async generator that processes messages through the LLM.
 * 
 * Based on decompiled Claude Code's `s$` function:
 * - Yields 13 event types
 * - Recursively calls itself after tool execution
 * - Handles streaming, tool calls, and stop conditions
 */

export function createAgentLoop({ model, tools, permissions, settings }) {
    const state = {
        messages: [],
        systemPrompt: '',
        turnCount: 0,
        tokenUsage: { input: 0, output: 0 },
    };

    async function* run(userMessage, options = {}) {
        state.messages.push({ role: 'user', content: userMessage });
        state.turnCount++;

        yield { type: 'stream_request_start', turn: state.turnCount };

        // Call LLM API
        const response = await callApi(model, state.messages, state.systemPrompt, tools.list(), settings);

        // Stream events
        for (const block of response.content) {
            if (block.type === 'text') {
                yield { type: 'stream_event', text: block.text };
                yield { type: 'assistant', content: block.text };
            }
            
            if (block.type === 'tool_use') {
                // Check permission
                const allowed = await permissions.check(block.name, block.input);
                if (!allowed) {
                    yield { type: 'hookPermissionResult', tool: block.name, allowed: false };
                    state.messages.push({
                        role: 'user',
                        content: [{ type: 'tool_result', tool_use_id: block.id, content: 'Permission denied' }],
                    });
                    continue;
                }

                // Execute tool
                yield { type: 'tool_progress', tool: block.name, status: 'running' };
                const result = await tools.call(block.name, block.input);
                yield { type: 'result', tool: block.name, result };

                // Add to messages
                state.messages.push({
                    role: 'user',
                    content: [{ type: 'tool_result', tool_use_id: block.id, content: result }],
                });

                // Recursive: continue the loop after tool execution
                yield* run(null, { continuation: true });
                return;
            }
        }

        yield { type: 'stop', reason: response.stop_reason };
    }

    return { run, state };
}

async function callApi(model, messages, systemPrompt, tools, settings) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

    const body = {
        model,
        max_tokens: 8192,
        messages,
        ...(systemPrompt && { system: systemPrompt }),
        ...(tools.length > 0 && { tools }),
    };

    const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`API error ${res.status}: ${err}`);
    }

    return res.json();
}
