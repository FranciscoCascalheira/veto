# 001 — I built a machine that refuses to approve my trades

This year I lost money on trades where the post-mortem was embarrassing. Not
"the market moved against me" embarrassing — worse. In three separate cases, a
premise I was sure about turned out to be false the moment I actually checked
it. "The CEO bought shares" — he hadn't. "The FDA decision is blocked" — it
wasn't. A catalyst date I'd taken from an aggregator — wrong. I wasn't
outsmarted. I was sloppy about facts, and I paid retail price for it.

So I added a rule to the personal trading system I run with an LLM in the
loop: **no order goes in until every load-bearing claim in the thesis has been
verified against a fresh second source.** The reviewer refuses to bless the
trade otherwise. That one rule has killed more bad trades than any indicator I
ever used, because most of my bad trades weren't bad analysis — they were good
analysis built on an unchecked fact.

Veto is that rule, extracted and automated.

You paste your thesis in plain words. Veto structures it into a trade card,
decomposes it into falsifiable premises, and then does what you were supposed
to do and didn't: it verifies each premise against fresh sources (live web
search, primary documents for the load-bearing ones), classifies each as
CONFIRMED / PARTIAL / FALSE / UNVERIFIABLE, runs the bear-case sweep — insider
selling, dilution, short interest, is-the-catalyst-already-priced-in — and
returns a verdict: **BLESSED** or **REFUSED**. A false load-bearing premise is
an automatic refusal. When in doubt, it refuses. The trader loses nothing by
waiting; they lose money by acting on a broken card.

Two things Veto deliberately is not. It is not advice: it judges the argument
you wrote, never the asset — no targets, no buy/sell, no opinions about where
the price goes. And it is not a journal: journals analyze your trades after
the fact; Veto argues with them before you buy.

The whole thing is open source — the prompts are the product, and you can read
exactly what the desk's rules are. Bring your own Anthropic API key; a review
costs tens of cents and takes a few minutes, which is a fair price for an
argument you should have had with yourself.

Next: nothing, unless people actually use it. If refusals start saving other
people's money too, there's a longer roadmap (ledger, process scoreboard,
level-watch alerts). The repo is the pitch.
