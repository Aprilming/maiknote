# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MarkNote is a macOS-native AI Markdown floating note app built with Tauri 2.x + Vue 3.x + TypeScript. Notes are stored as individual `.md` files in iCloud (`~/Library/Mobile Documents/com~apple~CloudDocs/MaikNote/`).

## Commands

```bash
# Install dependencies
npm install

# Development mode
npm run tauri dev

# Build for Apple Silicon
npm run tauri build -- --target aarch64-apple-darwin

# Build for Intel
npm run tauri build -- --target x86_64-apple-darwin
```

## Architecture

### Frontend (src/)
- **Pinia stores** (`stores/`): `noteStore.ts` manages notes with debounced iCloud sync, `settingStore.ts` for app settings, `assistantsStore.ts` for AI assistants
- **Composables** (`composables/`): `useFileSystem.ts` wraps Tauri invoke commands, `useTheme.ts` handles dark/light theme, `useGlobalShortcut.ts` manages global hotkeys
- **Components**: `Editor/` (TiptapEditor.vue - main editor), `Sidebar/`, `TitleBar/`, `Settings/`, `Search/`, `Assistant/`
- **Tiptap** is the markdown editor with Notion-style block operations (see `TiptapEditor.vue`)

### Editor Features (Tiptap)
- Block left-side menu button (hover to show drag handle + block menu trigger)
- Block operation popover (convert block type, font style, colors, move, duplicate, delete)
- BubbleMenu with formatting: Bold, Italic, Underline, Strikethrough, Code, Color pickers, Heading shortcuts
- Global drag handle for block reordering
- Slash command menu for block insertion
- Task list, code blocks with syntax highlighting

### Backend (src-tauri/)
- **lib.rs**: Tauri commands for file I/O (`read_note`, `write_note`, `delete_note`, `read_metadata`, `write_metadata`), global shortcut registration, window alpha, and macOS-specific vibrancy effects
- iCloud path: `~/Library/Mobile Documents/com~apple~CloudDocs/MaikNote/`
- Storage format: `metadata.json` (index) + `note_<uuid>.md` (content) + `assistants.json` (AI assistant configs)

### Data Flow
1. `noteStore.initialize()` loads all notes from iCloud via `useFileSystem` composable
2. `scheduleSave()` debounces writes (500ms) to prevent excessive iCloud sync
3. On content change → `updateNote()` → extracts title from first markdown heading/line → `scheduleSave()`

### Window Behavior
- Transparent floating window with native vibrancy (NSVisualEffectView)
- Cmd+Opt+A global shortcut toggles visibility
- Auto-hide on focus loss (unless always-on-top is enabled)
- Borderless window with custom TitleBar component
