/**
 * Write Tool — based on decompiled Claude Code tool interface.
 */
import { execSync } from 'child_process';
import fs from 'fs';
import { globSync } from 'fs';
import path from 'path';

export const WriteTool = {
    name: 'Write',
    description: 'Write content to a file.',
    inputSchema: {
        type: 'object',
        properties: {
            file_path: { type: 'string' },
            content: { type: 'string' },
        },
        required: ['file_path', 'content'],
    },
    validateInput(input) {
        const errors = [];
        if (!input.file_path) errors.push('file_path required');
        return errors;
    },
    async call(input) {
        const filePath = path.resolve(input.file_path);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, input.content);
        return `File written: ${filePath}`;
    },
};
