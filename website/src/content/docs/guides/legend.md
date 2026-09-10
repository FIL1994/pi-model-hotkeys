---
title: Legend & appearance
description: Read active preset indicators and customize model names and labels in the editor legend.
---

The shortcut legend sits **below the editor, above the footer**. Only assigned slots appear, and the legend wraps on narrow terminals without replacing Pi's footer.

```text
alt+1 gpt-5.6-luna (low) | ● alt+2 gpt-5.6-luna (high) | ● alt+3 gpt-5.6-luna
```

## What the dot means

**●** marks a matching provider, model, and thinking level. A slot configured with **Keep current** matches that model at any thinking level, so multiple slots can be highlighted at once.

Provider names appear when needed to distinguish identical model IDs across providers.

## Choose a naming style

Open `/model-hotkeys` and select **Model names**. Changes apply immediately.

| Style           | Example                     |
| --------------- | --------------------------- |
| Full            | `openai-codex/gpt-5.6-luna` |
| Friendly        | `GPT-5.6 Luna`              |
| Short (default) | `gpt-5.6-luna`              |
| Compact         | `luna`                      |

Compact names keep useful family context where needed, such as `gemini-pro`. Ambiguous names are qualified automatically.

## Use your own labels

Choose **Set/remove label** on an assigned slot to replace its displayed model name. Full model details remain available in the configuration menu.

Changes made in another session appear within about a second. A modifier change is different: it requires `/reload`, and the legend shows the currently working shortcuts with a reload reminder until then.
