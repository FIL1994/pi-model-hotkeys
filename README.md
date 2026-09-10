# Pi Model Hotkeys

Nine global model presets, selected with **Alt+1 … Alt+9**.

An always-visible legend below the editor (above the footer) shows every assigned
shortcut, model ID, and optional thinking preset. Providers are omitted unless
the same model ID is assigned through different providers; the configuration menu
always shows full provider/model IDs. **●** highlights slots matching both the
current provider/model and the saved thinking level. "Keep current" slots match
any thinking level. If Pi clamps an unsupported preset level to a different level,
that preset will not be highlighted; save the current model and thinking to capture
the supported level instead. The legend wraps
to fit the terminal without replacing Pi's footer or other extensions' statuses.
It updates after configuration and model changes; edits from other sessions are
picked up within about a second. Unassigned slots are omitted; when all are empty,
the legend shows a `/model-hotkeys` setup hint. Pending modifier changes display
the currently working keys and a `/reload` reminder.

## Install locally

From the root of your local checkout:

```sh
pi install .
```

Then run `/reload` in Pi.

## Configure

- `/model-hotkeys` opens the slot configuration menu.
- `/model-hotkeys 3` edits slot 3 directly.
- Choose a provider and model, save the current model and thinking level, or clear a slot.
- Each slot can retain the current thinking level or request a specific level (Pi clamps it to the model's capabilities).
- The modifier menu supports `alt`, `ctrl`, `ctrl+alt`, and `alt+shift`. Modifier changes require `/reload` in each open session.

Slot assignments take effect immediately, including in other sessions. Configuration is saved in `~/.pi/agent/model-hotkeys.json` (respects `PI_CODING_AGENT_DIR`). No credentials are stored. Invalid configuration is reported rather than overwritten.

Switching preserves the conversation and changes only the current session, not Pi's default model. Hotkeys refuse to switch while Pi is busy; wait for completion or abort first. Unassigned slots and missing models/authentication produce notifications.

Your terminal or desktop may intercept modifier+number shortcuts. Choose another modifier if necessary; modified digits are terminal-dependent. Check `/hotkeys` for conflicts with other extensions. Simultaneous configuration saves from different Pi processes are last-writer-wins; avoid editing in two sessions at once.

## Development

```sh
npm install
npm run check
npm test
```
