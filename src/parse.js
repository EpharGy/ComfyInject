import { generateImage } from "./comfy.js";
import { resolveSeed, saveLastSeed } from "./state.js";

// Valid values for AR and SHOT tokens
const VALID_AR   = new Set(["PORTRAIT", "SQUARE", "LANDSCAPE", "CINEMA"]);
const VALID_SHOT = new Set(["CLOSE", "MEDIUM", "WIDE", "DUTCH", "OVERHEAD", "LOWANGLE", "HIGHANGLE", "PROFILE", "BACKVIEW", "POV"]);

// Fallback defaults if the bot gives us something invalid
const DEFAULT_AR   = "PORTRAIT";
const DEFAULT_SHOT = "WIDE";

// Regex to match [[IMG: ... ]] — captures everything inside (non-global, for single match)
export const MARKER_REGEX = /\[\[IMG:\s*(.+?)\s*\]\]/s;

// Global version for finding all markers in a message
const MARKER_REGEX_GLOBAL = /\[\[IMG:\s*(.+?)\s*\]\]/gs;

/**
 * Checks whether a message string contains an [[IMG: ... ]] marker.
 * @param {string} text - Raw message text
 * @returns {boolean}
 */
export function hasImageMarker(text) {
    return MARKER_REGEX.test(text);
}

/**
 * Parses the inner content of a single [[IMG: ... ]] marker into its components.
 * Does NOT trigger generation — just validates and resolves values.
 * @param {string} innerContent - The text between [[IMG: and ]]
 * @param {number} messageIndex - The message index (needed for LOCK seed resolution)
 * @returns {{ prompt: string, ar: string, shot: string, seed: number } | null}
 */
function parseMarkerContent(innerContent, messageIndex) {
    // Split the inner content by | into exactly 4 segments
    const segments = innerContent.split("|").map(s => s.trim());

    if (segments.length !== 4) {
        console.warn(`[ComfyInject] Marker has ${segments.length} segment(s), expected 4. Skipping.`);
        return null;
    }

    const [rawPrompt, rawAR, rawShot, rawSeed] = segments;

    // Validate prompt — if empty we really can't do anything useful
    if (!rawPrompt) {
        console.warn("[ComfyInject] Marker has an empty prompt. Skipping.");
        return null;
    }

    // Validate AR — fall back to default if invalid
    let ar = rawAR.toUpperCase();
    if (!VALID_AR.has(ar)) {
        console.warn(`[ComfyInject] Invalid AR "${rawAR}", falling back to ${DEFAULT_AR}`);
        ar = DEFAULT_AR;
    }

    // Validate SHOT — fall back to default if invalid
    let shot = rawShot.toUpperCase();
    if (!VALID_SHOT.has(shot)) {
        console.warn(`[ComfyInject] Invalid SHOT "${rawShot}", falling back to ${DEFAULT_SHOT}`);
        shot = DEFAULT_SHOT;
    }

    // Resolve seed — handles RANDOM, LOCK, and integer strings
    const seed = resolveSeed(rawSeed.toUpperCase(), messageIndex);

    return { prompt: rawPrompt, ar, shot, seed };
}

/**
 * Finds ALL [[IMG: ... ]] markers in a message, processes them sequentially,
 * and returns an array of results.
 *
 * @param {string} text - Raw message text potentially containing multiple markers
 * @param {number} messageIndex - The index of the message being processed
 * @returns {Promise<Array<{imageUrl: string, seed: number, prompt: string, ar: string, shot: string}>>}
 */
export async function processAllImageMarkers(text, messageIndex) {
    const matches = [...text.matchAll(MARKER_REGEX_GLOBAL)];

    if (matches.length === 0) {
        console.warn("[ComfyInject] processAllImageMarkers called but no markers found");
        return [];
    }

    const results = [];

    for (const match of matches) {
        const parsed = parseMarkerContent(match[1], messageIndex);
        if (!parsed) continue;

        const { prompt, ar, shot, seed } = parsed;

        console.log(`[ComfyInject] Parsed marker ${results.length + 1}/${matches.length} — prompt: "${prompt}" | AR: ${ar} | SHOT: ${shot} | seed: ${seed}`);

        try {
            const result = await generateImage({
                prompt,
                ar,
                shot,
                seed,
                messageIndex,
            });

            // Save the seed that was actually used so LOCK works
            saveLastSeed(result.seed);

            results.push({ ...result, ar, shot });
        } catch (err) {
            console.error(`[ComfyInject] Image generation failed for marker ${results.length + 1}:`, err);
            // Push null so the index stays aligned with the marker positions
            results.push(null);
        }
    }

    return results;
}