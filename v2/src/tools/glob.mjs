/**
 * Glob Tool — based on decompiled Claude Code tool interface.
 */
import { execSync } from 'child_process';
import fs from 'fs';
import { globSync } from 'fs';
import path from 'path';

export const GlobTool = {
    name: 'Glob',
    description: 'Find files matching a glob pattern.',
    inputSchema: {
        type: 'object',
        properties: {
            pattern: { type: 'string' },
            path: { type: 'string' },
        },
        required: ['pattern'],
    },
    validateInput(input) { return input.pattern ? [] : ['pattern required']; },
    async call(input) {
        try {
            const { execSync } = await import('child_process');
            const dir = input.path || '.';
            const result = execSync(`find ${dir} -name "${input.pattern}" 2>/dev/null | head -50`, { encoding: 'utf-8' });
            return result || 'No matches found';
        } catch { return 'No matches found'; }
    },
};
