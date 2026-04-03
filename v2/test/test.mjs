#!/usr/bin/env node
/**
 * Tests for open-claude-code v2 core modules.
 *
 * Runs without external dependencies — uses a minimal assertion helper.
 * Tests: tool registry, permission checker, context manager, hook engine,
 *        streaming parser, and agent loop (with mocked API).
 */

import { createToolRegistry } from '../src/tools/registry.mjs';
import { createPermissionChecker } from '../src/permissions/checker.mjs';
import { ContextManager } from '../src/core/context-manager.mjs';
import { HookEngine } from '../src/hooks/engine.mjs';
import { accumulateStream } from '../src/core/streaming.mjs';

// ---------- Minimal test harness ----------

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
    if (condition) {
        passed++;
    } else {
        failed++;
        failures.push(message);
        console.error(`  FAIL: ${message}`);
    }
}

function assertEqual(actual, expected, message) {
    assert(actual === expected, `${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function section(name) {
    console.log(`\n--- ${name} ---`);
}

// ---------- Tool Registry Tests ----------

section('Tool Registry');

const registry = createToolRegistry();

// List tools
const toolList = registry.list();
assert(toolList.length >= 14, `Should have at least 14 tools, got ${toolList.length}`);

const toolNames = toolList.map(t => t.name);
assert(toolNames.includes('Bash'), 'Should include Bash tool');
assert(toolNames.includes('Read'), 'Should include Read tool');
assert(toolNames.includes('Edit'), 'Should include Edit tool');
assert(toolNames.includes('Write'), 'Should include Write tool');
assert(toolNames.includes('Glob'), 'Should include Glob tool');
assert(toolNames.includes('Grep'), 'Should include Grep tool');
assert(toolNames.includes('Agent'), 'Should include Agent tool');
assert(toolNames.includes('WebFetch'), 'Should include WebFetch tool');
assert(toolNames.includes('WebSearch'), 'Should include WebSearch tool');
assert(toolNames.includes('TodoWrite'), 'Should include TodoWrite tool');
assert(toolNames.includes('NotebookEdit'), 'Should include NotebookEdit tool');
assert(toolNames.includes('MultiEdit'), 'Should include MultiEdit tool');
assert(toolNames.includes('LS'), 'Should include LS tool');
assert(toolNames.includes('ToolSearch'), 'Should include ToolSearch tool');

// Each tool should have name, description, input_schema
for (const tool of toolList) {
    assert(typeof tool.name === 'string' && tool.name.length > 0, `Tool ${tool.name} has a name`);
    assert(typeof tool.description === 'string' && tool.description.length > 0, `Tool ${tool.name} has description`);
    assert(tool.input_schema && typeof tool.input_schema === 'object', `Tool ${tool.name} has input_schema`);
}

// Call unknown tool should throw
try {
    await registry.call('NonExistentTool', {});
    assert(false, 'Should throw for unknown tool');
} catch (e) {
    assert(e.message.includes('Unknown tool'), 'Unknown tool error message');
}

// Validation errors should return error string
const editResult = await registry.call('Edit', { file_path: '', old_string: '', new_string: '' });
assert(typeof editResult === 'string' && editResult.includes('Validation error'), 'Edit validation returns error');

// Register a custom tool
registry.register({
    name: 'CustomTest',
    description: 'Test tool',
    inputSchema: { type: 'object', properties: {} },
    validateInput() { return []; },
    async call() { return 'custom result'; },
});
assert(registry.has('CustomTest'), 'Custom tool registered');
const customResult = await registry.call('CustomTest', {});
assertEqual(customResult, 'custom result', 'Custom tool returns result');

// ---------- Tool Execution Tests ----------

section('Tool Execution');

// LS tool
const lsResult = await registry.call('LS', { path: '/tmp' });
assert(typeof lsResult === 'string', 'LS returns string');
assert(lsResult.includes('/tmp'), 'LS includes path');

// Read tool — read this test file
const readResult = await registry.call('Read', { file_path: import.meta.url.replace('file://', '') });
assert(typeof readResult === 'string', 'Read returns string');
assert(readResult.includes('Tool Registry Tests'), 'Read returns file content');

// TodoWrite tool
const todoResult = await registry.call('TodoWrite', {
    todos: [
        { content: 'Test task 1', status: 'pending', priority: 'high' },
        { content: 'Test task 2', status: 'completed', priority: 'low' },
    ],
});
assert(todoResult.includes('2 todos'), 'TodoWrite reports 2 todos');
assert(todoResult.includes('Test task 1'), 'TodoWrite includes task 1');

// WebSearch without API key
const searchResult = await registry.call('WebSearch', { query: 'test' });
assert(typeof searchResult === 'string', 'WebSearch returns string without API key');

// ToolSearch
const tsResult = await registry.call('ToolSearch', { query: 'bash' });
assert(typeof tsResult === 'string', 'ToolSearch returns string');
assert(tsResult.toLowerCase().includes('bash'), 'ToolSearch finds Bash tool');

// WebFetch validation
const fetchValidation = await registry.call('WebFetch', { url: 'not-a-url' });
assert(typeof fetchValidation === 'string' && fetchValidation.includes('Validation error'), 'WebFetch validates URL');

// ---------- Permission Checker Tests ----------

section('Permission Checker');

const bypassPerms = createPermissionChecker({ defaultMode: 'bypassPermissions' });
assert(await bypassPerms.check('Bash', {}), 'Bypass mode allows Bash');
assert(await bypassPerms.check('Write', {}), 'Bypass mode allows Write');

const planPerms = createPermissionChecker({ defaultMode: 'plan' });
assert(await planPerms.check('Read', {}), 'Plan mode allows Read');
assert(await planPerms.check('Glob', {}), 'Plan mode allows Glob');
assert(await planPerms.check('Grep', {}), 'Plan mode allows Grep');
assert(!(await planPerms.check('Bash', {})), 'Plan mode blocks Bash');
assert(!(await planPerms.check('Write', {})), 'Plan mode blocks Write');

const denyPerms = createPermissionChecker({ defaultMode: 'dontAsk' });
assert(!(await denyPerms.check('Read', {})), 'DontAsk mode blocks Read');

// ---------- Context Manager Tests ----------

section('Context Manager');

const ctx = new ContextManager(1000); // Small limit for testing

// Token counting
const messages = [
    { role: 'user', content: 'Hello, how are you?' },
    { role: 'assistant', content: 'I am doing well, thank you for asking!' },
];
const tokens = ctx.getTokenCount(messages);
assert(tokens > 0, `Token count should be positive, got ${tokens}`);

// Should not compact with small messages
assert(!ctx.shouldCompact(messages), 'Small messages should not trigger compaction');

// Should compact with large messages
const largeMessages = [];
for (let i = 0; i < 50; i++) {
    largeMessages.push({ role: 'user', content: 'x'.repeat(200) });
    largeMessages.push({ role: 'assistant', content: 'y'.repeat(200) });
}
assert(ctx.shouldCompact(largeMessages), 'Large messages should trigger compaction');

// Compaction preserves recent messages
const compacted = ctx.compact(largeMessages, 4);
assert(compacted.length <= 5, `Compacted should have <= 5 messages, got ${compacted.length}`);
assert(compacted[0].content.includes('[Context compacted'), 'Compacted has summary header');
assertEqual(ctx.compactionCount, 1, 'Compaction count incremented');

// addMessage with auto-compact
const ctx2 = new ContextManager(100);
let msgs = [];
for (let i = 0; i < 30; i++) {
    msgs = ctx2.addMessage(msgs, { role: 'user', content: 'test '.repeat(20) });
}
assert(msgs.length < 30, 'Auto-compaction reduced message count');

// Array content token counting
const arrayMsg = [{
    role: 'user',
    content: [
        { type: 'text', text: 'hello world' },
        { type: 'tool_result', content: 'some result data' },
    ],
}];
const arrayTokens = ctx.getTokenCount(arrayMsg);
assert(arrayTokens > 0, 'Array content token count is positive');

// ---------- Hook Engine Tests ----------

section('Hook Engine');

// Empty hooks — should allow everything
const emptyHooks = new HookEngine({});
const preResult = await emptyHooks.runPreToolUse('Bash', { command: 'ls' });
assert(preResult.allow === true, 'Empty hooks allow pre-tool');
const stopResult = await emptyHooks.runStop();
assert(stopResult === true, 'Empty hooks allow stop');

// Hook with handler function — blocking
const blockingHooks = new HookEngine({
    PreToolUse: [{
        name: 'block-rm',
        toolName: 'Bash',
        handler: async (ctx) => {
            if (ctx.input?.command?.includes('rm -rf')) {
                return { decision: 'deny', message: 'Dangerous command blocked' };
            }
            return { decision: 'allow' };
        },
    }],
});

const safeResult = await blockingHooks.runPreToolUse('Bash', { command: 'ls -la' });
assert(safeResult.allow === true, 'Safe command allowed');

const dangerousResult = await blockingHooks.runPreToolUse('Bash', { command: 'rm -rf /' });
assert(dangerousResult.allow === false, 'Dangerous command blocked');
assert(dangerousResult.message.includes('Dangerous'), 'Block message present');

// Hook applies only to specific tool
const readResult2 = await blockingHooks.runPreToolUse('Read', { file_path: '/etc/passwd' });
assert(readResult2.allow === true, 'Hook only applies to Bash, not Read');

// Post-tool hook modifying result
const modifyHooks = new HookEngine({
    PostToolUse: [{
        handler: async (ctx) => {
            return { modifiedResult: ctx.result + ' [modified]' };
        },
    }],
});

const postResult = await modifyHooks.runPostToolUse('Bash', 'original output');
assertEqual(postResult, 'original output [modified]', 'Post-hook modifies result');

// Stop hook preventing stop
const preventStopHooks = new HookEngine({
    Stop: [{
        handler: async () => ({ preventStop: true }),
    }],
});
const stopPrevented = await preventStopHooks.runStop();
assert(stopPrevented === false, 'Stop hook prevents stopping');

// ---------- Streaming Tests ----------

section('Streaming');

// Test accumulateStream with mock events
async function* mockEvents() {
    yield { type: 'message_start', message: { id: 'msg_1', model: 'test', usage: { input_tokens: 10 } } };
    yield { type: 'content_block_start', index: 0, content_block: { type: 'text' } };
    yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } };
    yield { type: 'content_block_delta', delta: { type: 'text_delta', text: ' world' } };
    yield { type: 'content_block_stop', index: 0 };
    yield { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } };
    yield { type: 'message_stop' };
}

const accumulated = await accumulateStream(mockEvents());
assertEqual(accumulated.id, 'msg_1', 'Accumulated message has correct ID');
assertEqual(accumulated.content.length, 1, 'Accumulated has one content block');
assertEqual(accumulated.content[0].type, 'text', 'Content block is text');
assertEqual(accumulated.content[0].text, 'Hello world', 'Text accumulated correctly');
assertEqual(accumulated.stop_reason, 'end_turn', 'Stop reason captured');
assertEqual(accumulated.usage.input_tokens, 10, 'Input tokens captured');
assertEqual(accumulated.usage.output_tokens, 5, 'Output tokens captured');

// Test with tool_use block
async function* mockToolEvents() {
    yield { type: 'message_start', message: { id: 'msg_2', model: 'test', usage: { input_tokens: 20 } } };
    yield { type: 'content_block_start', index: 0, content_block: { type: 'text' } };
    yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Let me check.' } };
    yield { type: 'content_block_stop', index: 0 };
    yield { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu_1', name: 'Bash' } };
    yield { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"com' } };
    yield { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: 'mand":"ls"}' } };
    yield { type: 'content_block_stop', index: 1 };
    yield { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 15 } };
}

const toolAccumulated = await accumulateStream(mockToolEvents());
assertEqual(toolAccumulated.content.length, 2, 'Two content blocks');
assertEqual(toolAccumulated.content[0].text, 'Let me check.', 'Text block correct');
assertEqual(toolAccumulated.content[1].type, 'tool_use', 'Second block is tool_use');
assertEqual(toolAccumulated.content[1].name, 'Bash', 'Tool name is Bash');
assertEqual(toolAccumulated.content[1].input.command, 'ls', 'Tool input parsed correctly');
assertEqual(toolAccumulated.stop_reason, 'tool_use', 'Stop reason is tool_use');

// Test with thinking block
async function* mockThinkingEvents() {
    yield { type: 'message_start', message: { id: 'msg_3', model: 'test', usage: { input_tokens: 5 } } };
    yield { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } };
    yield { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'Let me think...' } };
    yield { type: 'content_block_stop', index: 0 };
    yield { type: 'content_block_start', index: 1, content_block: { type: 'text' } };
    yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Here is my answer.' } };
    yield { type: 'content_block_stop', index: 1 };
    yield { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 10 } };
}

const thinkingAccumulated = await accumulateStream(mockThinkingEvents());
assertEqual(thinkingAccumulated.content.length, 2, 'Two blocks (thinking + text)');
assertEqual(thinkingAccumulated.content[0].type, 'thinking', 'First block is thinking');
assertEqual(thinkingAccumulated.content[0].thinking, 'Let me think...', 'Thinking text accumulated');
assertEqual(thinkingAccumulated.content[1].text, 'Here is my answer.', 'Text after thinking');

// ---------- Agent Loop Tests (mock API) ----------

section('Agent Loop (mock)');

// We test the agent loop structure without making real API calls
// by importing and checking the module exports
import { createAgentLoop } from '../src/core/agent-loop.mjs';

const mockTools = {
    list() {
        return [{ name: 'TestTool', description: 'Test', input_schema: { type: 'object', properties: {} } }];
    },
    async call(name, input) { return 'mock result'; },
};

const mockPerms = { async check() { return true; } };

const loop = createAgentLoop({
    model: 'test-model',
    tools: mockTools,
    permissions: mockPerms,
    settings: {},
});

assert(loop.run !== undefined, 'Agent loop has run method');
assert(loop.state !== undefined, 'Agent loop has state');
assertEqual(loop.state.turnCount, 0, 'Initial turn count is 0');
assert(Array.isArray(loop.state.messages), 'State has messages array');
assert(typeof loop.state.systemPrompt === 'string', 'State has system prompt string');

// ---------- MCP Client Tests (structural) ----------

section('MCP Client (structural)');

import { McpClient } from '../src/mcp/client.mjs';

const client = new McpClient({ command: 'echo', args: ['test'] });
assert(client.config.command === 'echo', 'MCP client stores command');
assert(client.requestId === 0, 'MCP client starts with requestId 0');
assert(client.tools.length === 0, 'MCP client starts with empty tools');

// ---------- Summary ----------

console.log('\n========================================');
console.log(`Tests: ${passed + failed} total, ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
    console.log('\nFailures:');
    failures.forEach(f => console.log(`  - ${f}`));
}
console.log('========================================');

process.exit(failed > 0 ? 1 : 0);
