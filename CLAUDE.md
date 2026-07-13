# CLAUDE.md — veto

Adversarial pre-trade review app: the user pastes an investment thesis, the
engine structures it into a trade card, verifies every premise against fresh
sources, runs a bear-case sweep, and returns BLESSED or REFUSED. The
personality — a desk that refuses to bless weak cards — is the product.

**Project goal (owner: Francisco):** a genuinely useful tool and a strong
CV/portfolio piece. Monetization is a possible future, not a driver — do not
optimize for it, and do not gate work on anything outside this repo.

## Stack

Next.js 16 (App Router, TypeScript, Tailwind v4) + `@anthropic-ai/sdk`.
Package manager: **pnpm 11** (pinned via `packageManager`; Node 22.x pinned in
`engines` — Railway's default toolchain breaks on anything older).
Model: `claude-opus-4-8` with server-side `web_search_20260209` +
`web_fetch_20260209` and a strict `submit_verdict` tool.

## Commands

- `pnpm dev` — dev server (Turbopack)
- `pnpm build` — production build + typecheck (run before every commit)

## Deploy (Railway)

- Live: **https://veto-production.up.railway.app** — public URL, treat as
  internet-facing (it is scanned; "nobody knows the link" is false).
- Project `veto` on Francisco's Railway workspace; CLI is authenticated —
  `railway up --detach` from the repo root deploys; `railway logs --build`
  for build logs.
- Env vars (see `.env.example`): `ANTHROPIC_API_KEY` (set by Francisco in the
  Railway dashboard only — never via chat/CLI/commit), `FRIENDS_CODE` (gates
  keyless runs), `FREE_RUNS_PER_DAY` (per IP), `FREE_RUNS_GLOBAL_PER_DAY`
  (global daily cost ceiling).
- GitHub: `FranciscoCascalheira/veto` (public). Commit + push every finished
  increment; commit messages end with the Claude co-author line.

## Architecture

- `lib/types.ts` — domain types (`TradeCard`, `Verdict`) + `EngineEvent` union
  shared by engine, route, and UI.
- `lib/prompts.ts` — the desk's system prompts. Prompt edits change the
  product; keep the desk rules (refusal conditions) intact.
- `lib/engine.ts` — two-stage pipeline as an async generator taking an
  injected `Anthropic` client: structure (structured output via
  `output_config.format`) → verify/attack (streaming manual loop; handles
  `pause_turn`; verdict arrives via the strict `submit_verdict` tool call).
- `lib/demo.ts` — canned sample review (fictional ticker Halcyon/HLCN) that
  streams without an API key.
- `app/api/refute/route.ts` — SSE endpoint. BYOK via `x-anthropic-api-key`
  header; keyless path = FRIENDS_CODE gate → global daily cap → per-IP cap.
- `app/page.tsx` — single-page UI reading the SSE stream.

## Roadmap — v2 (decided 2026-07-13, in priority order)

1. **Clickable sources.** Capture `web_search_tool_result` /
   `web_fetch_tool_result` blocks and text citations in the engine loop
   (currently discarded), thread them through `EngineEvent`, and render real
   source links under each premise verdict and the bear case. Trust is the
   product's own ethos applied to itself.
2. **Argue-back.** A reply box under the verdict: the user contests with a
   new fact, the desk re-searches and defends or amends (verdict may flip).
   Client-held conversation continuation — no DB. The signature feature.
3. **Local history.** Reviews persisted in localStorage: list, reopen, and an
   "open invalidations" panel (blessed/refused cards with their
   `suggested_invalidation` and a re-check affordance). No accounts.
4. **Export.** Copy-as-markdown + download-verdict-as-PNG. Shareable artifact.

Out of scope until further notice: accounts, databases, broker integrations,
payments, effort tiers.

## Hard rules

- **Regulatory posture (load-bearing):** verdicts are about the user's
  ARGUMENT, never the security. No buy/sell/hold language, price targets, or
  recommendations anywhere — prompts, UI copy, README. Never weaken the
  disclaimer in `app/page.tsx`.
- Never log or persist API keys or user theses server-side. Secrets never
  enter the repo, the chat transcript, or CLI history — dashboard only.
- UI is English, no emojis, warm dark palette (tokens in `app/globals.css`),
  restrained premium-utilitarian look. No neon, no purple gradients, no
  placeholder names (ACME et al.). Muted text is never opacity-dimmed further
  (WCAG — this was a real review finding).
- Content and code in English; chat with Francisco in Portuguese.

## Definition of done (every increment)

1. `pnpm build` green.
2. Exercised in a real browser via the chrome-devtools MCP (run the affected
   flow — the demo covers the full pipeline; check console + failed requests).
3. Design self-check against the rules above; run the `design-reviewer` agent
   after substantial UI changes.
4. README/screenshot updated if user-visible behavior changed.
5. Committed and pushed. Deployed via `railway up --detach` when it should go
   live; verify the live URL after.
