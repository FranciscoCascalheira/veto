# Launch posts — drafts

Ready-to-post drafts for when you decide to share Veto. Nothing here posts
itself; edit the voice to yours before it goes out. The live URL is
https://veto-production.up.railway.app and the repo is
https://github.com/FranciscoCascalheira/veto.

A few practical notes:
- The demo runs with no API key, so anyone clicking the link sees the full
  pipeline (a refused sample) without signing up for anything. Lead with that —
  it's the lowest-friction proof.
- For Show HN, weekday mornings US-Eastern tend to get more eyes; post from your
  own account and reply to early comments.
- Keep the "it's not advice, it judges the argument" line in every version. It's
  the honest framing and it pre-empts the first objection.

---

## Show HN

**Title:**
Show HN: Veto – an AI desk that refuses to approve your trade thesis

**Body:**
I kept losing money on trades where the post-mortem was embarrassing: a premise
I was sure about turned out to be false the moment I actually checked it. "The
CEO bought shares" — he hadn't. A catalyst date from an aggregator — wrong. Good
analysis built on an unchecked fact.

So I built the check into a tool. You paste a thesis in plain words. Veto breaks
it into falsifiable premises, verifies each against fresh web sources (primary
documents for the load-bearing ones), runs a bear-case sweep, and returns
BLESSED or REFUSED. A false load-bearing premise is an automatic refusal. When
it's unsure, it refuses.

Two things it deliberately isn't. It's not advice — it judges the argument you
wrote, never the asset, so no price targets and no buy/sell. And it's not a
journal — journals analyze trades after the fact; this argues with them before
you buy.

A few things I added since the first version that I think are the interesting
part:
- You can argue back. Bring a new fact and it re-searches, then amends or holds
  on the evidence. It gives ground to facts and none to insistence.
- Before it blesses a card, it attacks its own verdict once — hunts the
  disconfirming evidence you'd have found if you'd tried — and only then ships
  the blessing or withdraws it.
- If a thesis is too thin to review honestly, it asks you two or three questions
  first instead of pretending.

Open source, and the prompts are the product — you can read exactly what the
desk's rules are. There's a live demo that runs the full pipeline with no key;
for a real review, bring your own Anthropic key (a review costs tens of cents).

Live: https://veto-production.up.railway.app
Code: https://github.com/FranciscoCascalheira/veto

Happy to hear where it's wrong — especially cases where it blesses something it
shouldn't.

---

## X / fintwit

**Single post:**
I built a tool that refuses to approve my trades.

Paste a thesis. It breaks it into falsifiable premises, checks each against
fresh sources, runs the bear case, and returns BLESSED or REFUSED. A false
load-bearing premise is an automatic no.

It judges your argument, never the asset. Live demo, no signup:
https://veto-production.up.railway.app

**Thread version:**

1/ Most of my worst trades weren't bad analysis. They were good analysis built
on a fact I never checked. "The CEO bought shares" — he hadn't. I paid retail
for being sloppy about facts.

2/ So I built a desk that won't let me skip the check. Paste a thesis → it
structures it into falsifiable premises → verifies each against fresh web
sources → runs a bear-case sweep → BLESSED or REFUSED. False load-bearing
premise = automatic refusal.

3/ The part I like: before it blesses anything, it attacks its own verdict.
Assume the trade fails, go find the evidence you'd have found if you'd looked,
then decide. A blessing that survived an attack is worth more than one that was
never attacked.

4/ You can also argue back. Bring a new fact and it re-searches, then amends or
holds — on evidence, never on insistence. And it never gives you a price target
or a buy/sell. It reviews your argument, not the stock.

5/ Open source, prompts included (they're the actual product). Live demo runs
the whole thing with no API key:
https://veto-production.up.railway.app
Code: https://github.com/FranciscoCascalheira/veto

---

## LinkedIn

I spent the last stretch building something for myself and then couldn't stop,
so I'm sharing it: Veto, a pre-trade review tool that argues with your
investment thesis before you act on it.

The origin is unglamorous. Running my own small portfolio, I noticed my worst
outcomes weren't from bad reasoning — they were from good reasoning resting on a
fact I'd never actually verified. So I automated the discipline I kept skipping.
You describe a trade in plain language; the tool decomposes it into falsifiable
premises, checks each against fresh sources, runs an adversarial sweep for the
things that quietly sink a thesis, and returns a clear verdict with its
reasoning shown.

What made it genuinely interesting to build was designing for the failure mode
of an AI reviewer, which isn't being occasionally wrong — it's being
confidently wrong. So the desk attacks its own positive verdicts before
delivering them, asks clarifying questions when a thesis is too thin to review
honestly, and lets you contest any verdict with a new fact and watch it
re-check. It's careful, by design, to review the argument and never to give
investment advice.

Technically it's Next.js and the Claude API with server-side web search, built
in the open — the prompts that define the desk's judgment are all readable in
the repo. There's a live demo that runs the full pipeline without any setup.

Live: https://veto-production.up.railway.app
Code: https://github.com/FranciscoCascalheira/veto

Would genuinely value feedback from anyone who reviews investment cases for a
living — especially on where the desk's rules are too strict or too soft.
