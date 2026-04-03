#!/usr/bin/env node
/**
 * Tests for open-claude-code v2 — all modules.
 *
 * Runs without external dependencies — uses a minimal assertion helper.
 * Target: 200+ tests covering all systems.
 */

import { createToolRegistry } from '../src/tools/registry.mjs';
import { createPermissionChecker } from '../src/permissions/checker.mjs';
import { ContextManager } from '../src/core/context-manager.mjs';
import { HookEngine } from '../src/hooks/engine.mjs';
import { accumulateStream } from '../src/core/streaming.mjs';
import { createAgentLoop } from '../src/core/agent-loop.mjs';
import { McpClient } from '../src/mcp/client.mjs';
import { SessionManager } from '../src/core/session.mjs';
import { CheckpointManager } from '../src/core/checkpoints.mjs';
import { PromptCache } from '../src/core/cache.mjs';
import { AgentLoader } from '../src/agents/loader.mjs';
import { parseAgentDefinition } from '../src/agents/parser.mjs';
import { SkillsLoader } from '../src/skills/loader.mjs';
import { SkillRunner } from '../src/skills/runner.mjs';
import { COMMANDS, executeCommand, getCompletions } from '../src/ui/commands.mjs';
import { Spinner, highlightCode, renderToolProgress, renderStatusBar, renderError } from '../src/ui/ink-app.mjs';
import { loadSettings, SETTINGS_SCHEMA } from '../src/config/settings.mjs';
import { readEnv, getEnv, listEnvVars, ENV_SCHEMA } from '../src/config/env.mjs';
import { parseArgs } from '../src/config/cli-args.mjs';
import * as telemetry from '../src/telemetry/index.mjs';
import { cronStore } from '../src/tools/cron-create.mjs';
import { SseTransport } from '../src/mcp/transport-sse.mjs';
import { StreamableHttpTransport } from '../src/mcp/transport-shttp.mjs';
import { WebSocketTransport } from '../src/mcp/transport-ws.mjs';
import fs from 'fs';
import path from 'path';
import os from 'os';

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

function assertIncludes(str, sub, message) {
    assert(typeof str === 'string' && str.includes(sub), `${message} — "${sub}" not found in output`);
}

function assertType(value, type, message) {
    assert(typeof value === type, `${message} — expected ${type}, got ${typeof value}`);
}

function section(name) {
    console.log(`\n--- ${name} ---`);
}

// ---------- Tool Registry Tests ----------

section('Tool Registry (25+ tools)');

const registry = createToolRegistry();

const toolList = registry.list();
assert(toolList.length >= 25, `Should have at least 25 tools, got ${toolList.length}`);

const expectedTools = [
    'Bash', 'Read', 'Edit', 'Write', 'Glob', 'Grep', 'Agent',
    'WebFetch', 'WebSearch', 'TodoWrite', 'NotebookEdit', 'MultiEdit',
    'LS', 'ToolSearch', 'AskUser', 'EnterWorktree', 'ExitWorktree',
    'Skill', 'SendMessage', 'RemoteTrigger', 'CronCreate', 'CronDelete',
    'CronList', 'LSP', 'ReadMcpResource',
];
const toolNames = toolList.map(t => t.name);
for (const name of expectedTools) {
    assert(toolNames.includes(name), `Should include ${name} tool`);
}

for (const tool of toolList) {
    assert(typeof tool.name === 'string' && tool.name.length > 0, `Tool ${tool.name} has a name`);
    assert(typeof tool.description === 'string' && tool.description.length > 0, `Tool ${tool.name} has description`);
    assert(tool.input_schema && typeof tool.input_schema === 'object', `Tool ${tool.name} has input_schema`);
}

// Unknown tool
try {
    await registry.call('NonExistentTool', {});
    assert(false, 'Should throw for unknown tool');
} catch (e) {
    assertIncludes(e.message, 'Unknown tool', 'Unknown tool error message');
}

// Validation errors
const editResult = await registry.call('Edit', { file_path: '', old_string: '', new_string: '' });
assertIncludes(editResult, 'Validation error', 'Edit validation returns error');

// Register custom tool
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

// MCP tool registration
registry.registerMcpTools(
    [{ name: 'mcp__test__tool', description: 'MCP test', inputSchema: { type: 'object', properties: {} } }],
    async () => 'mcp result'
);
assert(registry.has('mcp__test__tool'), 'MCP tool registered');
const mcpResult = await registry.call('mcp__test__tool', {});
assertEqual(mcpResult, 'mcp result', 'MCP tool returns result');

// ---------- Tool Execution Tests ----------

section('Tool Execution');

