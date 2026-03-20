import { MODULE_NAME } from "../settings.js";
import { getImageData } from "./state.js";

/**
 * Returns true if the image has any repair metadata worth surfacing in the UI.
 * @param {object | null} repairMeta
 * @returns {boolean}
 */
function hasRepairInfo(repairMeta) {
    if (!repairMeta || typeof repairMeta !== "object") return false;

    const defaulted = Array.isArray(repairMeta.defaulted) ? repairMeta.defaulted : [];
    const duplicateTokens = repairMeta.duplicateTokens || {};
    const duplicateCount =
        (Array.isArray(duplicateTokens.AR) ? duplicateTokens.AR.length : 0) +
        (Array.isArray(duplicateTokens.SHOT) ? duplicateTokens.SHOT.length : 0) +
        (Array.isArray(duplicateTokens.SEED) ? duplicateTokens.SEED.length : 0);

    return defaulted.length > 0 || duplicateCount > 0 || repairMeta.possibleSeedInPrompt === true;
}

/**
 * Opens the image gallery modal showing all generated images in the current chat.
 * Images are displayed as thumbnails with seeds. Clicking expands to full detail view.
 */
export function openGallery() {
    // Remove any existing gallery modal
    closeGallery();

    const context = SillyTavern.getContext();
    const metadata = context.chatMetadata[MODULE_NAME] || {};

    // Collect all images by scanning the actual current mes content of each message.
    // This ensures the gallery always matches what's on screen regardless of swipe state.
    // Metadata is used as supplementary info for extra fields like ar, shot,
    // promptId, and parser repair metadata.
    const allImages = [];
    const imgTagRegex = /<img class="comfyinject-image"[^>]*>/g;
    const srcRegex = /src="([^"]*)"/;
    const promptRegex = /data-prompt="([^"]*)"/;
    const seedRegex = /data-seed="([^"]*)"/;

    for (let i = 0; i < context.chat.length; i++) {
        const message = context.chat[i];
        if (!message?.mes) continue;

        const imgTags = [...message.mes.matchAll(imgTagRegex)];
        if (imgTags.length === 0) continue;

        const sendDateImages = message.send_date ? getImageData(metadata, message.send_date) : [];
        const metaImages = sendDateImages.length > 0 ? sendDateImages : getImageData(metadata, i);

        imgTags.forEach((match, imgIndex) => {
            const tag = match[0];
            const imageUrl = tag.match(srcRegex)?.[1] || null;
            const prompt = tag.match(promptRegex)?.[1]?.replace(/&quot;/g, '"') || "";
            const seed = parseInt(tag.match(seedRegex)?.[1], 10) || 0;

            // Metadata is supplementary — only use it for extra fields
            // like ar, shot, promptId, effective settings, and repair metadata.
            // and only if the seed matches the current img tag (avoids stale swipe data)
            const meta = metaImages[imgIndex] || {};
            const metaMatches = meta.seed === seed;

            allImages.push({
                prompt: prompt,
                seed: seed,
                ar: metaMatches ? (meta.ar || null) : null,
                shot: metaMatches ? (meta.shot || null) : null,
                imageUrl: imageUrl,
                promptId: metaMatches ? (meta.promptId || null) : null,
                filename: metaMatches ? (meta.filename || null) : null,
                effectiveAr: metaMatches ? (meta.effectiveAr || null) : null,
                effectiveShot: metaMatches ? (meta.effectiveShot || null) : null,
                resolution: metaMatches ? (meta.resolution || null) : null,
                shotTags: metaMatches ? (meta.shotTags || null) : null,
                repairMeta: metaMatches ? (meta.repairMeta || null) : null,
                messageIndex: i,
                imgIndex,
            });
        });
    }

    if (allImages.length === 0) {
        toastr.info("No images generated in this chat yet.", "ComfyInject");
        return;
    }

    // Build the modal overlay
    const overlay = document.createElement("div");
    overlay.id = "comfyinject-gallery-overlay";
    overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0, 0, 0, 0.85); z-index: 9999;
        display: flex; flex-direction: column; overflow: hidden;
    `;

    // Header
    const header = document.createElement("div");
    header.style.cssText = `
        display: flex; justify-content: space-between; align-items: center;
        padding: 12px 20px; color: white; flex-shrink: 0;
    `;
    header.innerHTML = `
        <span style="font-size: 18px; font-weight: bold;">ComfyInject Gallery (${allImages.length} image${allImages.length !== 1 ? "s" : ""})</span>
    `;

    const closeBtn = document.createElement("div");
    closeBtn.style.cssText = "cursor: pointer; font-size: 24px; color: white; padding: 4px 12px;";
    closeBtn.innerHTML = `<i class="fa-solid fa-xmark"></i>`;
    closeBtn.addEventListener("click", closeGallery);
    header.appendChild(closeBtn);
    overlay.appendChild(header);

    // Grid container
    const grid = document.createElement("div");
    grid.id = "comfyinject-gallery-grid";
    grid.style.cssText = `
        display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        gap: 12px; padding: 12px 20px; overflow-y: auto; flex: 1;
    `;

    // Build thumbnails
    for (const img of allImages) {
        const card = document.createElement("div");
        card.style.cssText = `
            background: rgba(255, 255, 255, 0.05); border-radius: 8px;
            overflow: hidden; cursor: pointer; transition: transform 0.15s;
        `;
        card.addEventListener("mouseenter", () => card.style.transform = "scale(1.03)");
        card.addEventListener("mouseleave", () => card.style.transform = "scale(1)");

        // Thumbnail image
        const thumb = document.createElement("img");
        if (img.imageUrl) {
            thumb.src = img.imageUrl;
        } else {
            // Fallback: try to extract from the message's mes field
            thumb.src = "";
            thumb.alt = "Image unavailable";
        }
        thumb.style.cssText = "width: 100%; height: auto; display: block;";

        // Info row below thumbnail
        const info = document.createElement("div");
        info.style.cssText = `
            padding: 6px 8px; color: #ccc; font-size: 11px;
            display: flex; justify-content: space-between; align-items: center;
        `;
        info.innerHTML = `
            <span title="Seed">🎲 ${img.seed}</span>
            <span title="Message index" style="opacity: 0.6;">msg ${img.messageIndex}</span>
        `;

        card.appendChild(thumb);

        // Show a small badge if the marker was repaired/defaulted during parsing.
        if (hasRepairInfo(img.repairMeta)) {
            const badge = document.createElement("div");
            badge.title = "This image used repaired/defaulted marker fields";
            badge.textContent = "⚠";
            badge.style.cssText = `
                position: absolute;
                top: 8px;
                left: 8px;
                width: 22px;
                height: 22px;
                border-radius: 999px;
                background: rgba(255, 170, 0, 0.9);
                color: black;
                font-weight: bold;
                font-size: 13px;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 2px 6px rgba(0,0,0,0.35);
            `;
            card.style.position = "relative";
            card.appendChild(badge);
        }

        card.appendChild(info);

        // Click to expand
        card.addEventListener("click", () => showDetail(img, overlay));

        grid.appendChild(card);
    }

    overlay.appendChild(grid);

    // Close on Escape key
    const escHandler = (e) => {
        if (e.key === "Escape") {
            closeGallery();
            document.removeEventListener("keydown", escHandler);
        }
    };
    document.addEventListener("keydown", escHandler);

    document.body.appendChild(overlay);
}

/**
 * Shows the detail view for a single image within the gallery.
 * @param {object} img - The image data object
 * @param {HTMLElement} overlay - The gallery overlay element
 */
function showDetail(img, overlay) {
    // Remove existing detail panel if any
    const existing = document.getElementById("comfyinject-gallery-detail");
    if (existing) existing.remove();

    // Hide the grid
    const grid = document.getElementById("comfyinject-gallery-grid");
    if (grid) grid.style.display = "none";

    const detail = document.createElement("div");
    detail.id = "comfyinject-gallery-detail";
    detail.style.cssText = `
        flex: 1; display: flex; flex-direction: column; overflow-y: auto;
        padding: 12px 20px; color: white;
    `;

    // Back button
    const backBtn = document.createElement("div");
    backBtn.style.cssText = `
        cursor: pointer; margin-bottom: 12px; font-size: 14px;
        display: inline-flex; align-items: center; gap: 6px; color: #aaa;
    `;
    backBtn.innerHTML = `<i class="fa-solid fa-arrow-left"></i> Back to gallery`;
    backBtn.addEventListener("click", () => {
        detail.remove();
        if (grid) grid.style.display = "grid";
    });
    detail.appendChild(backBtn);

    // Image display
    const imageContainer = document.createElement("div");
    imageContainer.style.cssText = "text-align: center; margin-bottom: 16px;";
    const fullImg = document.createElement("img");
    fullImg.src = img.imageUrl || "";
    fullImg.style.cssText = "max-width: 100%; max-height: 60vh; border-radius: 6px;";
    imageContainer.appendChild(fullImg);
    detail.appendChild(imageContainer);

    // Info table
    const infoTable = document.createElement("div");
    infoTable.style.cssText = `
        background: rgba(255, 255, 255, 0.05); border-radius: 8px;
        padding: 16px; display: grid; grid-template-columns: auto 1fr;
        gap: 8px 16px; font-size: 13px;
    `;

    // Build display strings for AR and Shot that show what was actually sent to ComfyUI
    let arDisplay = "N/A";
    if (img.effectiveAr && img.resolution) {
        arDisplay = `${img.effectiveAr} (${img.resolution.width} \u00d7 ${img.resolution.height})`;
    } else if (img.ar) {
        arDisplay = img.ar;
    }

    let shotDisplay = "N/A";
    if (img.effectiveShot && img.shotTags !== null && img.shotTags !== undefined) {
        shotDisplay = `${img.effectiveShot} (${img.shotTags || "no tags"})`;
    } else if (img.shot) {
        shotDisplay = img.shot;
    }

    const fields = [
        ["Seed", img.seed],
        ["Prompt", img.prompt],
        ["AR", arDisplay],
        ["Shot", shotDisplay],
        ["Filename", img.filename || "N/A"],
        ["Message", `#${img.messageIndex}`],
        ["Image #", `${img.imgIndex + 1} in message`],
        ["Prompt ID", img.promptId || "N/A"],
    ];

    for (const [label, value] of fields) {
        const labelEl = document.createElement("span");
        labelEl.style.cssText = "color: #888; font-weight: bold; white-space: nowrap;";
        labelEl.textContent = label;

        const valueEl = document.createElement("span");
        valueEl.style.cssText = "color: #ddd; word-break: break-all;";
        if (label === "Prompt ID" && value !== "N/A") {
            // Make prompt ID a clickable link to ComfyUI history
            const settings = SillyTavern.getContext().extensionSettings[MODULE_NAME];
            const host = settings?.comfy_host || "http://127.0.0.1:8188";
            const link = document.createElement("a");
            link.href = `${host}/history/${value}`;
            link.target = "_blank";
            link.style.cssText = "color: #6cb4ee; text-decoration: underline;";
            link.textContent = value;
            valueEl.appendChild(link);
        } else {
            valueEl.textContent = value;
        }

        infoTable.appendChild(labelEl);
        infoTable.appendChild(valueEl);
    }

    detail.appendChild(infoTable);

    // Repair info block
    if (hasRepairInfo(img.repairMeta)) {
        const repairMeta = img.repairMeta || {};
        const defaulted = Array.isArray(repairMeta.defaulted) ? repairMeta.defaulted : [];
        const duplicateTokens = repairMeta.duplicateTokens || {};

        const repairSection = document.createElement("div");
        repairSection.style.cssText = `
            margin-top: 16px;
            background: rgba(255, 170, 0, 0.08);
            border: 1px solid rgba(255, 170, 0, 0.25);
            border-radius: 8px;
            padding: 16px;
            color: white;
        `;

        const title = document.createElement("div");
        title.style.cssText = "font-weight: bold; margin-bottom: 10px; color: #ffcc66;";
        title.textContent = "Repair Info";
        repairSection.appendChild(title);

        const repairList = document.createElement("div");
        repairList.style.cssText = `
            display: grid;
            grid-template-columns: auto 1fr;
            gap: 8px 16px;
            font-size: 13px;
        `;

        const rows = [
            [
                "Defaulted",
                defaulted.length > 0 ? defaulted.join(", ") : "None",
            ],
            [
                "Duplicate AR",
                Array.isArray(duplicateTokens.AR) && duplicateTokens.AR.length > 0
                    ? duplicateTokens.AR.join(", ")
                    : "None",
            ],
            [
                "Duplicate SHOT",
                Array.isArray(duplicateTokens.SHOT) && duplicateTokens.SHOT.length > 0
                    ? duplicateTokens.SHOT.join(", ")
                    : "None",
            ],
            [
                "Duplicate SEED",
                Array.isArray(duplicateTokens.SEED) && duplicateTokens.SEED.length > 0
                    ? duplicateTokens.SEED.join(", ")
                    : "None",
            ],
            [
                "Possible Seed In Prompt",
                repairMeta.possibleSeedInPrompt ? "Yes" : "No",
            ],
        ];

        for (const [label, value] of rows) {
            const labelEl = document.createElement("span");
            labelEl.style.cssText = "color: #d9b15c; font-weight: bold; white-space: nowrap;";
            labelEl.textContent = label;

            const valueEl = document.createElement("span");
            valueEl.style.cssText = "color: #eee; word-break: break-word;";
            valueEl.textContent = value;

            repairList.appendChild(labelEl);
            repairList.appendChild(valueEl);
        }

        repairSection.appendChild(repairList);
        detail.appendChild(repairSection);
    }

    overlay.appendChild(detail);
}

/**
 * Closes the gallery modal if it's open.
 */
export function closeGallery() {
    const overlay = document.getElementById("comfyinject-gallery-overlay");
    if (overlay) overlay.remove();
}