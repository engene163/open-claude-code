/**
 * Settings chain — user/project/local/managed (from decompiled source).
 */
import fs from 'fs';
import path from 'path';
import os from 'os';

export async function loadSettings() {
    const chain = [
        path.join(os.homedir(), '.claude', 'settings.json'),      // user
        path.join(process.cwd(), '.claude', 'settings.json'),      // project
        path.join(process.cwd(), '.claude', 'settings.local.json'), // local
    ];

    let merged = { permissions: {}, hooks: {} };
    for (const file of chain) {
        try {
            const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
            merged = { ...merged, ...data };
        } catch {}
    }

    return merged;
}
