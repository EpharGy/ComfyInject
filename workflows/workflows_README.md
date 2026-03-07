# Custom Workflows

Place your ComfyUI workflow JSON files here.

ComfyInject ships with `comfyinject_default.json` which works out of the box using only built-in ComfyUI nodes. You only need a custom workflow if you want to use custom nodes, ControlNet, LoRAs wired in at the node level, or any other advanced setup.

---

## Placeholder Requirements

Your workflow JSON can use any of the following placeholder strings. ComfyInject will replace them with real values before sending to ComfyUI. **You don't have to use all of them** — only place the ones that are relevant to your workflow. Any placeholder not present in your JSON is simply ignored.

| Placeholder | Type | Description |
|---|---|---|
| `"{{CHECKPOINT}}"` | string | Model filename from the Checkpoint field in settings |
| `"{{POSITIVE_PROMPT}}"` | string | Prepend prompt + shot tags + LLM prompt + append prompt |
| `"{{NEGATIVE_PROMPT}}"` | string | Negative prompt from settings |
| `"{{WIDTH}}"` | integer | Image width in pixels |
| `"{{HEIGHT}}"` | integer | Image height in pixels |
| `"{{SEED}}"` | integer | Resolved numeric seed |
| `"{{STEPS}}"` | integer | Sampling steps |
| `"{{CFG}}"` | float | CFG scale |
| `"{{SAMPLER}}"` | string | Sampler name |
| `"{{SCHEDULER}}"` | string | Scheduler name |
| `"{{DENOISE}}"` | float | Denoise strength |

> The quotes are part of the placeholder syntax. In your JSON file, the value field must be the placeholder string in quotes, e.g. `"seed": "{{SEED}}"`. ComfyInject replaces the entire quoted string including the quotes with the correct typed value.

### About `{{CHECKPOINT}}`

Despite the name, this placeholder isn't limited to checkpoint models. It gets replaced with whatever you type into the **Checkpoint** field in the extension settings. If your workflow uses a `UNETLoader`, `DiffusionModelLoader`, or any other node that loads a model by filename, you can use `"{{CHECKPOINT}}"` in that node's model field and type the correct filename into ComfyInject's Checkpoint setting. All ComfyInject does is a text replacement — it doesn't care what type of node receives the value.

### Reusing Placeholders

Each placeholder can appear in **multiple places** across your workflow. Every occurrence will be replaced with the same value. For example, if two nodes in your workflow both need `steps`, you can put `"{{STEPS}}"` in both and they'll both receive the same value from your settings. This works for any placeholder.

---

## Positive Prompt Order

The `{{POSITIVE_PROMPT}}` placeholder is filled with the following components in order, separated by commas:

1. **Prepend Prompt** — custom tags from the Prepend Prompt setting (if set)
2. **Shot Tags** — Danbooru tags for the active shot type (e.g. `close-up, face focus` for CLOSE)
3. **LLM Prompt** — the prompt the LLM wrote in the marker
4. **Append Prompt** — custom tags from the Append Prompt setting (if set)

If resolution or shot lock is active, the locked values are used regardless of what the LLM specified.

---

## Using a Custom Workflow

1. Export your workflow from ComfyUI using **Save (API format)** — not the regular Save.
2. Replace the literal values in your exported JSON with the placeholder strings from the table above.
3. Save the file into this folder.
4. In the ComfyInject extension settings, type your workflow filename into the **Workflow** field. The field validates automatically — you'll see a notification confirming whether the file was found.