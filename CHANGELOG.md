# Changelog

## [0.1.1] - 2026-11-20

### Fixed

- An `AGENTS.local.md` reached through two paths (a symlink and its target) was added twice ([#1](https://github.com/cardmage/pi-agents-local/issues/1)).

## [0.1.0] - 2026-11-20

### Added

- Load `AGENTS.local.md` right after each context file Pi loaded (`AGENTS.md`, `AGENTS.override.md`, `CLAUDE.md`) from the same folder.
- `/agents-local` command that shows the added files.
