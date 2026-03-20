import { generateImage } from "./comfy.js";
import { resolveSeed, saveLastSeed } from "./state.js";

// Valid AR control tokens.
// These must match exactly and stay case-sensitive.
const VALID_AR = new Set(["PORTRAIT", "SQUARE", "LANDSCAPE", "CINEMA"]);

// Valid SHOT control tokens.
// These must match exactly and stay case-sensitive.
const VALID_SHOT = new Set([
    "CLOSE",
    "MEDIUM",
    "WIDE",
    "DUTCH",
    "OVERHEAD",
    "LOWANGLE",
    "HIGHANGLE",
    "PROFILE",
    "BACKVIEW",
    "POV",
]);

// Marker-level fallback values.
// These are only used when the marker does not provide a usable value.
// Final generation can still be overridden later by locks.
const DEFAULT_AR = "SQUARE";
const DEFAULT_SHOT = "MEDIUM";
const DEFAULT_SEED = "RANDOM";

// Regex to match a single [[IMG: ... ]] marker.
export const MARKER_REGEX = /\[\[IMG:\s*(.+?)\s*\]\]/s;

// Global regex to find all markers in a message.
const MARKER_REGEX_GLOBAL = /\[\[IMG:\s*(.+?)\s*\]\]/gs;

/**
 * Returns true if the message contains at least one image marker.
 * @param {string} text
 * @returns {boolean}
 */
export function hasImageMarker(text) {
    return MARKER_REGEX.test(text);
}

/**
 * Returns true if the value is an exact AR token.
 * @param {string} value
 * @returns {boolean}
 */
function isArToken(value) {
    return VALID_AR.has(value);
}

/**
 * Returns true if the value is an exact SHOT token.
 * @param {string} value
 * @returns {boolean}
 */
function isShotToken(value) {
    return VALID_SHOT.has(value);
}

/**
 * Returns true if the value is an exact SEED token.
 * Valid seed tokens are RANDOM, LOCK, or a digits-only integer string.
 * @param {string} value
 * @returns {boolean}
 */
function isSeedToken(value) {
    return value === "RANDOM" || value === "LOCK" || /^\d+$/.test(value);
}

/**
 * Classifies a token candidate as AR, SHOT, SEED, or null.
 * Matching is exact and case-sensitive.
 * @param {string} value
 * @returns {"AR" | "SHOT" | "SEED" | null}
 */
function classifyToken(value) {
    if (isArToken(value)) return "AR";
    if (isShotToken(value)) return "SHOT";
    if (isSeedToken(value)) return "SEED";
    return null;
}

/**
 * Returns a fresh repair metadata object for one marker parse.
 * This tracks what was defaulted, what duplicates were ignored,
 * and any prompt warnings.
 * @returns {{
 *   defaulted: string[],
 *   duplicateTokens: {
 *     AR: string[],
 *     SHOT: string[],
 *     SEED: string[]
 *   },
 *   possibleSeedInPrompt: boolean
 * }}
 */
function createRepairMeta() {
    return {
        defaulted: [],
        duplicateTokens: {
            AR: [],
            SHOT: [],
            SEED: [],
        },
        possibleSeedInPrompt: false,
    };
}

/**
 * Records a token into parser state.
 * First valid token wins for each field.
 * Later duplicates are ignored and tracked in repairMeta.
 * @param {{ ar: string | null, shot: string | null, seedToken: string | null }} state
 * @param {"AR" | "SHOT" | "SEED"} type
 * @param {string} value
 * @param {ReturnType<typeof createRepairMeta>} repairMeta
 */
function recordToken(state, type, value, repairMeta) {
    if (type === "AR") {
        if (state.ar === null) {
            state.ar = value;
        } else {
            repairMeta.duplicateTokens.AR.push(value);
        }
        return;
    }

    if (type === "SHOT") {
        if (state.shot === null) {
            state.shot = value;
        } else {
            repairMeta.duplicateTokens.SHOT.push(value);
        }
        return;
    }

    if (type === "SEED") {
        if (state.seedToken === null) {
            state.seedToken = value;
        } else {
            repairMeta.duplicateTokens.SEED.push(value);
        }
    }
}

/**
 * Optional warning only.
 * This does NOT parse numbers out of prompt text.
 * It only flags that the final prompt still contains a large standalone number.
 * @param {string} prompt
 * @returns {boolean}
 */
function hasPossibleSeedInPrompt(prompt) {
    return /\b\d{4,}\b/.test(prompt);
}

