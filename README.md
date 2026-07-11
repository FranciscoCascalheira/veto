# Veto

**The pre-trade gate that argues back.**

Paste your investment thesis. Veto structures it into a trade card, decomposes it into falsifiable premises, verifies each one against fresh sources, runs the bear case — and refuses to bless weak cards.

Trading journals analyze your trades after the fact. Veto attacks them **before you buy** — because the cheapest loss is the one you never take.

## How it works

1. **Structure** — your freeform thesis becomes a trade card: ticker, direction, horizon, and the falsifiable premises your argument actually depends on.
2. **Verify** — every premise is checked against fresh web sources and classified: `CONFIRMED` / `PARTIAL` / `FALSE` / `UNVERIFIABLE`. "Confirmed from memory" doesn't exist at this desk.
3. **Attack** — the adversarial sweep runs even when premises hold: strongest bear case, insider selling, dilution, short interest, valuation, and whether your catalyst is already priced in.
4. **Verdict** — `BLESSED` or `REFUSED`. A false load-bearing premise is an automatic refusal. When in doubt, it refuses.

## What it is not

Veto judges **the argument, never the asset**. It produces no buy/sell/hold opinions, no price targets, no recommendations. A refused card means "this argument doesn't survive scrutiny," not "this stock will fall." Nothing here is investment advice.

## Run it

```bash
pnpm install
cp .env.example .env.local   # optional — only needed for the server-key free tier
pnpm dev
```

Open http://localhost:3000, paste a thesis, paste your Anthropic API key, submit.

**Bring your own key.** Your key is sent per-request in a header, used server-side for that request only, and never stored or logged. Alternatively, set `ANTHROPIC_API_KEY` in the environment to offer visitors a limited number of free runs per day (`FREE_RUNS_PER_DAY`, default 3).

Built with Next.js and the Claude API (`claude-opus-4-8` with server-side web search and web fetch). One review makes a handful of model calls and up to ~13 web operations; with your own key, expect a cost in the tens of cents per review.

## Origin

Veto is the productized core of a personal investment operating system: written trade cards, premise verification against second sources, and default-to-protection rules — run with real money, losses included. The engine's central rule exists because three of my own confidently-stated premises turned out to be false when actually checked. This tool is that lesson, automated.

## Roadmap

Only if people actually want it: append-only trade ledger, process scoreboard (measure the process, not the picks), level-watch alerts ("your invalidation fired — write the verdict"), broker CSV import, hosted version.

## License

MIT
