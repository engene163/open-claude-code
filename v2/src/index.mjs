#!/usr/bin/env node
/**
 * open-claude-code v2
 *
 * Open source implementation of Claude Code CLI architecture.
 * Based on ruDevolution decompilation of Claude Code v2.1.91.
 *
 * Architecture mirrors the actual Claude Code internals:
 * - Async generator agent loop (13 event types)
 * - 14 tools with validateInput/call interface
 * - MCP client (stdio transport)
 * - 6 permission modes + sandbox
 * - Context compaction + auto-compaction
 * - Hooks system (PreToolUse, PostToolUse, Stop)
 * - Settings chain (user/project/local/managed)
 * - Multi-provider support (Anthropic, OpenAI, Google)
 */

import { createAgentLoop } from './core/agent-loop.mjs';
import { createToolRegistry } from './tools/registry.mjs';
import { createPermissionChecker } from './permissions/checker.mjs';
import { loadSettings } from './config/settings.mjs';
import { parseArgs } from './config/cli-args.mjs';
import { HookEngine } from './hooks/engine.mjs';
import { McpClient } from './mcp/client.mjs';

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const settings = await loadSettings();
    const tools = createToolRegistry();
    const permissions = createPermissionChecker(settings.permissions);
    const hooks = new HookEngine(settings.hooks);

    // Connect MCP servers if configured
    const mcpClients = [];
    if (settings.mcpServers) {
        for (const [name, config] of Object.entries(settings.mcpServers)) {
            try {
                const client = new McpClient(config);
                await client.connect();
                const mcpTools = await client.listTools();
                tools.registerMcpTools(mcpTools, (toolName, toolArgs) => client.callTool(toolName, toolArgs));
                mcpClients.push(client);
            } catch (err) {
                console.error(`MCP server "${name}" failed to connect: ${err.message}`);
            }
        }
    }

    const loop = createAgentLoop({
        model: args.model || settings.model || 'claude-sonnet-4-6',
        tools,
        permissions,
        settings,
        hooks,
    });

    // Graceful shutdown
    const cleanup = async () => {
        for (const client of mcpClients) {
            await client.disconnect().catch(() => {});
        }
    };
    process.on('SIGINT', async () => { await cleanup(); process.exit(0); });
    process.on('SIGTERM', async () => { await cleanup(); process.exit(0); });

    if (args.prompt) {
        // Non-interactive: run prompt and exit
        for await (const event of loop.run(args.prompt)) {
            handleEvent(event);
        }
        await cleanup();
    } else {
        // Interactive REPL
        const { startRepl } = await import('./ui/repl.mjs');
        await startRepl(loop, settings);
        await cleanup();
    }
}

function handleEvent(event) {
    switch (event.type) {
        case 'stream_request_start':
            break;
        case 'stream_event':
            process.stdout.write(event.text || '');
            break;
        case 'thinking':
            if (process.env.SHOW_THINKING) {
                process.stdout.write(`\x1b[2m${event.text}\x1b[0m`);
            }
            break;
        case 'assistant':
            // Text already streamed via stream_event in streaming mode
            if (!event._streamed) console.log(event.content);
            break;
        case 'tool_progress':
            process.stderr.write(`\x1b[33m[${event.tool}]\x1b[0m `);
            break;
        case 'result':
            break;
        case 'compaction':
            process.stderr.write(`\x1b[2m[compaction #${event.count}]\x1b[0m\n`);
            break;
        case 'hookPermissionResult':
            if (!event.allowed) {
                process.stderr.write(`\x1b[31m[blocked: ${event.tool}]\x1b[0m\n`);
            }
            break;
        case 'error':
            console.error(`\x1b[31mError: ${event.message}\x1b[0m`);
            break;
        case 'stop':
            console.log('');
            break;
        default:
            break;
    }
}

main().catch(e => { console.error(e); process.exit(1); });
