# Contributing to Hoard

Thanks for helping. Bug reports, ideas and pull requests are all welcome.

## Before you start

- For anything bigger than a small fix, open an issue first so we can agree on the approach.
- Keep pull requests focused: one change per PR.

## Development

```bash
pnpm install
pnpm tauri dev
```

Before you open a PR:

```bash
pnpm build                 # type-checks the frontend
cd src-tauri && cargo test # core tests (set HOARD_SAMPLES to run the full test)
cargo clippy
```

## Rules for contributions

- **Only submit work you have the right to share.** Code, icons, fonts, images and text must be your own or under a licence compatible with MIT, with attribution where the licence needs it.
- **No code, assets or text copied from other apps**, including closed-source asset managers, and no material taken from decompiled or extracted app bundles. Pull requests that include such material will be closed.
- Write new code in the existing style. Rust in `src-tauri/src`, React + TypeScript in `src`.
- User files are precious: never change or delete an item's original file outside the explicit "Empty Trash" action.

By contributing you agree that your work is released under the [MIT License](LICENSE).
