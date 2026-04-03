/**
 * Edit Tool — based on decompiled Claude Code tool interface.
 */
import { execSync } from 'child_process';
import fs from 'fs';
import { globSync } from 'fs';
import path from 'path';

export const EditTool = {
    name: 'Edit',
    description: 'Replace exact string in a file.',
    inputSchema: {
        type: 'object',
        properties: {
            file_path: { type: 'string' },
            old_string: { type: 'string' },
            new_string: { type: 'string' },
        },
        required: ['file_path', 'old_string', 'new_string'],
    },
    validateInput(input) {
        const errors = [];
        if (!input.file_path) errors.push('file_path required');
        if (!input.old_string) errors.push('old_string required');
        if (input.old_string === input.new_string) errors.push('old_string must differ from new_string');
        return errors;
    },
    async call(input) {
        const filePath = path.resolve(input.file_path);
        let content = fs.readFileSync(filePath, 'utf-8');
        if (!content.includes(input.old_string)) return 'Error: old_string not found in file';
        content = content.replace(input.old_string, input.new_string);
        fs.writeFileSync(filePath, content);
        return `File updated: ${filePath}`;
    },
};