const lsResult = await registry.call('LS', { path: '/tmp' });
assertType(lsResult, 'string', 'LS returns string');
assertIncludes(lsResult, '/tmp', 'LS includes path');

// Read tool
const readResult = await registry.call('Read', { file_path: import.meta.url.replace('file://', '') });
assertType(readResult, 'string', 'Read returns string');
assertIncludes(readResult, 'Tool Registry', 'Read returns file content');

// TodoWrite
const todoResult = await registry.call('TodoWrite', {
    todos: [
        { content: 'Task 1', status: 'pending', priority: 'high' },
        { content: 'Task 2', status: 'completed', priority: 'low' },
    ],
});
assertIncludes(todoResult, '2 todos', 'TodoWrite reports 2 todos');

// WebSearch without API key
const searchResult = await registry.call('WebSearch', { query: 'test' });
assertType(searchResult, 'string', 'WebSearch returns string');

// ToolSearch
const tsResult = await registry.call('ToolSearch', { query: 'bash' });
assertType(tsResult, 'string', 'ToolSearch returns string');

// WebFetch validation
const fetchValidation = await registry.call('WebFetch', { url: 'not-a-url' });
assertIncludes(fetchValidation, 'Validation error', 'WebFetch validates URL');

// AskUser validation
const askValidation = await registry.call('AskUser', { question: '' });
assertIncludes(askValidation, 'Validation error', 'AskUser validates question');

// AskUser non-interactive returns default
const askResult = await registry.call('AskUser', { question: 'test?', default_value: 'default-answer' });
// In non-TTY env, should return default
assertType(askResult, 'string', 'AskUser returns string');

// SendMessage
const sendResult = await registry.call('SendMessage', { to: 'agent-2', content: 'hello' });
assertIncludes(sendResult, 'Message sent', 'SendMessage sends message');

// RemoteTrigger without endpoint
const triggerResult = await registry.call('RemoteTrigger', { task: 'test task' });
assertIncludes(triggerResult, 'No remote endpoint', 'RemoteTrigger reports no endpoint');

// CronCreate
const cronResult = await registry.call('CronCreate', { name: 'test-job', schedule: '5m', command: 'echo test' });
assertIncludes(cronResult, 'Created scheduled task', 'CronCreate creates job');

// CronList
const cronListResult = await registry.call('CronList', {});
assertIncludes(cronListResult, 'test-job', 'CronList shows job');

// CronDelete
const cronDeleteResult = await registry.call('CronDelete', { name: 'test-job' });
assertIncludes(cronDeleteResult, 'Deleted', 'CronDelete removes job');

// CronList after delete
const cronListEmpty = await registry.call('CronList', {});
assertIncludes(cronListEmpty, 'No scheduled tasks', 'CronList empty after delete');

// Skill tool without loader
const skillResult = await registry.call('Skill', { skill: 'test' });
assertIncludes(skillResult, 'not initialized', 'Skill reports no loader');

// LSP tool
const lspResult = await registry.call('LSP', { action: 'diagnostics', file: '/tmp/nonexistent.ts' });
assertType(lspResult, 'string', 'LSP returns string');

// ReadMcpResource without clients
const mcpResResult = await registry.call('ReadMcpResource', { uri: 'test://resource' });
assertIncludes(mcpResResult, 'No MCP servers', 'ReadMcpResource reports no servers');

// EnterWorktree validation (not in git repo at /tmp)
const wtResult = await registry.call('ExitWorktree', {});
assertIncludes(wtResult, 'Not currently', 'ExitWorktree when not in worktree');

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

const autoPerms = createPermissionChecker({ defaultMode: 'auto' });
assert(await autoPerms.check('Bash', {}), 'Auto mode allows');

const editPerms = createPermissionChecker({ defaultMode: 'acceptEdits' });
assert(await editPerms.check('Write', {}), 'AcceptEdits allows Write');

const defaultPerms = createPermissionChecker({});
assert(await defaultPerms.check('Read', {}), 'Default mode allows Read');

// ---------- Context Manager Tests ----------

section('Context Manager');

const ctx = new ContextManager(1000);

const messages = [
    { role: 'user', content: 'Hello, how are you?' },
    { role: 'assistant', content: 'I am doing well!' },
];
const tokens = ctx.getTokenCount(messages);
assert(tokens > 0, `Token count positive, got ${tokens}`);

assert(!ctx.shouldCompact(messages), 'Small messages no compaction');

const largeMessages = [];
for (let i = 0; i < 50; i++) {
    largeMessages.push({ role: 'user', content: 'x'.repeat(200) });
    largeMessages.push({ role: 'assistant', content: 'y'.repeat(200) });
}
assert(ctx.shouldCompact(largeMessages), 'Large messages trigger compaction');

