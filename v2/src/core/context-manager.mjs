/**
 * Context Manager — tracks token usage and compacts conversation history.
 *
 * Based on Claude Code's compaction system:
 * - Monitors token count against a configurable limit
 * - Auto-compacts when usage exceeds 80% threshold
 * - Summarizes old messages to free context space
 */

const DEFAULT_MAX_TOKENS = 180000; // ~200k model limit with buffer
const COMPACT_THRESHOLD = 0.80;
const CHARS_PER_TOKEN = 4; // rough estimate

export class ContextManager {
    /**
     * @param {number} maxTokens - Maximum tokens for context window
     */
    constructor(maxTokens = DEFAULT_MAX_TOKENS) {
        this.maxTokens = maxTokens;
        this.threshold = COMPACT_THRESHOLD;
        this.compactionCount = 0;
    }

    /**
     * Estimate token count for a message array.
     * Uses character-based heuristic (no external tokenizer dependency).
     * @param {Array} messages - conversation messages
     * @returns {number} estimated token count
     */
    getTokenCount(messages) {
        let chars = 0;
        for (const msg of messages) {
            if (typeof msg.content === 'string') {
                chars += msg.content.length;
            } else if (Array.isArray(msg.content)) {
                for (const block of msg.content) {
                    if (block.type === 'text') chars += (block.text || '').length;
                    else if (block.type === 'tool_result') chars += (block.content || '').length;
                    else if (block.type === 'tool_use') chars += JSON.stringify(block.input || {}).length;
                    else if (block.type === 'thinking') chars += (block.thinking || '').length;
                    else chars += JSON.stringify(block).length;
                }
            }
        }
        return Math.ceil(chars / CHARS_PER_TOKEN);
    }

    /**
     * Check if compaction is needed.
     * @param {Array} messages - current conversation messages
     * @returns {boolean}
     */
    shouldCompact(messages) {
        const tokenCount = this.getTokenCount(messages);
        return tokenCount >= this.maxTokens * this.threshold;
    }

    /**
     * Compact messages by summarizing older history.
     * Keeps the most recent N messages intact and replaces older ones
     * with a summary message.
     *
     * @param {Array} messages - current conversation messages
     * @param {number} keepRecent - number of recent messages to preserve
     * @returns {Array} compacted message array
     */
    compact(messages, keepRecent = 6) {
        if (messages.length <= keepRecent) return messages;

        this.compactionCount++;
        const oldMessages = messages.slice(0, -keepRecent);
        const recentMessages = messages.slice(-keepRecent);

        // Build a summary of old messages
        const summaryParts = [];
        for (const msg of oldMessages) {
            const role = msg.role;
            let text = '';
            if (typeof msg.content === 'string') {
                text = msg.content.slice(0, 200);
            } else if (Array.isArray(msg.content)) {
                text = msg.content
                    .map(b => {
                        if (b.type === 'text') return b.text?.slice(0, 100);
                        if (b.type === 'tool_use') return `[tool:${b.name}]`;
                        if (b.type === 'tool_result') return `[result:${String(b.content).slice(0, 80)}]`;
                        return `[${b.type}]`;
                    })
                    .filter(Boolean)
                    .join(' ');
            }
            if (text) summaryParts.push(`${role}: ${text}`);
        }

        const summary = {
            role: 'user',
            content: `[Context compacted — summary of ${oldMessages.length} earlier messages]\n` +
                summaryParts.join('\n').slice(0, 2000),
        };

        return [summary, ...recentMessages];
    }

    /**
     * Add a message and auto-compact if needed.
     * @param {Array} messages - mutable message array
     * @param {object} msg - new message to add
     * @returns {Array} possibly compacted array with new message
     */
    addMessage(messages, msg) {
        messages.push(msg);
        if (this.shouldCompact(messages)) {
            return this.compact(messages);
        }
        return messages;
    }
}
