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
- `lib/history.ts` — localStorage persistence of finished reviews (no
  accounts; transcripts shed oldest-first under quota pressure).
- `lib/export.ts` — copy-as-Markdown serializer + canvas-drawn verdict PNG
  (reads design tokens and font stacks from the live document).
- `app/api/refute/route.ts` — SSE endpoint. BYOK via `x-anthropic-api-key`
  header; keyless path = FRIENDS_CODE gate → global daily cap → per-IP cap.
- `app/page.tsx` — single-page UI reading the SSE stream.

## Roadmap — v2 (decided 2026-07-13; all four SHIPPED 2026-07-13)

1. **Clickable sources** — shipped (`68eda86`). Real source links under each
   premise verdict and the bear case.
2. **Argue-back** — shipped (`28b9533`). Contest the verdict; the desk
   re-searches and defends or amends. Client-held transcript, no DB.
3. **Local history** — shipped (`4dd7179`). localStorage reviews: reopen
   (still contestable), open-invalidations panel with one-click re-check,
   transcripts shed oldest-first under quota pressure.
4. **Export** — shipped. Copy-as-Markdown + verdict PNG drawn on canvas from
   the live design tokens; artifacts carry date, sample marker, disclaimer.

## Roadmap — v3 (decided 2026-07-13, in priority order)

1. **Blessing under fire** — shipped. A preliminary BLESSED is logged, not
   delivered: the desk attacks it once in the same verify loop (streamed to
   the feed) and the blessing is upheld or withdrawn on evidence. Refusals
   ship untouched; forced-final submissions are never reopened. Outcome rides
   `EngineEvent{t:"stress"}`, history, and both export artifacts.
2. **Launch readiness** — shipped. og:image + twitter card (static
   `app/opengraph-image.png`/`twitter-image.png`, metadataBase in the layout);
   history backup/import as a versioned JSON file, merge-by-id, restorable
   into a cleared browser (keeps the no-accounts stance).
3. **Launch pack.** Publish devlog 001, write devlog 002 (the v2/v3 story),
   draft Show HN / fintwit / LinkedIn posts. Francisco does the posting.
4. **The desk interrogates first** — shipped. A thesis too thin to review (no
   identifiable security, or no checkable reason) gets a cheap intake pass
   (`runIntake`, no web tools) that asks 2-3 questions via `EngineEvent
   {t:"questions"}`; the trader answers (folded into the thesis) or reviews as
   written. `answers` on the request signals "past intake" so the second pass
   skips it. No new history entry; the original thesis is what's stored.
5. **Re-check all** — shipped. Batch re-check of every contestable open
   invalidation, each a full argue round run headless into a private
   accumulator then written to history; sequential, behind an explicit confirm
   with a cost note. Shed-transcript invalidations are skipped and counted.

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