const compacted = ctx.compact(largeMessages, 4);
assert(compacted.length <= 5, `Compacted has <= 5 messages, got ${compacted.length}`);
assertIncludes(compacted[0].content, '[Context compacted', 'Compacted has summary');
assertEqual(ctx.compactionCount, 1, 'Compaction count incremented');

const ctx2 = new ContextManager(100);
let msgs = [];
for (let i = 0; i < 30; i++) {
    msgs = ctx2.addMessage(msgs, { role: 'user', content: 'test '.repeat(20) });
}
assert(msgs.length < 30, 'Auto-compaction reduced message count');

const arrayMsg = [{ role: 'user', content: [{ type: 'text', text: 'hello' }, { type: 'tool_result', content: 'result' }] }];
const arrayTokens = ctx.getTokenCount(arrayMsg);
assert(arrayTokens > 0, 'Array content token count positive');

// ---------- Hook Engine Tests ----------

section('Hook Engine');

const emptyHooks = new HookEngine({});
const preResult = await emptyHooks.runPreToolUse('Bash', { command: 'ls' });
assert(preResult.allow === true, 'Empty hooks allow pre-tool');
const stopResult = await emptyHooks.runStop();
assert(stopResult === true, 'Empty hooks allow stop');

const blockingHooks = new HookEngine({
    PreToolUse: [{
        name: 'block-rm',
        toolName: 'Bash',
        handler: async (ctx) => {
            if (ctx.input?.command?.includes('rm -rf')) return { decision: 'deny', message: 'Dangerous' };
            return { decision: 'allow' };
        },
    }],
});

const safeResult = await blockingHooks.runPreToolUse('Bash', { command: 'ls -la' });
assert(safeResult.allow === true, 'Safe command allowed');

const dangerousResult = await blockingHooks.runPreToolUse('Bash', { command: 'rm -rf /' });
assert(dangerousResult.allow === false, 'Dangerous command blocked');
assertIncludes(dangerousResult.message, 'Dangerous', 'Block message present');

const readResult2 = await blockingHooks.runPreToolUse('Read', { file_path: '/etc/passwd' });
assert(readResult2.allow === true, 'Hook only applies to Bash');

const modifyHooks = new HookEngine({
    PostToolUse: [{ handler: async (ctx) => ({ modifiedResult: ctx.result + ' [mod]' }) }],
});
const postResult = await modifyHooks.runPostToolUse('Bash', 'output');
assertEqual(postResult, 'output [mod]', 'Post-hook modifies result');

const preventStopHooks = new HookEngine({
    Stop: [{ handler: async () => ({ preventStop: true }) }],
});
assert((await preventStopHooks.runStop()) === false, 'Stop hook prevents stopping');

// Notification hooks (fire and forget)
const notifyHooks = new HookEngine({
    Notification: [{ handler: async () => ({ logged: true }) }],
});
await notifyHooks.runNotification('test', { data: 'hello' });
passed++; // No error means pass

// ---------- Streaming Tests ----------

section('Streaming');

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
assertEqual(accumulated.id, 'msg_1', 'Accumulated message ID');
assertEqual(accumulated.content.length, 1, 'One content block');
assertEqual(accumulated.content[0].type, 'text', 'Content is text');
assertEqual(accumulated.content[0].text, 'Hello world', 'Text accumulated');
assertEqual(accumulated.stop_reason, 'end_turn', 'Stop reason captured');
assertEqual(accumulated.usage.input_tokens, 10, 'Input tokens');
assertEqual(accumulated.usage.output_tokens, 5, 'Output tokens');

async function* mockToolEvents() {
    yield { type: 'message_start', message: { id: 'msg_2', model: 'test', usage: { input_tokens: 20 } } };
    yield { type: 'content_block_start', index: 0, content_block: { type: 'text' } };
    yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Check.' } };
    yield { type: 'content_block_stop', index: 0 };
    yield { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu_1', name: 'Bash' } };
    yield { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"com' } };
    yield { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: 'mand":"ls"}' } };
    yield { type: 'content_block_stop', index: 1 };
    yield { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 15 } };
}

const toolAccumulated = await accumulateStream(mockToolEvents());
assertEqual(toolAccumulated.content.length, 2, 'Two content blocks');
assertEqual(toolAccumulated.content[0].text, 'Check.', 'Text block correct');
assertEqual(toolAccumulated.content[1].type, 'tool_use', 'Second is tool_use');
assertEqual(toolAccumulated.content[1].name, 'Bash', 'Tool name is Bash');
assertEqual(toolAccumulated.content[1].input.command, 'ls', 'Tool input parsed');
assertEqual(toolAccumulated.stop_reason, 'tool_use', 'Stop reason tool_use');

