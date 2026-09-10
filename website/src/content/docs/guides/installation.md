---
title: Installation
description: Install Pi Model Hotkeys and get ready to assign your first shortcut.
---

## Install in Pi

With Pi installed, run this in your terminal:

```sh
pi install git:github.com/FIL1994/pi-model-hotkeys
```

In an existing Pi session, load the extension:

```text
/reload
```

Then open the configuration menu:

```text
/model-hotkeys
```

Choose a slot from **1–9**, then **Use current model and thinking** for a quick first preset, or **Choose model** to browse. Confirm the save preview, close the menu, and press <kbd>Alt</kbd> + your slot number.

## Provider access

The picker uses authenticated available models. Run `/login` in Pi to configure provider access if the model you want is missing.

## Load a local checkout

From the repository root:

```sh
bun install
pi install .
```

Run `/reload` after changing extension code.

Continue with [your first shortcuts](../shortcuts/) for the full configuration workflow.
