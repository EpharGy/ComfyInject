// Tracks the last successfully used seed so LOCK can reference it.
// If no seed has been used yet and LOCK is requested, we fall back to RANDOM.

import { MODULE_NAME } from "../settings.js";

let lastSeed = null;

/**
 * Normalizes image metadata for a message into an array.
 * Handles both old format (single object) and new format (array).
 * Key can be a send_date string (new) or a numeric index (old/legacy).
 * @param {object} metadata - The chatMetadata[MODULE_NAME] object
 * @param {string|number} key - The metadata key (send_date or legacy index)
 * @returns {Array<object>}
 */
export function getImageData(metadata, key) {
    const data = metadata?.[key];
    if (!data) return [];
    return Array.isArray(data) ? data : [data];
}

/**
 * Extracts the most recent seed from the currently saved <img> tags in a message.
 * This is used as a fallback for newer chats where seed is no longer stored in metadata.
 * Walks backward so the most recent image in the message wins.
 * @param {object} message - A SillyTavern chat message object
 * @returns {number|null} The parsed seed from the last saved image tag, or null if none found
 */
function getSeedFromMessageMes(message) {
    if (!message?.mes || typeof message.mes !== "string") return null;

    const imgTags = [...message.mes.matchAll(/<img class="comfyinject-image"[^>]*>/g)];
    if (imgTags.length === 0) return null;

    for (let i = imgTags.length - 1; i >= 0; i--) {
        const tag = imgTags[i][0];
        const seedMatch = tag.match(/data-seed="([^"]*)"/);
        const parsedSeed = parseInt(seedMatch?.[1], 10);
        if (Number.isFinite(parsedSeed)) {
            return parsedSeed;
        }
    }

    return null;
}

/**
 * Scans chatMetadata backwards from the message before currentIndex
 * to find the most recent saved seed. This ensures LOCK references
 * the last *saved message's* seed, not the last generation's seed
 * (which could be from a swipe that got discarded).
 * Uses send_date to look up metadata, with index fallback for legacy data.
 * @param {number} currentIndex - The array index of the message currently being processed
 * @returns {number|null} The seed from the most recent prior message, or null if none found
 */
function getLastSavedSeed(currentIndex) {
    const context = SillyTavern.getContext();
    const metadata = context.chatMetadata[MODULE_NAME];

    if (!metadata) return null;

    // Walk backwards through the chat array from the message before the current one
    for (let i = currentIndex - 1; i >= 0; i--) {
        const message = context.chat[i];
        if (!message) continue;

        // First try metadata seed lookup.
        // This remains authoritative for legacy chats because older <img> tags
        // may contain the LLM-written seed instead of the actual seed used.
        let images = getImageData(metadata, message.send_date);

        if (images.length === 0) {
            images = getImageData(metadata, i);
        }

        if (images.length > 0) {
            // Walk backward through the saved image metadata for this message
            // so null entries or malformed objects do not crash LOCK lookup.
            // Accept both numeric seeds and numeric strings for backward compatibility.
            for (let j = images.length - 1; j >= 0; j--) {
                const image = images[j];
                if (!image || typeof image !== "object") continue;

                const parsedSeed = parseInt(image.seed, 10);
                if (Number.isFinite(parsedSeed)) {
                    return parsedSeed;
                }
            }
        }

        // Fall back to the currently saved <img> tags in message.mes.
        // This supports newer chats where seed is no longer stored in metadata.
        const mesSeed = getSeedFromMessageMes(message);
        if (mesSeed !== null) {
            return mesSeed;
        }
    }

    return null;
}

/**
 * Resolves a seed token into a concrete integer.
 * - RANDOM: generates a new random seed
 * - LOCK: returns the seed from the most recent prior saved message,
 *         falls back to in-memory lastSeed, then to RANDOM
 * - integer: passes through as-is
 * @param {string|number} seed - The seed value from the parsed marker
 * @param {number} [currentIndex] - The array index of the message being processed (needed for LOCK)
 * @returns {number} A resolved numeric seed
 */
export function resolveSeed(seed, currentIndex) {
    if (seed === "RANDOM" || seed === undefined || seed === null) {
        return generateRandomSeed();
    }

    if (seed === "LOCK") {
        // Try the last saved seed from prior messages.
        // This prefers metadata for legacy chats, then falls back to saved <img> tags.
        if (currentIndex !== undefined) {
            const savedSeed = getLastSavedSeed(currentIndex);
            if (savedSeed !== null) return savedSeed;
        }

        // Fall back to in-memory seed (covers edge cases like first message in a new chat
        // where metadata hasn't been written yet but a generation already ran this session)
        if (lastSeed !== null) return lastSeed;

        console.log("[ComfyInject] LOCK requested but no previous seed exists, using RANDOM");
        return generateRandomSeed();
    }

    // Integer passed directly — parse it just in case it came in as a string
    const parsed = parseInt(seed, 10);
    if (isNaN(parsed)) {
        console.warn(`[ComfyInject] Unrecognized seed value "${seed}", falling back to RANDOM`);
        return generateRandomSeed();
    }

    return parsed;
}

/**
 * Saves the seed that was actually used for a generation.
 * Should be called after a successful generateImage() so LOCK works next time.
 * @param {number} seed - The seed that was used
 */
export function saveLastSeed(seed) {
    lastSeed = seed;
}

/**
 * Generates a random integer seed in the project-wide seed range.
 * @returns {number}
 */
function generateRandomSeed() {
    // Use the project-wide max safe integer seed range.
    return Math.floor(Math.random() * 9007199254740991);
}