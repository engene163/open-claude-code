/**
 * MCP Client — stdio transport for Model Context Protocol.
 *
 * Implements the MCP protocol over stdio:
 * - Spawns a child process
 * - Sends JSON-RPC requests
 * - Receives JSON-RPC responses
 * - Supports initialize, tools/list, tools/call, shutdown
 */

import { spawn } from 'child_process';

const MCP_PROTOCOL_VERSION = '2024-11-05';

export class McpClient {
    /**
     * @param {object} serverConfig - { command, args, env }
     */
    constructor(serverConfig) {
        this.config = serverConfig;
        this.process = null;
        this.requestId = 0;
        this.pending = new Map();
        this.buffer = '';
        this.tools = [];
        this.serverInfo = null;
    }

    /**
     * Connect to the MCP server: spawn process, send initialize.
     */
    async connect() {
        this.process = spawn(this.config.command, this.config.args || [], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, ...this.config.env },
        });

        this.process.stdout.on('data', (data) => this._onData(data));
        this.process.stderr.on('data', (data) => {
            // Log MCP server stderr for debugging
            if (process.env.MCP_DEBUG) {
                process.stderr.write(`[mcp:${this.config.command}] ${data}`);
            }
        });

        this.process.on('exit', (code) => {
            // Reject all pending requests
            for (const [, { reject }] of this.pending) {
                reject(new Error(`MCP server exited with code ${code}`));
            }
            this.pending.clear();
        });

        // Send initialize
        const initResult = await this._request('initialize', {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: 'open-claude-code', version: '2.0.0' },
        });

        this.serverInfo = initResult;

        // Send initialized notification
        this._notify('notifications/initialized', {});

        return this.serverInfo;
    }

    /**
     * List available tools from the server.
     * @returns {Promise<Array>} tool definitions
     */
    async listTools() {
        const result = await this._request('tools/list', {});
        this.tools = result.tools || [];
        return this.tools;
    }

    /**
     * Call a tool on the server.
     * @param {string} name - tool name
     * @param {object} args - tool arguments
     * @returns {Promise<*>} tool result
     */
    async callTool(name, args) {
        const result = await this._request('tools/call', { name, arguments: args });
        // Extract text content from MCP response
        if (result.content && Array.isArray(result.content)) {
            return result.content
                .filter(c => c.type === 'text')
                .map(c => c.text)
                .join('\n');
        }
        return result;
    }

    /**
     * Gracefully disconnect from the server.
     */
    async disconnect() {
        if (!this.process) return;

        try {
            await this._request('shutdown', {});
            this._notify('exit', {});
        } catch {
            // Best effort
        }

        // Give it a moment to clean up, then force kill
        await new Promise(resolve => {
            const timeout = setTimeout(() => {
                this.process?.kill('SIGKILL');
                resolve();
            }, 2000);

            this.process.on('exit', () => {
                clearTimeout(timeout);
                resolve();
            });

            this.process.kill('SIGTERM');
        });

        this.process = null;
    }

    /**
     * Send a JSON-RPC request and await the response.
     */
    _request(method, params) {
        return new Promise((resolve, reject) => {
            const id = ++this.requestId;
            this.pending.set(id, { resolve, reject });

            const msg = JSON.stringify({
                jsonrpc: '2.0',
                id,
                method,
                params,
            });

            this.process.stdin.write(msg + '\n');
        });
    }

    /**
     * Send a JSON-RPC notification (no response expected).
     */
    _notify(method, params) {
        const msg = JSON.stringify({
            jsonrpc: '2.0',
            method,
            params,
        });
        this.process?.stdin.write(msg + '\n');
    }

    /**
     * Handle incoming data from stdout. Parses newline-delimited JSON.
     */
    _onData(data) {
        this.buffer += data.toString();
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop(); // keep incomplete line

        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                const msg = JSON.parse(line);
                if (msg.id && this.pending.has(msg.id)) {
                    const { resolve, reject } = this.pending.get(msg.id);
                    this.pending.delete(msg.id);
                    if (msg.error) {
                        reject(new Error(`MCP error: ${msg.error.message || JSON.stringify(msg.error)}`));
                    } else {
                        resolve(msg.result);
                    }
                }
                // Ignore notifications from server for now
            } catch {
                // Malformed JSON, skip
            }
        }
    }
}
