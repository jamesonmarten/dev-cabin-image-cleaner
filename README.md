# Dev Cabin Image Cleaner

Two modes are supported:

- **Local (offline)**: open `image_processor_ui.local.html` directly in a browser. Processing happens entirely in-browser. No network requests are required.
- **Online**: run the tiny server in `server/` and open the hosted UI. This supports loading external CDN libraries, and provides a clean URL to share.

## Local (offline) UI

Open:

- `image_processor_ui.local.html`

Notes:
- No external scripts are loaded.
- Uses built-in browser APIs only.

## Online UI

1. Start the server.
2. Visit the printed URL.

Notes:
- Online UI can optionally use CDNs (JSZip/exifr) for best feature coverage.

## Project layout

- `ui/` – shared UI assets (CSS/JS) used by both builds.
- `server/` – tiny static server for the online build.

