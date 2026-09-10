---
title: Modifiers & mouse wheel
description: Change number-key modifiers or enable optional Alt+wheel model switching in fullscreen mode.
---

## Change the shortcut modifier

Open `/model-hotkeys` and select **Modifier**. Choose from:

| Modifier        | Example for slot 2 |
| --------------- | ------------------ |
| `alt` (default) | Alt+2              |
| `ctrl`          | Ctrl+2             |
| `ctrl+alt`      | Ctrl+Alt+2         |
| `alt+shift`     | Alt+Shift+2        |

Run `/reload` in **each open session** after changing the modifier. Until you reload, the legend shows the working shortcuts and a reminder.

If a shortcut is intercepted by your terminal or desktop, try another modifier and check `/hotkeys` for conflicts.

## Enable Alt+wheel

Mouse-wheel switching is **off by default**. In `/model-hotkeys`, toggle **Alt+wheel** on, then use Pi in fullscreen mode:

```sh
pi --tui-mode fullscreen
```

Hold <kbd>Alt</kbd> and scroll **over the model strip**:

- Scroll up to select the previous assigned slot.
- Scroll down to select the next assigned slot.
- Slots cycle in numeric order, skip gaps, and wrap around.
- If nothing matches the current model/thinking, down starts at the first slot and up at the last.

The setting applies immediately and is stored as `"altScroll": true` in `model-hotkeys.json`.

:::note[Always Alt]
Wheel switching always uses Alt, independently of the number-key modifier. Your terminal must forward Alt+wheel events, and Pi must be idle. Regular mode and scrolling without Alt are unchanged.
:::
