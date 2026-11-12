# Hoard

Hoard is a free, open-source desktop app for collecting and organising visual references: images, videos, audio, fonts, PDFs and design files, in one fast, searchable library.

Built with [Tauri 2](https://tauri.app), Rust and React.

## Features

- **Libraries you own.** A library is a normal folder ending in `.hoard`. Each item lives in its own subfolder with the original file, a thumbnail and an `item.json` sidecar. Nothing is locked in a database: the SQLite search index can be rebuilt from the sidecars at any time.
- **Import anything.** Drag files or whole folders into the window, or use Import. Hidden files are skipped.
- **Thumbnails for many formats.** Common images are decoded natively; videos get a poster frame with `ffmpeg`; PDFs, PSD, HEIC, SVG, fonts, Office and iWork files use macOS Quick Look.
- **Watched folders.** Point Hoard at Downloads, Screenshots or any folder and new files are imported automatically (once they've finished copying), into a library folder of your choice.
- **Organise.** Nested folders (drag items onto folders, drag folders into folders), tags, 1–5 star ratings, notes and source links.
- **Smart folders.** Save rules (tags, type, size, rating, orientation, colour, date added and more, matching all or any) and matching items collect themselves.
- **Duplicates.** Exact copies are skipped on import. A review screen finds identical files and resized or re-saved pictures, suggests the best copy to keep, and moves the rest to the Trash while keeping their tags, folders and notes.
- **Browser extension.** Save images, videos and screenshots from Chrome, Edge, Brave or Arc with a right-click, or pick several images on a page at once. See [extension/README.md](extension/README.md).
- **Edit in place.** Batch rename with patterns (`{name}`, `{n:3}`, `{date}`, `{w}×{h}` and more, plus find and replace). Rotate and flip images; thumbnails, sizes and colours update automatically.
- **Packs and export.** Share items as a `.hoardpack` (files plus tags, ratings, notes and links) and import packs from the menu or by dropping them in. Copy originals out to any folder with tidy names.
- **Find.** Instant prefix search across names, tags, notes and links; filters for type, tags, rating and colour. Colours are extracted from every item, so you can find "everything blue".
- **Preview.** Full-window preview with arrow-key navigation, video and audio playback, and PDF viewing.
- **Trash.** Deleted items can be restored until you empty the Trash.

## Requirements

- macOS 12 or later (Windows and Linux builds are planned)
- Optional: `ffmpeg` / `ffprobe` for video thumbnails and durations (`brew install ffmpeg`)

## Build from source

```bash
pnpm install
pnpm tauri dev      # run in development
pnpm tauri build    # build Hoard.app
```

Run the core tests (they need a folder of sample files):

```bash
cd src-tauri && HOARD_SAMPLES=/path/to/samples cargo test
```

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| Space | Preview the selected item |
| ← → | Move selection / next and previous in preview |
| ⌘A | Select all |
| ⌘F | Search |
| Delete | Move to Trash |
| Esc | Clear selection / close preview |

## Library format

```
My Library.hoard/
  library.json          # name and folder tree
  index.db              # search index (safe to delete; rebuilt on open)
  items/<ID>/
    <original file>
    thumb.jpg | thumb.png
    item.json           # tags, folders, rating, note, link, palette, sizes
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Please read the [Code of Conduct](CODE_OF_CONDUCT.md) and report security problems as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