/**
 * Processes a single whitespace-separated word.
 * At the word level, only exact uppercase control tokens are consumed.
 * Numeric seeds are NOT consumed here, so numbers inside prompt-like text
 * remain part of the prompt instead of being parsed as SEED.
 * @param {string} word
 * @param {{ ar: string | null, shot: string | null, seedToken: string | null }} state
 * @param {ReturnType<typeof createRepairMeta>} repairMeta
 * @returns {string}
 */
function processWord(word, state, repairMeta) {
    let type = null;

    if (isArToken(word)) {
        type = "AR";
    } else if (isShotToken(word)) {
        type = "SHOT";
    } else if (word === "RANDOM" || word === "LOCK") {
        type = "SEED";
    }

    if (!type) {
        return word;
    }

    recordToken(state, type, word, repairMeta);
    return "";
}

/**
 * Processes one comma-separated part of a segment.
 *
 * Priority:
 * 1. If the whole part is an exact token, consume it.
 * 2. If the whole part is digits-only, consume it as a seed token.
 * 3. Otherwise split on whitespace and consume exact uppercase tokens word-by-word.
 * 4. Any leftover text remains prompt content.
 *
 * Leftover words inside the same comma part are rejoined with spaces.
 *
 * @param {string} part
 * @param {{ ar: string | null, shot: string | null, seedToken: string | null }} state
 * @param {ReturnType<typeof createRepairMeta>} repairMeta
 * @returns {string}
 */
function processCommaPart(part, state, repairMeta) {
    const trimmed = part.trim();
    if (!trimmed) return "";

    const wholeType = classifyToken(trimmed);
    if (wholeType) {
        recordToken(state, wholeType, trimmed, repairMeta);
        return "";
    }

    if (/^\d+$/.test(trimmed)) {
        recordToken(state, "SEED", trimmed, repairMeta);
        return "";
    }

    const words = trimmed.split(/\s+/).filter(Boolean);
    const leftoverWords = [];

    for (const word of words) {
        const leftover = processWord(word, state, repairMeta);
        if (leftover) {
            leftoverWords.push(leftover);
        }
    }

    return leftoverWords.join(" ");
}

/**
 * Processes one pipe-separated segment.
 *
 * Priority:
 * 1. If the whole segment is an exact token, consume it.
 * 2. If the whole segment is digits-only, consume it as a seed token.
 * 3. Otherwise split on commas and process each comma part.
 * 4. Any leftover text remains prompt content.
 *
 * Leftover comma parts inside the same segment are rejoined with commas.
 *
 * @param {string} segment
 * @param {{ ar: string | null, shot: string | null, seedToken: string | null }} state
 * @param {ReturnType<typeof createRepairMeta>} repairMeta
 * @returns {string}
 */
function processSegment(segment, state, repairMeta) {
    const trimmed = segment.trim();
    if (!trimmed) return "";

    const wholeType = classifyToken(trimmed);
    if (wholeType) {
        recordToken(state, wholeType, trimmed, repairMeta);
        return "";
    }

    if (/^\d+$/.test(trimmed)) {
        recordToken(state, "SEED", trimmed, repairMeta);
        return "";
    }

    const commaParts = trimmed.split(",");
    const leftoverParts = [];

    for (const part of commaParts) {
        const leftover = processCommaPart(part, state, repairMeta);
        if (leftover) {
            leftoverParts.push(leftover);
        }
    }

    return leftoverParts.join(", ");
}

/**
 * Parses one [[IMG: ... ]] marker.
 *
 * The marker format is a recommendation, not a hard rule.
 * The parser scans every pipe-separated segment and tries to salvage exact
 * uppercase control tokens from whole segments, comma parts, and words.
 *
 * Whatever is not consumed as AR / SHOT / SEED remains prompt text.
 * Prompt leftovers from different pipe segments are rejoined with commas.
 *
 * @param {string} innerContent
 * @param {number} messageIndex
 * @returns {{
 *   status: "ok",
 *   prompt: string,
 *   ar: string,
 *   shot: string,
 *   seed: number,
 *   repairMeta: {
 *     defaulted: string[],
 *     duplicateTokens: {
 *       AR: string[],
 *       SHOT: string[],
 *       SEED: string[]
 *     },
 *     possibleSeedInPrompt: boolean
 *   }
 * } | {
 *   status: "parse_error",
 *   reason: string,
 *   repairMeta: {
 *     defaulted: string[],
 *     duplicateTokens: {
 *       AR: string[],
 *       SHOT: string[],
 *       SEED: string[]
 *     },
 *     possibleSeedInPrompt: boolean
 *   }
 * }}
 */
