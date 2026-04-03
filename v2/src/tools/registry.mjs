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
import { AgentTool } from './agent.mjs';
import { WebFetchTool } from './web-fetch.mjs';
import { WebSearchTool } from './web-search.mjs';
import { TodoWriteTool } from './todo-write.mjs';
import { NotebookEditTool } from './notebook-edit.mjs';
import { MultiEditTool } from './multi-edit.mjs';
import { LsTool } from './ls.mjs';
import { ToolSearchTool } from './tool-search.mjs';

const BUILTIN_TOOLS = [
    BashTool,
    ReadTool,
    EditTool,
    WriteTool,
    GlobTool,
    GrepTool,
    AgentTool,
    WebFetchTool,
    WebSearchTool,
    TodoWriteTool,
    NotebookEditTool,
    MultiEditTool,
    LsTool,
    ToolSearchTool,
];

export function createToolRegistry() {
    const tools = new Map();
    for (const Tool of BUILTIN_TOOLS) {
        tools.set(Tool.name, Tool);
    }

    // Wire up ToolSearch with a reference to the registry
    const registry = {
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

        get(name) {
            return tools.get(name);
        },

        has(name) {
            return tools.has(name);
        },

        /**
         * Register MCP tools so they appear in the registry and are searchable.
         * @param {Array} mcpTools - tool definitions from MCP listTools
         * @param {function} callFn - function(name, args) to call the MCP tool
         */
        registerMcpTools(mcpTools, callFn) {
            ToolSearchTool._mcpTools = mcpTools;

            for (const mcpTool of mcpTools) {
                const wrapper = {
                    name: mcpTool.name,
                    description: mcpTool.description || '',
                    inputSchema: mcpTool.inputSchema || { type: 'object', properties: {} },
                    validateInput() { return []; },
                    async call(input) { return callFn(mcpTool.name, input); },
                };
                tools.set(mcpTool.name, wrapper);
            }
        },
    };

    ToolSearchTool._registry = registry;
    return registry;
}
