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
- **Multiplayer sync** — Powered by [PartyServer](https://github.com/cloudflare/partykit/blob/main/packages/partyserver/README.md) (Cloudflare Durable Objects)
- **i18n** — Chinese and English
- **Dark mode** — Follows system preference or manual toggle
- **Custom scoring** — Rule-based engine with an expression language for scoring cells and bingo lines. Includes a visual rule editor.
- **Mobile-friendly** — Optimized for small screens

## Development

```bash
# Install dependencies
npm install

# Start frontend dev server
npm run dev

# Start PartyServer dev server via wrangler (WebSocket backend, required for multiplayer)
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
