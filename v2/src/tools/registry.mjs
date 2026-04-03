/**
 * Tool Registry — validateInput/call interface.
 * Mirrors Claude Code's tool dispatch system.
 */

import { BashTool } from './bash.mjs';
import { ReadTool } from './read.mjs';
import { EditTool } from './edit.mjs';
import { WriteTool } from './write.mjs';
import { GlobTool } from './glob.mjs';
import { GrepTool } from './grep.mjs';

const BUILTIN_TOOLS = [BashTool, ReadTool, EditTool, WriteTool, GlobTool, GrepTool];

export function createToolRegistry() {
    const tools = new Map();
    for (const Tool of BUILTIN_TOOLS) {
        tools.set(Tool.name, Tool);
    }

    return {
        list() {
            return [...tools.values()].map(t => ({
                name: t.name,
                description: t.description,
                input_schema: t.inputSchema,
            }));
        },

        async call(name, input) {
            const tool = tools.get(name);
            if (!tool) throw new Error(`Unknown tool: ${name}`);
            const errors = tool.validateInput?.(input) || [];
            if (errors.length > 0) return `Validation error: ${errors.join(', ')}`;
            return tool.call(input);
        },

        register(tool) {
            tools.set(tool.name, tool);
        },
    };
}