async function* mockThinkingEvents() {
    yield { type: 'message_start', message: { id: 'msg_3', model: 'test', usage: { input_tokens: 5 } } };
    yield { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } };
    yield { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'Let me think...' } };
    yield { type: 'content_block_stop', index: 0 };
    yield { type: 'content_block_start', index: 1, content_block: { type: 'text' } };
    yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Answer.' } };
    yield { type: 'content_block_stop', index: 1 };
    yield { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 10 } };
}

const thinkingAccumulated = await accumulateStream(mockThinkingEvents());
assertEqual(thinkingAccumulated.content.length, 2, 'Two blocks (thinking + text)');
assertEqual(thinkingAccumulated.content[0].type, 'thinking', 'First is thinking');
assertEqual(thinkingAccumulated.content[0].thinking, 'Let me think...', 'Thinking text');
assertEqual(thinkingAccumulated.content[1].text, 'Answer.', 'Text after thinking');

// ---------- Agent Loop Tests (mock) ----------

section('Agent Loop (mock)');

const mockTools = {
    list() { return [{ name: 'TestTool', description: 'Test', input_schema: { type: 'object', properties: {} } }]; },
    async call() { return 'mock result'; },
};

const loop = createAgentLoop({
    model: 'test-model',
    tools: mockTools,
    permissions: { async check() { return true; } },
    settings: {},
});

assert(loop.run !== undefined, 'Agent loop has run method');
assert(loop.state !== undefined, 'Agent loop has state');
assertEqual(loop.state.turnCount, 0, 'Initial turn count 0');
assert(Array.isArray(loop.state.messages), 'State has messages');
assertType(loop.state.systemPrompt, 'string', 'State has system prompt');

// ---------- MCP Client Tests ----------

section('MCP Client');

const client = new McpClient({ command: 'echo', args: ['test'] });
assertEqual(client.config.command, 'echo', 'MCP client stores command');
assertEqual(client.requestId, 0, 'MCP client starts with requestId 0');
assert(client.tools.length === 0, 'MCP client empty tools');
assertEqual(client._detectTransport(), 'stdio', 'Detect stdio transport');

const wsClient = new McpClient({ url: 'ws://localhost:3000' });
assertEqual(wsClient._detectTransport(), 'websocket', 'Detect websocket');

const sseClient = new McpClient({ url: 'http://localhost:3000/sse' });
assertEqual(sseClient._detectTransport(), 'sse', 'Detect SSE');

const httpClient = new McpClient({ url: 'http://localhost:3000/mcp' });
assertEqual(httpClient._detectTransport(), 'streamable-http', 'Detect streamable-http');

const explicitClient = new McpClient({ command: 'node', transport: 'websocket' });
assertEqual(explicitClient._detectTransport(), 'websocket', 'Explicit transport override');

// ---------- MCP Transport Tests (structural) ----------

section('MCP Transports (structural)');

const sseTransport = new SseTransport('http://example.com/sse');
assertEqual(sseTransport.url, 'http://example.com/sse', 'SSE transport URL');
assertEqual(sseTransport.connected, false, 'SSE not connected');

const shttpTransport = new StreamableHttpTransport('http://example.com/mcp');
assertEqual(shttpTransport.url, 'http://example.com/mcp', 'sHTTP transport URL');
assertEqual(shttpTransport.connected, false, 'sHTTP not connected');

const wsTransport = new WebSocketTransport('ws://example.com');
assertEqual(wsTransport.url, 'ws://example.com', 'WS transport URL');
assertEqual(wsTransport.connected, false, 'WS not connected');

// ---------- Session Manager Tests ----------

section('Session Manager');

const sessionMgr = new SessionManager('/tmp/occ-test-project');
assertIncludes(sessionMgr.sessionId, 'sess_', 'Session ID format');
assert(sessionMgr.startedAt !== null, 'Started at set');

const sessionDir = sessionMgr.getSessionDir();
assertType(sessionDir, 'string', 'Session dir is string');
assertIncludes(sessionDir, '.claude/projects', 'Session dir includes .claude/projects');

const info = sessionMgr.info();
assertEqual(info.projectDir, '/tmp/occ-test-project', 'Info has project dir');
assertIncludes(info.id, 'sess_', 'Info has session ID');

// Save and resume
const testState = {
    model: 'test-model',
    turnCount: 5,
    tokenUsage: { input: 100, output: 50 },
    messages: [{ role: 'user', content: 'hello' }],
    systemPrompt: 'test prompt',
};
const savedPath = sessionMgr.save(testState);
assertType(savedPath, 'string', 'Save returns path');

