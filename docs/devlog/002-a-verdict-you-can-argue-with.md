# 002 — a verdict you can argue with

The first version of Veto did one thing: it read a thesis, checked the
premises, and said BLESSED or REFUSED. That was the whole point, and it worked.
But a verdict you can't push back on is just an oracle, and I don't trust
oracles with my own money. If the desk tells me my trade is refused, my next
question is always the same — "based on what, and what if you're wrong?" v2 and
v3 are me answering that question in code.

**Argue back.** The obvious gap first. If Veto refuses a card because a source
looked stale, I want to say "the 8-K was filed this morning, look again" and
have it actually look. So now there's a reply box under every verdict. You
bring a new fact; the desk treats it as a claim to verify, not an instruction
to obey. It re-searches, and it either amends the verdict on the evidence or
holds and tells you why. Insistence changes nothing. The conversation lives in
your browser tab and rides back to the API with each round, so there's no
database and no account — the desk just remembers the argument as long as you
keep the tab open. The demo ships with a canned round where the trader pushes
back with a real, approved budget line, and the desk grants that it's real and
still refuses, because a funded program is not a signed contract. That's the
behavior I wanted: gives ground to facts, none to pressure.

**The desk attacks its own blessing.** This is the change I care about most. An
AI reviewer's real failure mode isn't being wrong now and then — it's being
confidently wrong with a clean-looking rationale. A REFUSED card is cheap to be
right about; a BLESSED card is where the damage lives. So a preliminary
blessing no longer ships. The desk logs it, then turns on it: assume the thesis
fails within its horizon, go hunt for the disconfirming evidence you'd have
found if you'd tried, and only then deliver a verdict — the blessing upheld, or
withdrawn into a refusal that names what the second look surfaced. Refusals
still ship untouched, so the extra cost only lands on the cards about to get a
yes. A blessing that survived an attack is worth more than one that was never
attacked.

**The desk interrogates first.** The opposite end of the same problem. Some
theses aren't wrong, they're empty — "long NVDA, feels like it keeps going." You
can't honestly review that, and pretending to would be worse than useless. So
before structuring, a cheap intake pass decides whether the argument is
checkable at all. If it isn't — no identifiable security, or no real reason —
the desk asks two or three pointed questions across the counter (what's the
catalyst and where's it documented, over what timeframe, what would prove you
wrong) and folds your answers back in. Or you tell it to review the thing as
written, and it does. It asks to make the argument falsifiable, never to talk
you toward an answer.

**Durability, without accounts.** A verdict you forget isn't worth much either.
Reviews now persist in the browser — reopen an old one, contest it again, or
work through the open invalidations: every verdict names the one condition that
should kill the trade, and re-checking whether it fired is a click, or all of
them at once. You can export a review as markdown for your own journal, or pull
the verdict as a PNG card. Everything stays local; the backup is a JSON file
you own. No sign-up appears anywhere in the app, and it never will.

The through-line across all of it: make the verdict accountable. Contestable,
so you can fight it with a fact. Durable, so it survives past the moment. And
self-doubting, so a blessing has to earn its way past the desk's own attack
before it reaches you. None of this changed what Veto refuses to be — it still
judges your argument and never the asset, produces no targets and no advice,
and the prompts are all in the open repo so you can read exactly what the desk
believes. It just got a lot harder to talk into a bad yes.
