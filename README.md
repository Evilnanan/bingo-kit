# BingoKit

A real-time multiplayer Bingo app.

**English** | [中文](./README.zh-CN.md)

## Features

- **Two board types** — Classic 5×5 board + [Hex (Connect-6)](https://en.wikipedia.org/wiki/Hex_(board_game)) board
- **Goal editor** — Visual editing with JSON/CSV import & export; supports tooltip, counters, difficulty levels, and exclusion groups
- **4 shuffle algorithms**
  - Pure random (ignores difficulty, but still respects exclusion groups)
  - Balanced difficulty (minimizes difficulty variance across each line)
  - Same distribution (each line has the same difficulty distribution)
  - Fixed (takes the first 25 goals from the pool in order)
- **Multiplayer sync** — Powered by [PartyKit](https://docs.partykit.io/)
- **i18n** — Chinese and English
- **Dark mode** — Follows system preference or manual toggle
- **Custom scoring** — Rule-based engine with an expression language for scoring cells and bingo lines. Includes a visual rule editor.
- **Mobile-friendly** — Optimized for small screens

## OBS Custom CSS

```css
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC&display=swap');

:root {
  --cell-font-scale: 1.3;                          /* Scale goal text (default: 1) */
  --sans: "Noto Sans SC", system-ui, sans-serif;    /* Custom font */
}

/* Hide UI elements (prefix with .square or .hex to target only one board) */
.counter { display: none !important; }    /* Counter badge */
.tooltip { display: none !important; }    /* Tooltip trigger */
.star    { display: none !important; }    /* Star mark */
```

## Development

```bash
# Install dependencies
npm install

# Start frontend dev server
npm run dev

# Start PartyKit dev server (WebSocket backend, required for multiplayer)
npm run dev:party

# Type-check
npm run typecheck

# Lint
npm run lint

# Format (prettier)
npm run format

# Preview production build
npm run build
npm run preview

# Deploy to GitHub Pages (uses /bingo-kit/ base path)
npm run deploy
```

## License

MIT License