const resumeState = { messages: [], turnCount: 0, tokenUsage: { input: 0, output: 0 } };
const resumed = sessionMgr.resume(resumeState);
assert(resumed === true, 'Resume succeeds');
assertEqual(resumeState.turnCount, 5, 'Resumed turn count');
assertEqual(resumeState.messages.length, 1, 'Resumed messages');

// Teleport
const teleportData = sessionMgr.exportForTeleport(testState);
assertType(teleportData, 'string', 'Export returns base64');
const importState = { messages: [], turnCount: 0 };
sessionMgr.importFromTeleport(teleportData, importState);
assertEqual(importState.turnCount, 5, 'Import restored turns');

// Clear
assert(sessionMgr.clear() === true, 'Clear succeeds');
const resumeAfterClear = { messages: [], turnCount: 0, tokenUsage: { input: 0, output: 0 } };
assert(sessionMgr.resume(resumeAfterClear) === false, 'Resume fails after clear');

// ---------- Checkpoint Manager Tests ----------

section('Checkpoint Manager');

const tmpDir = path.join(os.tmpdir(), `occ-ckpt-test-${Date.now()}`);
fs.mkdirSync(tmpDir, { recursive: true });
const ckptMgr = new CheckpointManager(tmpDir);

// Create test file
const testFile = path.join(tmpDir, 'test-checkpoint.txt');
fs.writeFileSync(testFile, 'original content');

// Save checkpoint
const ckptId = ckptMgr.save(testFile);
assertType(ckptId, 'string', 'Checkpoint ID is string');
assertIncludes(ckptId, 'ckpt_', 'Checkpoint ID format');

// Modify file
fs.writeFileSync(testFile, 'modified content');
assertEqual(fs.readFileSync(testFile, 'utf-8'), 'modified content', 'File modified');

// Undo
const undoResult = ckptMgr.undo();
assert(undoResult !== null, 'Undo returns result');
assert(undoResult.restored, 'Undo restored');
assertEqual(fs.readFileSync(testFile, 'utf-8'), 'original content', 'Content restored');

// List checkpoints
ckptMgr.save(testFile);
const ckptList = ckptMgr.list();
assert(ckptList.length >= 1, 'Checkpoint list has entries');

// Clear
ckptMgr.clear();
const listAfterClear = ckptMgr.list();
assertEqual(listAfterClear.length, 0, 'No checkpoints after clear');

// Undo with nothing
assert(ckptMgr.undo() === null, 'Undo null when empty');

// Cleanup
fs.rmSync(tmpDir, { recursive: true, force: true });

// ---------- Prompt Cache Tests ----------

section('Prompt Cache');

const cache = new PromptCache();

const cachedSystem = cache.applyCacheControl('You are a helper.');
assert(Array.isArray(cachedSystem), 'Cache control returns array');
assertEqual(cachedSystem[0].type, 'text', 'Block type is text');
assertIncludes(cachedSystem[0].text, 'helper', 'Block has content');
assertEqual(cachedSystem[0].cache_control.type, 'ephemeral', 'Cache control set');

cache.updateStats({ cache_creation_input_tokens: 100 });
cache.updateStats({ cache_read_input_tokens: 80 });
cache.updateStats({ cache_read_input_tokens: 90 });

const stats = cache.getStats();
assertEqual(stats.totalRequests, 3, 'Total requests');
assertEqual(stats.cacheHits, 2, 'Cache hits');
assertEqual(stats.cacheMisses, 1, 'Cache misses');
assertEqual(stats.cacheCreationTokens, 100, 'Creation tokens');
assertEqual(stats.cacheReadTokens, 170, 'Read tokens');
assertIncludes(stats.hitRate, '66', 'Hit rate ~66%');

cache.reset();
assertEqual(cache.getStats().totalRequests, 0, 'Reset clears stats');

// ---------- Agent Parser Tests ----------

section('Agent Parser');

const jsonAgent = parseAgentDefinition(JSON.stringify({
    name: 'test-agent',
    description: 'A test agent',
    model: 'claude-haiku-4-5',
    tools: ['Bash', 'Read'],
    prompt: 'You are a test agent.',
}), '.json');
assertEqual(jsonAgent.name, 'test-agent', 'JSON agent name');
assertEqual(jsonAgent.description, 'A test agent', 'JSON agent description');
assertEqual(jsonAgent.model, 'claude-haiku-4-5', 'JSON agent model');
assertEqual(jsonAgent.tools.length, 2, 'JSON agent tools');
assertIncludes(jsonAgent.prompt, 'test agent', 'JSON agent prompt');

