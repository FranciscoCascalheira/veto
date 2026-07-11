# CLAUDE.md — veto

Adversarial pre-trade review app: the user pastes an investment thesis, the
engine structures it into a trade card, verifies every premise against fresh
sources, runs a bear-case sweep, and returns BLESSED or REFUSED. The
personality — a desk that refuses to bless weak cards — is the product.

## Stack

Next.js 16 (App Router, TypeScript, Tailwind v4) + `@anthropic-ai/sdk`.
Package manager: **pnpm**. Model: `claude-opus-4-8` with server-side
`web_search_20260209` + `web_fetch_20260209` and a strict `submit_verdict`
tool.

## Commands

- `pnpm dev` — dev server (Turbopack)
- `pnpm build` — production build + typecheck

## Architecture

- `lib/types.ts` — domain types (`TradeCard`, `Verdict`) + `EngineEvent` union
  shared by engine, route, and UI.
- `lib/prompts.ts` — the desk's system prompts. Prompt edits change the
  product; keep the desk rules (refusal conditions) intact.
- `lib/engine.ts` — two-stage pipeline as an async generator: structure
  (structured output via `output_config.format`) → verify/attack (streaming
  manual loop; handles `pause_turn`; verdict arrives via the strict
  `submit_verdict` tool call).
- `app/api/refute/route.ts` — SSE endpoint. BYOK via `x-anthropic-api-key`
  header; optional server key with per-IP daily free-run limit (in-memory).
- `app/page.tsx` — single-page UI reading the SSE stream.

## Hard rules

- **Regulatory posture (load-bearing):** verdicts are about the user's
  ARGUMENT, never the security. No buy/sell/hold language, price targets, or
  recommendations anywhere — prompts, UI copy, README. Never weaken the
  disclaimer in `app/page.tsx`.
- Never log or persist API keys or user theses.
- UI is English, no emojis, warm dark palette (tokens in `app/globals.css`),
  restrained premium-utilitarian look. No neon, no purple gradients.
- Content and code in English.
