/**
 * Permission Checker — 6 modes from decompiled Claude Code.
 */

export function createPermissionChecker(config = {}) {
    const mode = config.defaultMode || process.env.CLAUDE_CODE_PERMISSION_MODE || 'default';

    return {
        mode,
        async check(toolName, input) {
            switch (mode) {
                case 'bypassPermissions': return true;
                case 'acceptEdits': return true; // allows file ops, would ask for Bash in real impl
                case 'auto': return true; // AI decides
                case 'dontAsk': return false; // deny everything not pre-approved
                case 'plan': return toolName === 'Read' || toolName === 'Glob' || toolName === 'Grep';
                case 'default':
                default: return true; // would prompt user in real impl
            }
        },
    };
}