const mdAgent = parseAgentDefinition(`---
name: md-agent
description: Markdown agent
model: claude-sonnet-4-6
tools: [Bash, Write]
---
You are a markdown-defined agent.`, '.md');
assertEqual(mdAgent.name, 'md-agent', 'MD agent name');
assertEqual(mdAgent.description, 'Markdown agent', 'MD agent description');
assertEqual(mdAgent.tools.length, 2, 'MD agent tools');
assertIncludes(mdAgent.prompt, 'markdown-defined', 'MD agent prompt');

// MD without frontmatter
const mdPlain = parseAgentDefinition('Just a plain prompt.', '.md');
assertEqual(mdPlain.name, 'unnamed', 'Plain MD unnamed');
assertIncludes(mdPlain.prompt, 'plain prompt', 'Plain MD prompt');

// ---------- Agent Loader Tests ----------

section('Agent Loader');

const agentLoader = new AgentLoader();
agentLoader.load('/tmp/nonexistent-dir');
assertEqual(agentLoader.list().length, 0, 'Empty loader has no agents');
assert(agentLoader.get('nonexistent') === null, 'Get unknown returns null');
assert(!agentLoader.has('nonexistent'), 'Has unknown returns false');

// ---------- Skills Loader Tests ----------

section('Skills Loader');

const skillsLoader = new SkillsLoader();
skillsLoader.load('/tmp/nonexistent-dir');
assertEqual(skillsLoader.list().length, 0, 'Empty skills loader');
assert(skillsLoader.get('nonexistent') === null, 'Get unknown skill null');

// Create temp skill directory
const skillDir = path.join(os.tmpdir(), `occ-skill-test-${Date.now()}`);
const commitSkillDir = path.join(skillDir, 'commit');
fs.mkdirSync(commitSkillDir, { recursive: true });
fs.writeFileSync(path.join(commitSkillDir, 'SKILL.md'), `---
name: commit
description: Create a git commit
---
Create a conventional commit message and commit the staged changes.`);

const skillsLoader2 = new SkillsLoader();
skillsLoader2.searchPaths = [skillDir];
skillsLoader2._loadFromDir(skillDir);
assertEqual(skillsLoader2.list().length, 1, 'Loaded one skill');
const commitSkill = skillsLoader2.get('commit');
assert(commitSkill !== null, 'Got commit skill');
assertEqual(commitSkill.name, 'commit', 'Skill name');
assertIncludes(commitSkill.description, 'git commit', 'Skill description');

// Run skill
const skillOutput = await skillsLoader2.run('commit');
assertIncludes(skillOutput, '[Skill: commit]', 'Skill output has header');

// Unknown skill
try {
    await skillsLoader2.run('unknown-skill');
    assert(false, 'Should throw for unknown skill');
} catch (e) {
    assertIncludes(e.message, 'Unknown skill', 'Unknown skill error');
}

// Cleanup
fs.rmSync(skillDir, { recursive: true, force: true });

// ---------- Slash Commands Tests ----------

section('Slash Commands (39)');

const commandCount = Object.keys(COMMANDS).length;
assert(commandCount >= 38, `Should have >= 38 commands, got ${commandCount}`);

const expectedCommands = [
    '/help', '/clear', '/compact', '/cost', '/doctor', '/fast', '/model',
    '/tokens', '/tools', '/quit', '/exit', '/bug', '/review', '/init',
    '/login', '/logout', '/status', '/config', '/memory', '/forget',
    '/effort', '/think', '/plan', '/vim', '/terminal-setup', '/mcp',
    '/permissions', '/hooks', '/agents', '/skills', '/schedule',
    '/extra-usage', '/undo', '/diff', '/listen', '/commit', '/pr', '/release',
];
for (const cmd of expectedCommands) {
    assert(COMMANDS[cmd] !== undefined, `Command ${cmd} exists`);
    assert(typeof COMMANDS[cmd].handler === 'function', `Command ${cmd} has handler`);
    assert(typeof COMMANDS[cmd].description === 'string', `Command ${cmd} has description`);
}

// Test command state
const cmdState = {
    messages: [{ role: 'user', content: 'hi' }],
    turnCount: 3,
    tokenUsage: { input: 500, output: 200 },
    model: 'test-model',
    tools: { list: () => [{ name: 'Bash', description: 'Execute bash' }] },
};

// /help
const helpResult = COMMANDS['/help'].handler('', cmdState);
assertIncludes(helpResult, '/help', 'Help lists commands');

// /tokens
const tokensResult = COMMANDS['/tokens'].handler('', cmdState);
assertIncludes(tokensResult, '500', 'Tokens shows input');

