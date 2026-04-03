/**
 * Environment Variables — support for Claude Code env vars.
 *
 * Reads and normalizes the ~50 most important environment variables
 * that control Claude Code behavior.
 */

/**
 * All supported environment variables with defaults and descriptions.
 */
export const ENV_SCHEMA = {
    // API Configuration
    ANTHROPIC_API_KEY: { type: 'string', description: 'Anthropic API key' },
    ANTHROPIC_BASE_URL: { type: 'string', default: 'https://api.anthropic.com', description: 'Anthropic API base URL' },
    ANTHROPIC_MODEL: { type: 'string', description: 'Override default model' },
    OPENAI_API_KEY: { type: 'string', description: 'OpenAI API key for compatible models' },
    OPENAI_BASE_URL: { type: 'string', default: 'https://api.openai.com/v1', description: 'OpenAI-compatible base URL' },
    GOOGLE_API_KEY: { type: 'string', description: 'Google AI API key' },
    GEMINI_API_KEY: { type: 'string', description: 'Alias for GOOGLE_API_KEY' },

    // Model Configuration
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: { type: 'number', default: 16384, description: 'Max output tokens' },
    CLAUDE_CODE_SUBAGENT_MODEL: { type: 'string', description: 'Model for subagents' },
    CLAUDE_CODE_EFFORT_LEVEL: { type: 'string', default: 'normal', description: 'Effort level (low/normal/high)' },

    // Behavior Flags
    CLAUDE_CODE_BRIEF: { type: 'boolean', default: false, description: 'Brief output mode' },
    CLAUDE_CODE_DISABLE_CRON: { type: 'boolean', default: false, description: 'Disable cron tasks' },
    CLAUDE_CODE_ENABLE_TASKS: { type: 'boolean', default: false, description: 'Enable task system' },
    CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: { type: 'boolean', default: false, description: 'Enable agent teams' },
    CLAUDE_CODE_DEBUG: { type: 'boolean', default: false, description: 'Debug mode' },
    CLAUDE_CODE_DISABLE_TELEMETRY: { type: 'boolean', default: false, description: 'Disable telemetry' },

    // Permission and Security
    CLAUDE_CODE_PERMISSION_MODE: { type: 'string', default: 'default', description: 'Permission mode' },
    CLAUDE_CODE_SANDBOX: { type: 'boolean', default: true, description: 'Enable sandbox' },

    // Context and Memory
    CLAUDE_CODE_MAX_CONTEXT_TOKENS: { type: 'number', default: 180000, description: 'Max context window tokens' },
    CLAUDE_CODE_AUTO_COMPACT: { type: 'boolean', default: true, description: 'Auto-compact context' },

    // UI and Display
    SHOW_THINKING: { type: 'boolean', default: false, description: 'Show thinking blocks' },
    SHOW_TOOL_RESULTS: { type: 'boolean', default: false, description: 'Show tool results in REPL' },
    NO_COLOR: { type: 'boolean', default: false, description: 'Disable colored output' },
    TERM: { type: 'string', description: 'Terminal type' },

    // MCP
    MCP_DEBUG: { type: 'boolean', default: false, description: 'MCP debug logging' },

    // Remote
    REMOTE_AGENT_URL: { type: 'string', description: 'Remote agent endpoint' },
    REMOTE_AGENT_TOKEN: { type: 'string', description: 'Remote agent auth token' },

    // Search
    BRAVE_API_KEY: { type: 'string', description: 'Brave Search API key' },
    SEARXNG_URL: { type: 'string', description: 'SearXNG instance URL' },

    // Networking
    HTTP_PROXY: { type: 'string', description: 'HTTP proxy URL' },
    HTTPS_PROXY: { type: 'string', description: 'HTTPS proxy URL' },
    NO_PROXY: { type: 'string', description: 'No-proxy list' },

    // Agent Identity
    AGENT_ID: { type: 'string', default: 'main', description: 'Agent identifier for teams' },

    // Feature Flags
    CLAUDE_CODE_THINKING: { type: 'boolean', default: false, description: 'Enable extended thinking' },
    CLAUDE_CODE_THINKING_BUDGET: { type: 'number', default: 10000, description: 'Thinking token budget' },
    CLAUDE_CODE_STREAMING: { type: 'boolean', default: true, description: 'Enable streaming' },

    // Paths
    CLAUDE_CONFIG_DIR: { type: 'string', description: 'Custom config directory' },
    CLAUDE_CACHE_DIR: { type: 'string', description: 'Custom cache directory' },
};

/**
 * Read and normalize all environment variables.
 * @returns {object} normalized env config
 */
export function readEnv() {
    const env = {};

    for (const [key, schema] of Object.entries(ENV_SCHEMA)) {
        const raw = process.env[key];
        if (raw === undefined) {
            if (schema.default !== undefined) {
                env[key] = schema.default;
            }
            continue;
        }

        switch (schema.type) {
            case 'boolean':
                env[key] = raw === '1' || raw === 'true' || raw === 'yes';
                break;
            case 'number':
                env[key] = parseInt(raw, 10);
                if (isNaN(env[key])) env[key] = schema.default;
                break;
            default:
                env[key] = raw;
        }
    }

    return env;
}

/**
 * Get a specific env var with type coercion.
 * @param {string} key
 * @param {*} [defaultValue]
 */
export function getEnv(key, defaultValue) {
    const schema = ENV_SCHEMA[key];
    const raw = process.env[key];

    if (raw === undefined) return defaultValue ?? schema?.default;

    if (schema?.type === 'boolean') return raw === '1' || raw === 'true';
    if (schema?.type === 'number') {
        const n = parseInt(raw, 10);
        return isNaN(n) ? defaultValue : n;
    }
    return raw;
}

/**
 * List all supported env vars with their current values.
 */
export function listEnvVars() {
    const result = [];
    for (const [key, schema] of Object.entries(ENV_SCHEMA)) {
        const value = process.env[key];
        result.push({
            key,
            type: schema.type,
            value: value || undefined,
            default: schema.default,
            description: schema.description,
            isSet: value !== undefined,
        });
    }
    return result;
}
