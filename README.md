# Codevo Whisper

Dictation for the desktop: hold a hotkey, speak, release, and the transcript is inserted at the cursor. Transcription runs locally on the Mac (phase 1) or on your own server (phase 2).

Design: `docs/specs/2026-10-25-codevo-whisper-design.md`. UI reference: `docs/design/mockup.html`.

## Layout

- `apps/desktop` - Electron app (main process in TypeScript, React renderer built with electron-vite)
- `apps/*`, `packages/*`, `tools/*` - pnpm workspace members
- `spikes/` - throwaway phase 0 prototypes, not part of the workspace

## Requirements

- Node 24 (`.nvmrc`), pnpm 10.34.5
- macOS 13+ for the desktop app

## Scripts

From the repository root:

- `pnpm install`
- `pnpm lint` - ESLint over the workspace
- `pnpm typecheck` - TypeScript for every workspace member
- `pnpm test` - Vitest for every workspace member
- `pnpm --filter @codevo-whisper/desktop dev` - run the desktop app with hot reload
- `pnpm --filter @codevo-whisper/desktop test:e2e` - build the desktop app and run the Playwright Electron tests

If your shell exports `ELECTRON_RUN_AS_NODE`, Electron starts as plain Node. The `dev` and `test:e2e` scripts unset it; unset it yourself when you launch Electron any other way.
