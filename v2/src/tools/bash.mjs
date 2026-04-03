/**
 * Bash Tool — based on decompiled Claude Code tool interface.
 */
import { execSync } from 'child_process';
import fs from 'fs';
import { globSync } from 'fs';
import path from 'path';

export const BashTool = {
    name: 'Bash',
    description: 'Execute a bash command and return its output.',
    inputSchema: {
        type: 'object',
        properties: {
            command: { type: 'string', description: 'The command to execute' },
            timeout: { type: 'number', description: 'Timeout in ms', default: 120000 },
        },
        required: ['command'],
    },
    validateInput(input) {
        const errors = [];
        if (!input.command) errors.push('command is required');
        return errors;
    },
    async call(input) {
        try {
            const result = execSync(input.command, {
                timeout: input.timeout || 120000,
                encoding: 'utf-8',
                maxBuffer: 1024 * 1024,
            });
            return result;
        } catch (e) {
            return `Error: ${e.message}\n${e.stderr || ''}`;
        }
    },
};
