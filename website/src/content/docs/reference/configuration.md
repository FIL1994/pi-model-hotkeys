---
title: Configuration storage
description: Where presets live, how sessions synchronize, and how configuration errors are handled.
---

## File location

Assignments are stored in:

```text
~/.pi/agent/model-hotkeys.json
```

If `PI_CODING_AGENT_DIR` is set, the file lives under that directory instead. Presets are shared across projects and sessions.

The configuration contains **model identifiers and preferences, not credentials**. Manage provider authentication through Pi's `/login` command.

## Prefer the in-Pi editor

Use `/model-hotkeys` to assign models, change thinking levels, add labels, choose the modifier, and toggle Alt+wheel. It previews model preset saves and warns about duplicates.

## Validation and safe updates

- Invalid configuration is reported rather than overwritten.
- Provider and model IDs cannot contain surrounding whitespace.
- Labels are trimmed and cannot contain control characters.
- A failed update leaves the original file untouched.

## Multiple sessions

Changes from another session appear within about a second. Modifier changes require `/reload` in each session before the new key bindings work.

:::caution[Concurrent saves]
Avoid configuring slots in two sessions simultaneously. Concurrent saves are **last-writer-wins**.
:::
