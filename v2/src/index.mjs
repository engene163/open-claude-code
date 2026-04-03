#!/usr/bin/env node
/**
 * open-claude-code v2
 * 
 * Open source implementation of Claude Code CLI architecture.
 * Based on ruDevolution decompilation of Claude Code v2.1.91.
 * 
 * Architecture mirrors the actual Claude Code internals:
 * - Async generator agent loop (13 event types)
 * - 25+ tools with validateInput/call interface
 * - MCP client (stdio/SSE/shttp transports)
 * - 6 permission modes + sandbox
 * - Context compaction + micro-compaction
 * - Hooks system (6 events)
 * - Settings chain (user/project/local/managed)
 */

import { createAgentLoop } from './core/agent-loop.mjs';
import { createToolRegistry } from './tools/registry.mjs';
import { createPermissionChecker } from './permissions/checker.mjs';
import { loadSettings } from './config/settings.mjs';
import { parseArgs } from './config/cli-args.mjs';

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const settings = await loadSettings();
    const tools = createToolRegistry();
    const permissions = createPermissionChecker(settings.permissions);

    const loop = createAgentLoop({
        model: args.model || settings.model || 'claude-sonnet-4-6',
        tools,
        permissions,
        settings,
    });

    if (args.prompt) {
        // Non-interactive: run prompt and exit
        for await (const event of loop.run(args.prompt)) {
            handleEvent(event);
        }
    } else {
        // Interactive REPL
        const { startRepl } = await import('./ui/repl.mjs');
        await startRepl(loop, settings);
    }
}

function handleEvent(event) {
    switch (event.type) {
        case 'stream_request_start': break;
        case 'stream_event': process.stdout.write(event.text || ''); break;
        case 'assistant': console.log(event.content); break;
        case 'result': break;
        case 'stop': break;
        default: break;
    }
}

main().catch(e => { console.error(e); process.exit(1); });
