# Changelog

All notable changes to this project are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

### Added

- Opt-in Alt+wheel slot cycling over the model legend in fullscreen mode.
- Optional labels for model slots.
- Capability-aware thinking-level choices.
- Configurable full, friendly, short, and compact model names in the legend.

### Changed

- Configuration file watching is more reliable and testable.
- Configuration validation rejects unusable model identifiers and labels.

### Fixed

- Pending model switches and configuration dialogs no longer update stale
  sessions after a reload or session replacement.

## 0.1.0 - 2026-09-09

### Added

- Configurable model shortcuts for slots 1–9.
- Persistent model and thinking-level presets.
- An in-Pi configuration menu and shortcut legend.
