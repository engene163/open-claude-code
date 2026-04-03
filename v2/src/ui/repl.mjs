/**
 * REPL — interactive read-eval-print loop for open-claude-code.
 *
 * Supports slash commands and streaming output.
 */

import readline from 'readline';

const SLASH_COMMANDS = {
    '/help': 'Show available commands',
    '/clear': 'Clear conversation history',
    '/model': 'Show or switch model (e.g. /model claude-sonnet-4-6)',
    '/tokens': 'Show token usage',
    '/tools': 'List available tools',
    '/exit': 'Exit the REPL',
    '/quit': 'Exit the REPL',
};

/**
 * Start the interactive REPL.
 * @param {object} loop - agent loop instance (from createAgentLoop)
 * @param {object} settings - loaded settings
 */
export async function startRepl(loop, settings) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
    });

    console.log('open-claude-code v2 -- type your prompt or /help');
    console.log('');

    const askPrompt = () => {
        rl.question('> ', async (input) => {
            const trimmed = input.trim();
            if (!trimmed) { askPrompt(); return; }

            // Handle slash commands
            if (trimmed.startsWith('/')) {
                const handled = handleCommand(trimmed, loop, rl);
                if (handled === 'exit') { rl.close(); return; }
                askPrompt();
                return;
            }

            // Run through agent loop
            try {
                for await (const event of loop.run(trimmed)) {
                    renderEvent(event);
                }
                // Newline after streaming output
                console.log('');
            } catch (err) {
                console.error(`Error: ${err.message}`);
            }

            askPrompt();
        });
    };

    askPrompt();

    return new Promise((resolve) => {
        rl.on('close', resolve);
    });
}

/**
 * Handle a slash command.
 * @returns {'exit'|undefined}
 */
function handleCommand(input, loop, rl) {
    const parts = input.split(/\s+/);
    const cmd = parts[0].toLowerCase();

    switch (cmd) {
        case '/help':
            console.log('\nAvailable commands:');
            for (const [name, desc] of Object.entries(SLASH_COMMANDS)) {
                console.log(`  ${name.padEnd(12)} ${desc}`);
            }
            console.log('');
            break;

        case '/clear':
            loop.state.messages.length = 0;
            loop.state.turnCount = 0;
            console.log('Conversation cleared.');
            break;

        case '/model':
            if (parts[1]) {
                loop.state.model = parts[1];
                console.log(`Model switched to: ${parts[1]}`);
            } else {
                console.log(`Current model: ${loop.state.model || 'default'}`);
            }
            break;

        case '/tokens':
            console.log(`Token usage: input=${loop.state.tokenUsage.input}, output=${loop.state.tokenUsage.output}`);
            console.log(`Messages: ${loop.state.messages.length}, Turns: ${loop.state.turnCount}`);
            break;

        case '/tools': {
            const tools = loop.state.tools?.list?.() || [];
            if (tools.length === 0) {
                console.log('No tools registered.');
            } else {
                console.log('\nRegistered tools:');
                for (const t of tools) {
                    console.log(`  ${t.name.padEnd(16)} ${t.description.slice(0, 60)}`);
                }
                console.log('');
            }
            break;
        }

        case '/exit':
        case '/quit':
            console.log('Goodbye.');
            return 'exit';

        default:
            console.log(`Unknown command: ${cmd}. Type /help for available commands.`);
    }
}

/**
 * Render a single agent loop event to the terminal.
 */
function renderEvent(event) {
    switch (event.type) {
        case 'stream_event':
            process.stdout.write(event.text || '');
            break;
        case 'thinking':
            // Optionally show thinking in dim
            if (process.env.SHOW_THINKING) {
                process.stdout.write(`\x1b[2m${event.text}\x1b[0m`);
            }
            break;
        case 'tool_progress':
            process.stderr.write(`\x1b[33m[${event.tool}]\x1b[0m `);
            break;
        case 'result':
            if (process.env.SHOW_TOOL_RESULTS) {
                console.log(`\x1b[36m${String(event.result).slice(0, 200)}\x1b[0m`);
            }
            break;
        case 'assistant':
            // Already streamed via stream_event
            break;
        case 'stop':
            break;
        case 'error':
            console.error(`\x1b[31mError: ${event.message}\x1b[0m`);
            break;
    }
}
