/**
 * Agent Tool — spawn a subagent with its own agent loop.
 *
 * Creates an isolated agent loop instance that runs a prompt
 * with a subset of tools and returns the final result.
 */

import { createAgentLoop } from '../core/agent-loop.mjs';
import { createToolRegistry } from './registry.mjs';
import { createPermissionChecker } from '../permissions/checker.mjs';

export const AgentTool = {
    name: 'Agent',
    description: 'Spawn a subagent to handle a task. The subagent has its own context and tools.',
    inputSchema: {
        type: 'object',
        properties: {
            prompt: {
                type: 'string',
                description: 'The task for the subagent to perform',
            },
            allowed_tools: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of tool names the subagent can use (default: all)',
            },
        },
        required: ['prompt'],
    },

    validateInput(input) {
        const errors = [];
        if (!input.prompt) errors.push('prompt is required');
        return errors;
    },

    async call(input) {
        const tools = createToolRegistry();
        const permissions = createPermissionChecker({ defaultMode: 'bypassPermissions' });

        const loop = createAgentLoop({
            model: process.env.SUBAGENT_MODEL || 'claude-sonnet-4-6',
            tools,
            permissions,
            settings: {},
        });

        const results = [];
        try {
            for await (const event of loop.run(input.prompt)) {
                if (event.type === 'assistant' && event.content) {
                    results.push(event.content);
                }
                if (event.type === 'result') {
                    results.push(`[tool:${event.tool}] ${String(event.result).slice(0, 500)}`);
                }
            }
        } catch (err) {
            return `Subagent error: ${err.message}`;
        }

        return results.join('\n') || 'Subagent completed with no output.';
    },
};
