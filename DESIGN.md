# Design Document: ndifftool

## Overview
ndifftool is a modal graphical diff and merge utility inspired by tools like `diffuse` and `meld`. It provides a streamlined interface for comparing and merging text files, built using Neutralinojs for the desktop environment and CodeMirror 5 for the editor components.

## Core Philosophies
- **Modal Operation**: Distinct separation between navigation/selection and text editing.
- **Line-Oriented Merging**: Primary focus on moving blocks of lines between files.
- **Visual Consistency**: Synchronized scrolling and clear diff highlighting across multiple panes.

## Tech Stack
- **Runtime**: [Neutralinojs](https://neutralino.js.org/) (Lightweight desktop application framework).
- **Editor**: [CodeMirror 5](https://codemirror.net/5/) (specifically the Merge addon).
- **Diff Engine**: [google-diff-match-patch](https://github.com/google/diff-match-patch).
- **Styling**: Vanilla CSS with Monokai theme integration.

## Interaction Model

### Modality
The application operates in two primary modes, toggled via the keyboard:

1.  **Line Select Mode (Default)**:
    *   **Selection**: Clicking or dragging selects entire lines. Partial line selections are automatically expanded to line boundaries.
    *   **Visuals**: The text cursor is hidden. The active editor pane is highlighted with a blue border.
    *   **Goal**: Quick navigation and block-level merging.
    *   **Activation**: Press `Escape` while in Edit Mode.

2.  **Edit Mode**:
    *   **Selection**: Standard character-level selection.
    *   **Behavior**: Editors become writable. The text cursor is visible and blinking.
    *   **Goal**: Fine-grained text adjustments.
    *   **Activation**: Press `Enter` while an editor is focused in Line Select Mode.

### Keybindings
- `Enter`: Switch to **Edit Mode**.
- `Escape`: Switch to **Line Select Mode**.
- `Left/Right Buttons`: Move selected lines from the active pane to the adjacent pane. These actions automatically switch the application to Line Select Mode first.

## Architecture

### Layouts
The tool dynamically adjusts its layout based on the number of input files provided via command-line arguments:
- **2-Way Diff**: Standard left-right comparison.
- **3-Way Merge**: Left (Original), Center (Merge Result), Right (Original).
- **4-Way Merge**: BASE, LOCAL, REMOTE, and MERGE panes (Custom layout).

### 4-Column Implementation
While 2 and 3-way views utilize the native CodeMirror Merge addon, the 4-column view is a custom implementation:
- **Synchronization**: Scroll events in any pane are mirrored to all others.
- **Diff Calculation**: Uses `diff_match_patch` to calculate line-level chunks between the BASE file and the other three versions.
- **Mapping**: A `mapLine` utility translates line numbers between panes using calculated diff chunks, ensuring that merging "Local to Merge" correctly identifies the target line range even if the files have diverged in length.

### File Integration
- **Input**: Files are passed as CLI arguments.
- **Output**: The "Save" button writes the active pane back to its original file path.

## File Structure
- `resources/index.html`: UI Structure and external dependencies.
- `resources/styles.css`: Layout, mode-specific styling, and diff highlighting.
- `resources/js/main.js`: Core logic, mode switching, line mapping, and Neutralino integration.
- `resources/js/diff_match_patch.js`: Algorithm for diff calculation.
