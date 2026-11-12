# Writing a Hoard plugin

A plugin is a folder with two files:

```
my-plugin/
  plugin.json
  index.html
```

`plugin.json`:

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "What it does, in one line.",
  "author": "You",
  "main": "index.html",
  "permissions": ["read"]
}
```

- `id`: letters, numbers, `-`, `_` and `.` only.
- `permissions`: `"read"` lets the plugin see the selected items and search the library. `"write"` also lets it change item names, ratings, notes, links and tags. It can never delete files.

Install it from the **＋** next to **Plugins** in the sidebar (choose the folder). Click the plugin to open it. It runs on the items you have selected.

## The `hoard` API

Your page runs in a sandbox (scripts only, no access to your disk, the network origin of Hoard, or the app itself). Hoard injects `window.hoard`:

| Call | Returns |
| --- | --- |
| `hoard.selection()` | the selected items |
| `hoard.search({ text, tags, kinds, minRating })` | up to 500 matching items |
| `hoard.update(ids, { name, rating, note, url, addTags, removeTags })` | number of items changed (needs `write`) |
| `hoard.notify(message)` | shows a short message in Hoard |
| `hoard.close()` | closes the plugin |

Each item has `id, name, ext, kind, width, height, size, tags, rating, note, url, palette, labels, text, createdAt, thumbUrl, fileUrl`. `thumbUrl` and `fileUrl` can be used in `<img>` and `<video>`.

Hoard's colours are available as CSS variables (`--bg`, `--panel`, `--surface`, `--line`, `--text`, `--muted`, `--accent`, `--danger`), and the interface language is in `<meta name="hoard-lang">`.

Keep everything in one HTML file: inline your CSS and JavaScript.

## Examples

- [`palette-export`](palette-export): read-only. Turns the colours of the selection into CSS variables or JSON.
- [`tag-tidy`](tag-tidy): uses `write`. Normalises tag spelling across the selection.
