// Regex to find injected comfyinject <img> tags in message text
const IMG_TAG_REGEX = /<img class="comfyinject-image"[^>]*>/g;

// Regexes to extract data attributes from individual img tags
const PROMPT_REGEX = /data-prompt="([^"]*)"/;
const SEED_REGEX = /data-seed="([^"]*)"/;

/**
 * Prompt interceptor — called by SillyTavern before every generation.
 * Replaces <img> tags in outgoing messages with token-efficient
 * [[IMG: prompt | seed ]] tokens so the LLM can reference its previous
 * visual descriptions and seeds for continuity.
 *
 * Reads prompt and seed directly from the img tag's data attributes
 * rather than metadata, so it always matches the current message content.
 *
 * @param {object[]} chat - The mutable chat array passed by ST's interceptor system
 * @param {number} contextSize - Current context size in tokens
 * @param {Function} abort - Call this to cancel generation entirely
 * @param {string} type - The generation trigger type (e.g. 'normal', 'swipe', 'quiet')
 */
globalThis.comfyInjectInterceptor = async function(chat, contextSize, abort, type) {
    // Skip quiet generations (summaries, silent background calls etc)
    // so we don't accidentally interfere with other extensions
    if (type === "quiet") return;

    for (let i = 0; i < chat.length; i++) {
        const message = chat[i];

        // Only process bot messages that contain an img tag
        if (message.is_user) continue;
        if (!message.mes || !IMG_TAG_REGEX.test(message.mes)) continue;

        // Reset regex lastIndex since we're reusing it across iterations
        IMG_TAG_REGEX.lastIndex = 0;

        // Replace each img tag with a compact token parsed from its data attributes
        message.mes = message.mes.replace(IMG_TAG_REGEX, (tag) => {
            const prompt = tag.match(PROMPT_REGEX)?.[1]?.replace(/&quot;/g, '"') || "";
            const seed = tag.match(SEED_REGEX)?.[1] || "0";

            if (!prompt) return "[image]";

            return `[[IMG: ${prompt} | ${seed} ]]`;
        });
    }
};