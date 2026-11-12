# Hoard Collector (browser extension)

Save images, videos and screenshots from any web page into the library that's open in the Hoard desktop app.

Works in Chrome, Edge, Brave, Arc and other Chromium browsers (Manifest V3).

## Install (developer build)

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose this `extension` folder.
3. In Hoard, click the library name (top left) → **Browser extension…** → **Copy**.
4. Open the extension's **Options**, paste the token and click **Connect**.

## Use

- Right-click an image, video or audio → **Save to Hoard**
- Right-click a link → **Save linked file to Hoard**
- Right-click the page → **Save screenshot of this page to Hoard**, or press **Alt+Shift+S**
- Toolbar button: pick a folder and tags, take a screenshot, or **Pick images on page** to save several at once

A green ✓ on the toolbar icon means it was saved; a red ! means it wasn't (hover the icon for the reason).

## How it talks to Hoard

Hoard listens on `127.0.0.1:47821` (this computer only). Every request carries the token, and requests from ordinary web pages are refused, so websites can't add files to your library.

| Method | Path | Body |
| --- | --- | --- |
| GET | `/v1/status` | – returns the open library and its folders |
| POST | `/v1/items` | `{ url \| data, fileName?, pageUrl?, title?, tags?, folderId?, note? }` |

`data` is base64 or a `data:` URL. The response is `{ "status": "saved", "id": … }` or `{ "status": "duplicate" }`.
