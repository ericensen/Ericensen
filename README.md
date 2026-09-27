# Ericensen Home

A static personal homepage and app hub built for GitHub Pages.

## Apps

- **NameHat**: a voice-friendly replacement for drawing names from paper slips.
- **FaceCards**: spaced celebrity-face practice with 1,000 locally hosted Wikimedia portraits.
- **Tasha Trivia**: a shared birthday quiz backed by Google Apps Script.
- **Eco Lab**: a tunable predator, herbivore, and plant simulation.
- **Star Hopper**: an original retro platform game.
- **Block Stack**: a simple Tetris-style canvas game.

## Run locally

```bash
npm run dev
```

Then open `http://localhost:4173/`.

## Refresh the FaceCards catalog

```bash
npm run catalog:celebrities
```

The catalog builder uses Wikimedia page-view data and Commons image metadata. It keeps only
humans with reusable portraits and excludes people known to have died before 1900.

## Add another app

Add a route section in `index.html`, add a route entry and app card in `app.js`,
and link it from the top navigation.
