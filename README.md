# ndifftool

`ndifftool` is a graphical diff and merge tool for comparing text files. It is inspired by tools such as `meld` and `diffuse`, with a modal workflow closer to `diffuse`: normal navigation and block-level merging happen in Line mode, while direct text editing happens in Edit mode.

The application is built with Neutralinojs and CodeMirror 5. It runs as a lightweight desktop app and opens files passed on the command line.

## Features

- Compare two text files side by side.
- Work with three panes for merge-style workflows.
- Use modal Line and Edit modes.
- Select and move whole lines between adjacent panes.
- Save the currently active pane back to its source file.
- Use synchronized scrolling and visual diff highlighting.

## Modes

`ndifftool` has two interaction modes:

- **Line mode** is the default. Selections are expanded to whole lines, and the Left and Right buttons move selected lines between adjacent panes.
- **Edit mode** allows normal text editing within the active pane.

Press `Enter` to switch from Line mode to Edit mode. Press `Escape` to return to Line mode.

## Usage

Run with two files for a side-by-side comparison:

```sh
ndifftool left.txt right.txt
```

Run with three files for a three-pane merge workflow:

```sh
ndifftool left.txt merged.txt right.txt
```

The active pane is highlighted. Click a pane to make it active, select lines in Line mode, then use the Left or Right buttons to copy the selected line range to the adjacent pane.

## Saving

Use the `Save` button to write the active pane back to its original file path. On exit, `ndifftool` prompts for any modified files that have not been saved.

## Building

Install the Neutralino CLI:

```sh
npm install -g @neutralinojs/neu
```

Download the Neutralino runtime assets:

```sh
make bootstrap
```

Build standalone release artifacts:

```sh
make build
```

Run in development mode:

```sh
make run
```

Build a macOS app bundle:

```sh
make app
```

## Project Layout

- `resources/index.html`: application shell
- `resources/styles.css`: layout and diff styling
- `resources/js/main.js`: application logic
- `resources/js/diff_match_patch.js`: diff engine
- `neutralino.config.json`: Neutralino application configuration
- `Makefile`: common build and run targets

## License

[MIT](LICENSE)
