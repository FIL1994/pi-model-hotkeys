---
title: Your first shortcuts
description: Assign, label, copy, and clear the nine model preset slots.
---

## Assign a slot

1. Run `/model-hotkeys`.
2. Select a slot from **1–9**.
3. Select **Choose model** to pick a provider, model, and thinking setting, or **Use current model and thinking** to save your current setup.
4. Review the exact legend-style preview and confirm the save. Duplicate presets produce an additional warning.
5. Close the menu and press <kbd>Alt</kbd> + the slot number.

Assignments take effect immediately. Switching keeps your conversation intact and does not change Pi's default model for new sessions.

## Jump straight to a slot

| Command                     | Action                                         |
| --------------------------- | ---------------------------------------------- |
| `/model-hotkeys`            | Configure slots, model names, or the modifier  |
| `/model-hotkeys 3`          | Configure slot 3 directly                      |
| `/model-hotkeys 3 gpt luna` | Configure slot 3 with a prefilled model search |

## Label a preset

Select an assigned slot and choose **Set/remove label**. A short label like `quick` or `deep` replaces the model name in the legend. Submit a blank label to remove it.

The configuration menu still shows the slot ID and full model details.

## Copy a preset

Choose **Copy preset from another slot** to copy a model and thinking preset. The destination slot's label is not copied from the source. Copying, choosing a model, and saving the current model all require a save preview confirmation.

## Clear a slot

Select the slot and choose **Clear slot**. Clearing and label changes do not require a save preview. Pressing an unassigned shortcut shows a setup hint rather than switching models.

:::note[Switch while idle]
Hotkeys deliberately refuse to switch models during an active run. Wait for the response to finish or abort it first.
:::
