/**
 * Read Tool — based on decompiled Claude Code tool interface.
 */
import { execSync } from 'child_process';
import fs from 'fs';
import { globSync } from 'fs';
import path from 'path';

export const ReadTool = {
    name: 'Read',
    description: 'Read a file from the local filesystem.',
    inputSchema: {
        type: 'object',
        properties: {
            file_path: { type: 'string', description: 'Absolute path to the file' },
            offset: { type: 'number', description: 'Line offset to start reading' },
            limit: { type: 'number', description: 'Number of lines to read' },
        },
        required: ['file_path'],
    },
    validateInput(input) {
        const errors = [];
        if (!input.file_path) errors.push('file_path is required');
        return errors;
    },
    async call(input) {
        try {
            const content = fs.readFileSync(path.resolve(input.file_path), 'utf-8');
            const lines = content.split('\n');
            const start = input.offset || 0;
            const end = input.limit ? start + input.limit : lines.length;
            return lines.slice(start, end).map((l, i) => `${start + i + 1}\t${l}`).join('\n');
        } catch (e) {
            return `Error: ${e.message}`;
        }
    },
};