// /model
const modelResult = COMMANDS['/model'].handler('', cmdState);
assertIncludes(modelResult, 'test-model', 'Model shows current');

// /model switch
COMMANDS['/model'].handler('new-model', cmdState);
assertEqual(cmdState.model, 'new-model', 'Model switched');

// /clear
COMMANDS['/clear'].handler('', cmdState);
assertEqual(cmdState.messages.length, 0, 'Clear empties messages');

// /cost
cmdState.tokenUsage = { input: 1000, output: 500 };
const costResult = COMMANDS['/cost'].handler('', cmdState);
assertIncludes(costResult, 'Token usage', 'Cost shows tokens');

// /doctor
const doctorResult = COMMANDS['/doctor'].handler('', cmdState);
assertIncludes(doctorResult, 'Node.js', 'Doctor shows node version');

// /fast
const fastResult = COMMANDS['/fast'].handler('', cmdState);
assertIncludes(fastResult, 'haiku', 'Fast mode uses haiku');

// /status
const statusResult = COMMANDS['/status'].handler('', cmdState);
assertIncludes(statusResult, 'Session', 'Status shows session');

// /effort
const effortResult = COMMANDS['/effort'].handler('high', cmdState);
assertIncludes(effortResult, 'high', 'Effort set to high');

// /think
const thinkResult = COMMANDS['/think'].handler('', cmdState);
assertIncludes(thinkResult, 'ON', 'Thinking toggled on');

// /quit
const quitResult = COMMANDS['/quit'].handler('', cmdState);
assertEqual(quitResult, 'EXIT', 'Quit returns EXIT');

// /exit
const exitResult = COMMANDS['/exit'].handler('', cmdState);
assertEqual(exitResult, 'EXIT', 'Exit returns EXIT');

// /bug
const bugResult = COMMANDS['/bug'].handler('', cmdState);
assertIncludes(bugResult, 'github', 'Bug shows github');

// /memory
cmdState.messages = [{ role: 'user', content: 'test' }];
const memResult = COMMANDS['/memory'].handler('', cmdState);
assertIncludes(memResult, 'Memory', 'Memory shows info');

// /forget
cmdState.messages = [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }];
COMMANDS['/forget'].handler('1', cmdState);
assertEqual(cmdState.messages.length, 1, 'Forget removes 1 message');

// /terminal-setup
const termResult = COMMANDS['/terminal-setup'].handler('', cmdState);
assertIncludes(termResult, 'Terminal', 'Terminal setup info');

// /permissions
const permResult = COMMANDS['/permissions'].handler('', cmdState);
assertIncludes(permResult, 'Permission', 'Permissions shows mode');

// /pr
const prResult = COMMANDS['/pr'].handler('', cmdState);
assertIncludes(prResult, 'gh', 'PR mentions gh CLI');

// /release
const releaseResult = COMMANDS['/release'].handler('', cmdState);
assertIncludes(releaseResult, 'gh', 'Release mentions gh CLI');

// executeCommand
const execResult = executeCommand('/help', cmdState);
assert(!execResult.exit, 'Help does not exit');
assertIncludes(execResult.response, '/help', 'Execute returns help');

const exitExecResult = executeCommand('/quit', cmdState);
assert(exitExecResult.exit, 'Quit exits');

const unknownResult = executeCommand('/nonexistent', cmdState);
assertIncludes(unknownResult.response, 'Unknown command', 'Unknown command error');

// getCompletions
const completions = getCompletions('/he');
assert(completions.includes('/help'), 'Tab complete finds /help');

// ---------- UI Components Tests ----------

section('UI Components');

const spinner = new Spinner('Loading...');
assertEqual(spinner.message, 'Loading...', 'Spinner message');
spinner.update('Updated');
assertEqual(spinner.message, 'Updated', 'Spinner message updated');
// Start/stop should not throw
spinner.start();
spinner.stop();

const highlighted = highlightCode('```js\nconst x = 42;\n```');
assertType(highlighted, 'string', 'Highlight returns string');

const toolProgress = renderToolProgress('Bash', 'running');
assertIncludes(toolProgress, 'Bash', 'Tool progress has name');

const statusBar = renderStatusBar({ model: 'test', tokenUsage: { input: 10, output: 5 }, turnCount: 1 });
assertType(statusBar, 'string', 'Status bar is string');

const errorMsg = renderError('test error');
assertIncludes(errorMsg, 'test error', 'Error message content');

// ---------- Settings Tests ----------

section('Settings');

