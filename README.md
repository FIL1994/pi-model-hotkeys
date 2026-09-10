# Pi Model Hotkeys

Jump straight to your favorite models with **Alt+1–9**. Assign up to nine presets, optionally including a thinking level, and keep the shortcuts visible below Pi's editor.

- **Direct switching** — no cycling through models or opening a picker.
- **In-Pi configuration** — assign, replace, or clear slots with `/model-hotkeys`.
- **Persistent presets** — use the same assignments across projects and sessions.
- **Visible shortcuts** — a compact legend shows your assignments and highlights matching presets.

## Install

```sh
pi install git:github.com/FIL1994/pi-model-hotkeys
```

Run `/reload` in an existing Pi session to load the extension.

## Set up your shortcuts

1. Run `/model-hotkeys`.
2. Select a slot from **1–9**.
3. Choose **Choose model** to pick a provider, model, and thinking setting—or **Use current model and thinking** to save your current setup. Use **Set/remove label** to give an existing slot a short label (blank removes it).
4. Close the menu and press **Alt + the slot number** to switch.

Assignments take effect immediately. Switching keeps your conversation intact and does not change Pi's default model for new sessions.

| Command | Action |
| --- | --- |
| `/model-hotkeys` | Configure slots or change the modifier |
| `/model-hotkeys 3` | Configure slot 3 directly |

To remove an assignment, select its slot and choose **Clear slot**. Unassigned keys show a setup hint rather than switching models.

## Shortcut legend

The legend sits **below the editor, above the footer**. For example, with three presets for the same model:

```text
alt+1 gpt-5.6-luna (low) | ● alt+2 gpt-5.6-luna (high) | ● alt+3 gpt-5.6-luna
```

- **●** marks a matching provider, model, and thinking level. A slot set to **Keep current** matches that model at any thinking level, so more than one slot can be highlighted.
- Provider names appear only when needed to distinguish the same model ID across providers.
- A configured label replaces the model name in the legend; the configuration menu always retains slot IDs and full model details.
- Only assigned slots appear. The legend wraps on narrow terminals and leaves Pi's existing footer alone.
- Changes made in another session appear within about a second.

## Thinking presets

Choose **Keep current** to switch models without requesting a new thinking level, or save an explicit level such as `low`, `high`, or `xhigh`.

Pi adjusts thinking levels to what the target model supports. If a saved level is unsupported and Pi selects a different one, that slot won't be highlighted as an exact match. Use **Use current model and thinking** to save the supported setting.

## Change the modifier

Open `/model-hotkeys` and select **Modifier**. Supported choices are:

- `alt` — default
- `ctrl`
- `ctrl+alt`
- `alt+shift`

Run `/reload` in each open session after changing the modifier. Until then, the legend shows the working shortcuts and a reload reminder.

## Troubleshooting

**A shortcut does nothing**  
Your terminal or desktop may intercept modifier+number keys. Try another modifier and check `/hotkeys` for conflicts.

**Pi says it's busy**  
Wait for the response to finish or abort it first. Hotkeys deliberately refuse to switch models during an active run.

**A model is missing or authentication fails**  
Use `/login` to configure provider access, then reassign the slot through `/model-hotkeys` if needed.

## Configuration storage

Assignments are stored in `~/.pi/agent/model-hotkeys.json`, or under `PI_CODING_AGENT_DIR` when set. The file contains model identifiers and preferences, not credentials.

Invalid configuration is reported rather than overwritten. Avoid configuring slots in two sessions simultaneously: concurrent saves are last-writer-wins.
Provider and model IDs cannot contain surrounding whitespace, and labels are trimmed and cannot contain control characters. A failed update leaves the original file untouched.

## Development

From a local checkout:

```sh
npm install
npm run check
npm test
```

To load your checkout in Pi:

```sh
pi install .
```

Run `/reload` after changing extension code.
