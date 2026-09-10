---
title: Troubleshooting
description: Resolve intercepted shortcuts, missing models, busy-session warnings, and legend mismatches.
---

## A shortcut does nothing

Your terminal or desktop may intercept modifier+number keys. Choose another **Modifier** in `/model-hotkeys`, run `/reload`, and check `/hotkeys` for conflicts.

If the slot is unassigned, the extension shows a setup hint. Assign it through `/model-hotkeys` first.

## Pi says it is busy

Wait for the response to finish or abort it first. Both number-key and wheel switching require Pi to be idle.

## A model is missing or authentication fails

Run `/login` to configure provider access. Reassign the slot through `/model-hotkeys` if needed. In the picker, **Ctrl+R** refreshes the available models over the network.

If you use a scoped model list, **Tab** toggles between that snapshot and all authenticated available models. Hotkeys still refuse models outside an active non-empty scope.

## The active slot is not highlighted

The indicator matches the provider, model, and saved thinking level. Pi may adjust an unsupported thinking level. Choose **Use current model and thinking** to save the supported setting.

Multiple highlights are normal when a **Keep current** slot and an explicit thinking preset both match.

## The modifier has not changed

Run `/reload` in every open session. The legend shows the working shortcuts until each session reloads.

## Alt+wheel does not switch

Confirm that:

1. **Alt+wheel** is enabled in `/model-hotkeys`.
2. Pi is running with `--tui-mode fullscreen`.
3. Your pointer is over the model strip.
4. You are holding **Alt**, even if you changed the number-key modifier.
5. Your terminal forwards Alt+wheel events and Pi is idle.

## Still stuck?

[Open an issue on GitHub](https://github.com/FIL1994/pi-model-hotkeys/issues) with your terminal, Pi version, and steps to reproduce. Do not include credentials.