function parseMarkerContent(innerContent, messageIndex) {
    const rawSegments = innerContent.split("|");
    const repairMeta = createRepairMeta();
    if (!innerContent.trim()) {
        return {
            status: "parse_error",
            reason: "empty_marker",
            repairMeta,
        };
    }

    const state = {
        ar: null,
        shot: null,
        seedToken: null,
    };

    const promptSegments = [];

    for (const rawSegment of rawSegments) {
        const leftover = processSegment(rawSegment, state, repairMeta);
        if (leftover) {
            promptSegments.push(leftover);
        }
    }

    // Leftover text from different pipe segments becomes one final prompt.
    // Pipes are marker syntax only, so they should not appear in the prompt sent to ComfyUI.
    const prompt = promptSegments.join(", ").trim();

    if (!prompt) {
        return {
            status: "parse_error",
            reason: "empty_prompt",
            repairMeta,
        };
    }

    if (hasPossibleSeedInPrompt(prompt)) {
        repairMeta.possibleSeedInPrompt = true;
    }

    let ar = state.ar;
    let shot = state.shot;
    let seedToken = state.seedToken;

    if (ar === null) {
        ar = DEFAULT_AR;
        repairMeta.defaulted.push("AR");
    }

    if (shot === null) {
        shot = DEFAULT_SHOT;
        repairMeta.defaulted.push("SHOT");
    }

    if (seedToken === null) {
        seedToken = DEFAULT_SEED;
        repairMeta.defaulted.push("SEED");
    }

    const seed = resolveSeed(seedToken, messageIndex);

    return {
        status: "ok",
        prompt,
        ar,
        shot,
        seed,
        repairMeta,
    };
}

/**
 * Finds all image markers in a message, parses them one by one,
 * and returns structured results for DOM handling.
 *
 * Success:
 *   { status: "ok", ... }
 *
 * Parse failure:
 *   { status: "parse_error", reason, repairMeta, rawMarker }
 *
 * Generation failure:
 *   { status: "generation_error", repairMeta, rawMarker }
 *
 * @param {string} text
 * @param {number} messageIndex
 * @returns {Promise<Array<
 *   | {
 *       status: "ok",
 *       imageUrl: string,
 *       seed: number,
 *       prompt: string,
 *       promptId: string,
 *       filename: string,
 *       effectiveAr: string,
 *       effectiveShot: string,
 *       resolution: { width: number, height: number },
 *       shotTags: string,
 *       ar: string,
 *       shot: string,
 *       repairMeta: {
 *         defaulted: string[],
 *         duplicateTokens: {
 *           AR: string[],
 *           SHOT: string[],
 *           SEED: string[]
 *         },
 *         possibleSeedInPrompt: boolean
 *       }
 *     }
 *   | {
 *       status: "parse_error",
 *       reason: string,
 *       repairMeta: {
 *         defaulted: string[],
 *         duplicateTokens: {
 *           AR: string[],
 *           SHOT: string[],
 *           SEED: string[]
 *         },
 *         possibleSeedInPrompt: boolean
 *       },
 *       rawMarker: string
 *     }
 *   | {
 *       status: "generation_error",
 *       repairMeta: {
 *         defaulted: string[],
 *         duplicateTokens: {
 *           AR: string[],
 *           SHOT: string[],
 *           SEED: string[]
 *         },
 *         possibleSeedInPrompt: boolean
 *       },
 *       rawMarker: string
 *     }
 * >>}
 */
export async function processAllImageMarkers(text, messageIndex) {
    const matches = [...text.matchAll(MARKER_REGEX_GLOBAL)];
    if (matches.length === 0) return [];

    const results = [];

    for (const match of matches) {
        const parsed = parseMarkerContent(match[1], messageIndex);

        if (parsed.status === "parse_error") {
            results.push({
                ...parsed,
                rawMarker: match[0],
            });
            continue;
        }

        const { prompt, ar, shot, seed, repairMeta } = parsed;

        try {
            const result = await generateImage({
                prompt,
                ar,
                shot,
                seed,
                messageIndex,
            });

            // Save the actual used seed so LOCK can reuse it later.
            saveLastSeed(result.seed);

            results.push({
                status: "ok",
                ...result,
                ar,
                shot,
                repairMeta,
            });
        } catch {
            results.push({
                status: "generation_error",
                repairMeta,
                rawMarker: match[0],
            });
        }
    }

    return results;
}