assert(SETTINGS_SCHEMA.model === 'claude-sonnet-4-6', 'Default model in schema');
assert(SETTINGS_SCHEMA.maxContextTokens === 180000, 'Default max context');
assert(SETTINGS_SCHEMA.stream === true, 'Default streaming on');
assert(typeof SETTINGS_SCHEMA.permissions === 'object', 'Permissions in schema');
assert(typeof SETTINGS_SCHEMA.hooks === 'object', 'Hooks in schema');
assert(SETTINGS_SCHEMA.fileCheckpointingEnabled === true, 'Checkpointing default true');

const settings = await loadSettings();
assertType(settings, 'object', 'Settings loaded');
assert(settings.model !== undefined, 'Settings has model');
assert(settings.permissions !== undefined, 'Settings has permissions');

// ---------- Environment Variables Tests ----------

section('Environment Variables');

assert(Object.keys(ENV_SCHEMA).length >= 35, `Should have >= 35 env vars, got ${Object.keys(ENV_SCHEMA).length}`);

const env = readEnv();
assertType(env, 'object', 'readEnv returns object');

const envList = listEnvVars();
assert(envList.length >= 35, `Listed >= 35 env vars`);
assert(envList[0].key !== undefined, 'Env var has key');
assert(envList[0].description !== undefined, 'Env var has description');

// getEnv with default
const defaultVal = getEnv('NONEXISTENT_VAR', 'fallback');
assertEqual(defaultVal, 'fallback', 'getEnv returns fallback');

// ---------- CLI Args Tests ----------

section('CLI Args');

const args1 = parseArgs(['-p', 'hello']);
assertEqual(args1.prompt, 'hello', 'Parse -p prompt');

const args2 = parseArgs(['--model', 'claude-haiku-4-5']);
assertEqual(args2.model, 'claude-haiku-4-5', 'Parse --model');

const args3 = parseArgs(['-m', 'gpt-4', '-p', 'test']);
assertEqual(args3.model, 'gpt-4', 'Parse -m');
assertEqual(args3.prompt, 'test', 'Parse prompt with model');

const args4 = parseArgs(['just a prompt']);
assertEqual(args4.prompt, 'just a prompt', 'Bare prompt');

// ---------- Telemetry Tests ----------

section('Telemetry');

telemetry.clear();
telemetry.track('test.event', { key: 'value' });
assertEqual(telemetry.getEvents().length, 1, 'One event tracked');
assertEqual(telemetry.getEvents()[0].event, 'test.event', 'Event name');

telemetry.trackTiming('test.timing', 100, { op: 'read' });
assertEqual(telemetry.getEvents().length, 2, 'Timing event tracked');

telemetry.trackError('test.error', new Error('test'));
assertEqual(telemetry.getEvents().length, 3, 'Error event tracked');

const tStats = telemetry.getStats();
assertEqual(tStats.totalEvents, 3, 'Stats total');
assert(tStats.eventCounts['test.event'] === 1, 'Event count');

telemetry.setEnabled(false);
telemetry.track('disabled.event');
// still adds since enabled check is at a different level
telemetry.setEnabled(true);

telemetry.clear();
assertEqual(telemetry.getEvents().length, 0, 'Clear removes events');

// ---------- Cron Store Tests ----------

section('Cron Store');

// Clean up any leftover from earlier tests
for (const [id, job] of cronStore) {
    if (job.timer) clearInterval(job.timer);
}
cronStore.clear();

assertEqual(cronStore.size, 0, 'Cron store starts empty after clear');

// ---------- Integration: Commands + State ----------

section('Integration Tests');

// Command state round-trip
const intState = {
    messages: [],
    turnCount: 0,
    tokenUsage: { input: 0, output: 0 },
    model: 'claude-sonnet-4-6',
    tools: registry,
};

// /tools command with real registry
const toolsCmd = executeCommand('/tools', intState);
assertIncludes(toolsCmd.response, 'Bash', 'Tools command shows Bash');
assertIncludes(toolsCmd.response, 'AskUser', 'Tools command shows AskUser');

// /config
const configCmd = executeCommand('/config', intState);
assertIncludes(configCmd.response, 'Configuration', 'Config command shows config');

// /doctor
const docCmd = executeCommand('/doctor', intState);
assertIncludes(docCmd.response, 'Node.js', 'Doctor via executeCommand');

// Skill runner (structural)
const runner = new SkillRunner(skillsLoader, loop);
const available = runner.listAvailable();
assert(Array.isArray(available), 'Skill runner lists available');

// ---------- Summary ----------

console.log('\n========================================');
console.log(`Tests: ${passed + failed} total, ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
    console.log('\nFailures:');
    failures.forEach(f => console.log(`  - ${f}`));
}
console.log('========================================');

process.exit(failed > 0 ? 1 : 0);
