# Changelog

All notable changes to this project will be documented in this file.

## [1.1.0] - 2026-07-21

### Added
- **Separate Mode Stacks & Command Hotkeys**:
  - Maintained distinct, isolated navigation stacks for Edit Mode and Reading Mode.
  - Set default hotkeys for `Go back` and `Go forward` to `Cmd + [` (`Mod+[`) and `Cmd + ]` (`Mod+]`).
  - History Navigator Modal automatically detects the current view mode (defaulting to Read mode if no mode is active) and displays only the entries for that mode.
- **Code Block Folding (Reading Mode)**:
  - Toggle fold buttons next to Obsidian's copy button on rendered code blocks.
  - Persistent fold state saved in `.obsidian/code-fold-history.json` with `fold_all` state and missing block auto-pruning.
  - Command `Toggle fold all code blocks` in command palette.
- **Folder-Local History**:
  - Optional vault-level history storage (`.obsidian/cursor-history.json`).
- **Scroll & Position Restoration**:
  - Auto-restoration of exact selection and scroll line/offset on file open and Reading View navigation.
- **Link Jump Tracking & History Modal**:
  - Click tracking on internal links (`a.internal-link`) before page navigation.
  - Fuzzy-search history navigator modal command.
- **Sanitization & Settings**:
  - Auto-cleanup of embed references (`![[...`), deleted notes, or invalid paths.
  - Configurable max history entries and line jump thresholds.
