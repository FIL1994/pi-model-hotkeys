---
title: Thinking & model picker
description: Save thinking presets, search models, and work with scoped model lists.
---

## Keep current or save a level

Choose **Keep current** to switch models without requesting a new thinking level. Alternatively, save an explicit level such as `low`, `high`, or `xhigh`.

You can assign the same model to multiple slots with different thinking settings—for example, one for fast questions and another for deeper reasoning.

:::caution[Model support varies]
Pi adjusts thinking levels to what the target model supports. If a saved level is unsupported and Pi selects a different one, the slot will not highlight as an exact match. Choose **Use current model and thinking** to save the supported setting.
:::

## Search and scope

The model picker starts in the session's **scoped model list**, when one is configured. Search matches the friendly name, provider, and model ID.

| Key                            | Action                                                                    |
| ------------------------------ | ------------------------------------------------------------------------- |
| <kbd>Tab</kbd>                 | Toggle between the scoped snapshot and all authenticated available models |
| <kbd>Ctrl</kbd> + <kbd>R</kbd> | Explicitly refresh models over the network                                |

Cached rows stay visible during refresh. Scoped rows are retained by provider/model ID.

A shortcut refuses to switch to an assigned model **outside the active non-empty scope**. Seeing a model in the all-models picker does not bypass that restriction.

Refreshes are bounded and can time out without blocking the picker. If a refresh
fails or times out, the cached models remain available; press <kbd>Ctrl</kbd> +
<kbd>R</kbd> to retry.
