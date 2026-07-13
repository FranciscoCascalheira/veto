"use client";

import { useEffect, useRef, useState } from "react";
import type {
  EngineEvent,
  FinalVerdict,
  PremiseState,
  SourceRef,
  TradeCard,
  Verdict,
} from "@/lib/types";
import {
  closeInvalidation,
  deleteReview,
  loadHistory,
  newReviewId,
  upsertReview,
  type FeedItem,
  type StoredReview,
} from "@/lib/history";

type Status = "idle" | "structuring" | "verifying" | "done" | "error";

// Every replay of the sample review lands on this one history entry, so it
// never piles up duplicates. The re-check prefill matches the canned
// argue-back round the demo answers with.
const DEMO_HISTORY_ID = "demo-sample";
const DEMO_RECHECK_CHALLENGE =
  "The Army's FY2027 budget line funding this program was approved last week — the LOI is as good as signed.";

// Mutable mirror of the review currently on screen. handleEvent runs inside
// the streaming loop where React state reads would be stale, so the data a
// finished round persists to history is accumulated here.
type ActiveReview = {
  id: string;
  createdAt: number;
  demo: boolean;
  thesis: string;
  card: TradeCard | null;
  feed: FeedItem[];
  sources: SourceRef[];
  verdictHistory: FinalVerdict[];
  verdict: Verdict | null;
  transcript: unknown[] | null;
};

function appendFeed(prev: FeedItem[], item: FeedItem): FeedItem[] {
  const last = prev[prev.length - 1];
  if (item.kind === "text" && last?.kind === "text") {
    return [...prev.slice(0, -1), { kind: "text", text: last.text + item.text }];
  }
  return [...prev, item];
}

const PLACEHOLDER = `Example: Buying CRWV around $87. CoreWeave signed a multi-billion dollar capacity deal with Meta, analyst targets sit well above $130, and AI compute demand keeps outrunning supply. Expecting +40% in 3-6 months. I'd get out below $78.`;

const PREMISE_BADGE: Record<PremiseState, string> = {
  CONFIRMED: "text-blessed border-blessed/40",
  PARTIAL: "text-accent border-accent/40",
  FALSE: "text-refused border-refused/50",
  UNVERIFIABLE: "text-muted border-edge",
};

export default function Home() {
  const [thesis, setThesis] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [card, setCard] = useState<TradeCard | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [sources, setSources] = useState<SourceRef[]>([]);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [verdictHistory, setVerdictHistory] = useState<Verdict["verdict"][]>([]);
  const [transcript, setTranscript] = useState<unknown[] | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [challenge, setChallenge] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<StoredReview[]>([]);
  const resultRef = useRef<HTMLDivElement>(null);
  const argueRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<ActiveReview | null>(null);

  useEffect(() => {
    const savedKey = localStorage.getItem("veto-api-key");
    if (savedKey) setApiKey(savedKey);
    const savedCode = localStorage.getItem("veto-access-code");
    if (savedCode) setCode(savedCode);
    setHistory(loadHistory());
  }, []);

  function saveKey(value: string) {
    setApiKey(value);
    if (value) localStorage.setItem("veto-api-key", value);
    else localStorage.removeItem("veto-api-key");
  }

  function saveCode(value: string) {
    setCode(value);
    if (value) localStorage.setItem("veto-access-code", value);
    else localStorage.removeItem("veto-access-code");
  }

  function handleEvent(event: EngineEvent) {
    const active = activeRef.current;
    switch (event.t) {
      case "stage":
        if (event.v === "structuring") setStatus("structuring");
        if (event.v === "verifying") setStatus("verifying");
        break;
      case "card":
        setCard(event.v);
        if (active) active.card = event.v;
        break;
      case "text":
        setFeed((prev) => appendFeed(prev, { kind: "text", text: event.v }));
        if (active) active.feed = appendFeed(active.feed, { kind: "text", text: event.v });
        break;
      case "search":
        setFeed((prev) => appendFeed(prev, { kind: "search", query: event.v }));
        if (active) active.feed = appendFeed(active.feed, { kind: "search", query: event.v });
        break;
      case "fetch":
        setFeed((prev) => appendFeed(prev, { kind: "fetch", url: event.v }));
        if (active) active.feed = appendFeed(active.feed, { kind: "fetch", url: event.v });
        break;
      case "sources":
        setSources(event.v);
        if (active) active.sources = event.v;
        break;
      case "verdict":
        setVerdict(event.v);
        setVerdictHistory((prev) => [...prev, event.v.verdict]);
        setStatus("done");
        if (active) {
          active.verdict = event.v;
          active.verdictHistory = [...active.verdictHistory, event.v.verdict];
        }
        break;
      case "transcript":
        setTranscript(event.v);
        if (active) active.transcript = event.v;
        break;
      case "error":
        setError(event.v);
        setStatus("error");
        break;
      case "done":
        // A round is history-worthy only once it produced a verdict.
        if (active && active.card && active.verdict) {
          setHistory(
            upsertReview({
              id: active.id,
              createdAt: active.createdAt,
              updatedAt: Date.now(),
              demo: active.demo,
              thesis: active.thesis,
              card: active.card,
              verdict: active.verdict,
              verdictHistory: active.verdictHistory,
              sources: active.sources,
              feed: active.feed,
              transcript: active.transcript,
              invalidationClosed: false,
            }),
          );
        }
        break;
    }
  }

  async function streamReview(payload: Record<string, unknown>, withKey: boolean) {
    const res = await fetch("/api/refute", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(withKey && apiKey ? { "x-anthropic-api-key": apiKey } : {}),
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(data?.error ?? `Request failed (${res.status}).`);
    }
    if (!res.body) throw new Error("No response stream.");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith("data: ")) continue;
        handleEvent(JSON.parse(line.slice(6)) as EngineEvent);
      }
    }
  }

  async function run(demo = false) {
    if (status === "structuring" || status === "verifying") return;
    activeRef.current = {
      id: demo ? DEMO_HISTORY_ID : newReviewId(),
      createdAt: Date.now(),
      demo,
      thesis: demo ? "" : thesis,
      card: null,
      feed: [],
      sources: [],
      verdictHistory: [],
      verdict: null,
      transcript: null,
    };
    setCard(null);
    setFeed([]);
    setSources([]);
    setVerdict(null);
    setVerdictHistory([]);
    setTranscript(null);
    setIsDemo(demo);
    setChallenge("");
    setError(null);
    setStatus("structuring");
    resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

    try {
      await streamReview(demo ? { demo: true } : { thesis, code }, !demo);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error.");
      setStatus("error");
    }
  }

  async function argue() {
    const text = challenge.trim();
    if (status === "structuring" || status === "verifying") return;
    if (text.length < 10 || (!isDemo && !transcript)) return;
    setError(null);
    setStatus("verifying");
    setFeed((prev) => appendFeed(prev, { kind: "challenge", text }));
    if (activeRef.current) {
      activeRef.current.feed = appendFeed(activeRef.current.feed, { kind: "challenge", text });
    }

    try {
      await streamReview(
        isDemo ? { demo: true, challenge: text } : { challenge: text, transcript, code },
        !isDemo,
      );
      setChallenge("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error.");
      setStatus("error");
    }
  }

  // Restore a stored review to the screen exactly as it finished, including
  // the client-held transcript so it can be contested further.
  function reopen(entry: StoredReview, scroll = true) {
    if (status === "structuring" || status === "verifying") return;
    activeRef.current = {
      id: entry.id,
      createdAt: entry.createdAt,
      demo: entry.demo,
      thesis: entry.thesis,
      card: entry.card,
      feed: entry.feed,
      sources: entry.sources,
      verdictHistory: [...entry.verdictHistory],
      verdict: entry.verdict,
      transcript: entry.transcript,
    };
    if (entry.thesis) setThesis(entry.thesis);
    setCard(entry.card);
    setFeed(entry.feed);
    setSources(entry.sources);
    setVerdict(entry.verdict);
    setVerdictHistory(entry.verdictHistory);
    setTranscript(entry.transcript);
    setIsDemo(entry.demo);
    setChallenge("");
    setError(null);
    setStatus("done");
    if (scroll) resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function recheck(entry: StoredReview) {
    if (status === "structuring" || status === "verifying") return;
    const contestable = entry.demo || entry.transcript !== null;
    reopen(entry, false);
    if (contestable) {
      setChallenge(
        entry.demo
          ? DEMO_RECHECK_CHALLENGE
          : `Time check on the invalidation this review set: "${entry.verdict.suggested_invalidation}" — has it triggered since? Verify against fresh sources as of today and update the verdict.`,
      );
      setTimeout(() => {
        argueRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 80);
    } else {
      // The stored conversation was shed for space; the original thesis is
      // back in the box for a fresh full review.
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function removeEntry(id: string) {
    setHistory(deleteReview(id));
  }

  function markClosed(id: string) {
    setHistory(closeInvalidation(id));
  }

  const running = status === "structuring" || status === "verifying";
  const openInvalidations = history.filter((entry) => !entry.invalidationClosed);
  const verdictFor = (id: string): PremiseState | null =>
    verdict?.premise_verdicts.find((p) => p.id === id)?.verdict ?? null;
  const evidenceFor = (id: string): string | null =>
    verdict?.premise_verdicts.find((p) => p.id === id)?.evidence ?? null;
  const sourcesFor = (id: string): string[] =>
    verdict?.premise_verdicts.find((p) => p.id === id)?.source_urls ?? [];
  const sourceTitle = (url: string): string | null =>
    sources.find((s) => s.url === url)?.title ?? null;

  return (
    <div className="mx-auto w-full max-w-2xl px-5 pb-24 pt-16">
      <header className="mb-12">
        <h1 className="font-mono text-2xl font-semibold tracking-[0.35em] text-foreground">
          VETO
        </h1>
        <p className="mt-2 text-sm text-muted">
          The pre-trade gate that argues back. Paste your thesis — Veto breaks it
          into falsifiable premises, checks each against fresh sources, runs the
          bear case, and refuses to bless weak cards.
        </p>
      </header>

      <section className="rounded-lg border border-edge bg-surface p-4">
        <textarea
          name="thesis"
          value={thesis}
          onChange={(e) => setThesis(e.target.value)}
          placeholder={PLACEHOLDER}
          rows={6}
          className="w-full resize-y rounded-md border border-edge bg-surface-2 p-3 text-sm leading-relaxed text-foreground placeholder:text-muted focus:border-accent/60 focus:outline-none"
        />
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => saveKey(e.target.value)}
            placeholder="sk-ant-… (your Anthropic API key)"
            className="flex-1 rounded-md border border-edge bg-surface-2 px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted focus:border-accent/60 focus:outline-none"
          />
          <input
            type="text"
            value={code}
            onChange={(e) => saveCode(e.target.value)}
            placeholder="access code"
            className="rounded-md border border-edge bg-surface-2 px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted focus:border-accent/60 focus:outline-none sm:w-36"
          />
          <button
            onClick={() => run()}
            disabled={running || thesis.trim().length < 20}
            className="rounded-md bg-accent px-5 py-2 text-sm font-medium text-background transition-colors duration-150 hover:bg-accent/90 disabled:opacity-40"
          >
            {running ? "Under review…" : "Submit for review"}
          </button>
        </div>
        <p className="mt-2 text-xs text-muted">
          Bring your own key (sent with this request only, never stored
          server-side) — or run keyless with an access code, while the day&apos;s
          free-run budget lasts. No key?{" "}
          <button
            onClick={() => run(true)}
            disabled={running}
            className="underline decoration-muted/50 underline-offset-2 transition-colors duration-150 hover:text-foreground disabled:opacity-40"
          >
            Watch a sample review
          </button>
          .
        </p>
      </section>

      <div ref={resultRef}>
        {status !== "idle" && (
          <section className="mt-10 space-y-6">
            <div className="flex items-center gap-3 font-mono text-xs uppercase tracking-widest text-muted">
              <StageDot active={status === "structuring"} done={card !== null} label="Structure" />
              <span aria-hidden className="text-edge">—</span>
              <StageDot active={status === "verifying"} done={verdict !== null} label="Verify + attack" />
              <span aria-hidden className="text-edge">—</span>
              <StageDot active={false} done={verdict !== null} label="Verdict" />
            </div>

            {status === "structuring" && !card && (
              <div className="animate-enter rounded-lg border border-edge bg-surface p-4">
                <div className="skeleton h-5 w-40 rounded" />
                <div className="skeleton mt-4 h-4 w-full rounded" />
                <div className="skeleton mt-2 h-4 w-4/5 rounded" />
                <div className="skeleton mt-2 h-4 w-3/5 rounded" />
              </div>
            )}

            {card && (
              <div className="animate-enter rounded-lg border border-edge bg-surface p-4">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-mono text-lg font-semibold text-foreground">
                    {card.ticker}
                  </span>
                  <span className="text-sm text-muted">{card.company}</span>
                  <span className="font-mono text-xs uppercase tracking-wider text-accent">
                    {card.direction} · {card.horizon}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-foreground/90">
                  {card.thesis_summary}
                </p>
                <ul className="mt-4 space-y-2.5">
                  {card.premises.map((p) => {
                    const state = verdictFor(p.id);
                    const evidence = evidenceFor(p.id);
                    return (
                      <li key={p.id} className="text-sm">
                        <div className="flex items-start gap-3">
                          <span className="mt-0.5 font-mono text-xs text-muted">{p.id}</span>
                          <span className="flex-1 leading-snug text-foreground/90">
                            {p.claim}
                            {p.load_bearing && (
                              <span className="ml-2 font-mono text-[11px] uppercase tracking-wider text-muted">
                                load-bearing
                              </span>
                            )}
                          </span>
                          <span
                            className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wider ${
                              state ? PREMISE_BADGE[state] : "border-edge text-muted"
                            }`}
                          >
                            {state ?? "checking"}
                          </span>
                        </div>
                        {evidence && (
                          <p className="mt-1 pl-8 text-xs leading-snug text-muted">
                            {evidence}
                          </p>
                        )}
                        <SourceLinks
                          urls={sourcesFor(p.id)}
                          titleFor={sourceTitle}
                          className="pl-8"
                        />
                      </li>
                    );
                  })}
                </ul>
                {card.stated_invalidation && (
                  <p className="mt-3 text-xs text-muted">
                    Stated invalidation: {card.stated_invalidation}
                  </p>
                )}
              </div>
            )}

            {feed.length > 0 && (
              <div className="animate-enter rounded-lg border border-edge bg-surface p-4">
                <h2 className="font-mono text-xs uppercase tracking-widest text-muted">
                  Review desk
                </h2>
                <div className="mt-3 space-y-2 text-sm leading-relaxed">
                  {feed.map((item, i) =>
                    item.kind === "text" ? (
                      <p key={i} className="whitespace-pre-wrap text-foreground/85">
                        {item.text}
                      </p>
                    ) : item.kind === "challenge" ? (
                      <p
                        key={i}
                        className="border-l-2 border-accent/50 pl-3 text-foreground/85"
                      >
                        <span className="mr-2 font-mono text-xs uppercase tracking-wider text-accent">
                          challenge
                        </span>
                        {item.text}
                      </p>
                    ) : (
                      <p key={i} className="font-mono text-xs text-muted">
                        <span className="text-accent">
                          {item.kind === "search" ? "search" : "fetch"}
                        </span>{" "}
                        {item.kind === "search" ? item.query : item.url}
                      </p>
                    ),
                  )}
                  {status === "verifying" && (
                    <p className="font-mono text-xs text-muted">working…</p>
                  )}
                </div>
              </div>
            )}

            {verdict && (
              <div
                className={`animate-enter rounded-lg border-2 p-5 ${
                  verdict.verdict === "REFUSED"
                    ? "border-refused/70 bg-refused/5"
                    : "border-blessed/70 bg-blessed/5"
                }`}
              >
                <div
                  className={`font-mono text-3xl font-bold tracking-[0.25em] ${
                    verdict.verdict === "REFUSED" ? "text-refused" : "text-blessed"
                  }`}
                >
                  {verdict.verdict}
                </div>
                {verdictHistory.length > 1 && (
                  <p className="mt-1 font-mono text-xs uppercase tracking-wider text-muted">
                    contested ×{verdictHistory.length - 1} ·{" "}
                    {verdictHistory[verdictHistory.length - 1] ===
                    verdictHistory[verdictHistory.length - 2]
                      ? "verdict upheld"
                      : "verdict overturned"}
                  </p>
                )}
                <p className="mt-3 text-sm leading-relaxed text-foreground/90">
                  {verdict.verdict_reason}
                </p>

                <VerdictSection title="The bear case">
                  <p>{verdict.bear_case}</p>
                  <SourceLinks
                    urls={verdict.bear_case_source_urls ?? []}
                    titleFor={sourceTitle}
                  />
                </VerdictSection>

                {verdict.red_flags.length > 0 && (
                  <VerdictSection title="Red flags">
                    <ul className="list-disc space-y-1 pl-5">
                      {verdict.red_flags.map((flag, i) => (
                        <li key={i}>{flag}</li>
                      ))}
                    </ul>
                  </VerdictSection>
                )}

                {verdict.what_would_need_to_be_true.length > 0 && (
                  <VerdictSection title="What would need to be true">
                    <ul className="list-disc space-y-1 pl-5">
                      {verdict.what_would_need_to_be_true.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </VerdictSection>
                )}

                <VerdictSection title="Suggested invalidation">
                  <p className="font-mono text-xs">{verdict.suggested_invalidation}</p>
                </VerdictSection>
              </div>
            )}

            {verdict && (transcript || isDemo) && (
              <div
                ref={argueRef}
                className="animate-enter rounded-lg border border-edge bg-surface p-4"
              >
                <h2 className="font-mono text-xs uppercase tracking-widest text-muted">
                  Argue back
                </h2>
                <p className="mt-1.5 text-xs text-muted">
                  Disagree? Bring a new fact — a filing, a date, a number. The desk
                  re-checks and amends on evidence, not insistence. Each round is a
                  fresh review.
                </p>
                <textarea
                  name="challenge"
                  value={challenge}
                  onChange={(e) => setChallenge(e.target.value)}
                  placeholder={
                    isDemo
                      ? "Example: The Army's FY2027 budget line funding this program was approved last week — the LOI is as good as signed."
                      : "The contract was definitized after your sources — see the 8-K filed this morning."
                  }
                  rows={3}
                  className="mt-3 w-full resize-y rounded-md border border-edge bg-surface-2 p-3 text-sm leading-relaxed text-foreground placeholder:text-muted focus:border-accent/60 focus:outline-none"
                />
                <div className="mt-2 flex justify-end">
                  <button
                    onClick={() => argue()}
                    disabled={running || challenge.trim().length < 10}
                    className="rounded-md bg-accent px-5 py-2 text-sm font-medium text-background transition-colors duration-150 hover:bg-accent/90 disabled:opacity-40"
                  >
                    {running ? "Re-reviewing…" : "Contest the verdict"}
                  </button>
                </div>
              </div>
            )}

            {error && (
              <div className="animate-enter rounded-lg border border-refused/50 bg-refused/5 p-4">
                <h2 className="font-mono text-xs uppercase tracking-widest text-refused">
                  Review failed
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed text-foreground/90">{error}</p>
                <button
                  onClick={() => run()}
                  disabled={thesis.trim().length < 20}
                  className="mt-3 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-background transition-colors duration-150 hover:bg-accent/90 disabled:opacity-40"
                >
                  Try again
                </button>
              </div>
            )}
          </section>
        )}
      </div>

      {!running && openInvalidations.length > 0 && (
        <section className="animate-enter mt-10 rounded-lg border border-edge bg-surface p-4">
          <h2 className="font-mono text-xs uppercase tracking-widest text-muted">
            Open invalidations
          </h2>
          <p className="mt-1.5 text-xs text-muted">
            Every verdict names the condition that should kill the trade. These
            are still open — re-check one when time has passed or news lands.
          </p>
          <ul className="mt-2 divide-y divide-edge">
            {openInvalidations.map((entry) => (
              <li key={entry.id} className="py-3 last:pb-0">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-mono text-sm font-semibold text-foreground">
                    {entry.card.ticker}
                  </span>
                  <VerdictTag verdict={entry.verdict.verdict} />
                  {entry.demo && <SampleTag />}
                  <span className="font-mono text-[11px] text-muted">
                    {dateOf(entry.updatedAt)}
                  </span>
                  <span className="flex-1" />
                  <button
                    onClick={() => recheck(entry)}
                    className="font-mono text-[11px] uppercase tracking-wider text-accent transition-colors duration-150 hover:text-foreground"
                  >
                    Re-check
                  </button>
                  <button
                    onClick={() => markClosed(entry.id)}
                    className="font-mono text-[11px] uppercase tracking-wider text-muted transition-colors duration-150 hover:text-foreground"
                  >
                    Mark closed
                  </button>
                </div>
                <p className="mt-1.5 font-mono text-xs leading-relaxed text-foreground/85">
                  {entry.verdict.suggested_invalidation}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!running && history.length > 0 && (
        <section className="animate-enter mt-6 rounded-lg border border-edge bg-surface p-4">
          <h2 className="font-mono text-xs uppercase tracking-widest text-muted">
            Past reviews
          </h2>
          <ul className="mt-2 divide-y divide-edge">
            {history.map((entry) => (
              <li key={entry.id} className="flex items-center gap-3 py-2.5 last:pb-0">
                <button
                  onClick={() => reopen(entry)}
                  className="group flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-0.5 text-left"
                >
                  <span className="font-mono text-[11px] text-muted">
                    {dateOf(entry.updatedAt)}
                  </span>
                  <span className="font-mono text-sm font-semibold text-foreground">
                    {entry.card.ticker}
                  </span>
                  <VerdictTag verdict={entry.verdict.verdict} />
                  {entry.verdictHistory.length > 1 && (
                    <span className="font-mono text-[11px] uppercase tracking-wider text-muted">
                      contested ×{entry.verdictHistory.length - 1}
                    </span>
                  )}
                  {entry.demo && <SampleTag />}
                  <span className="min-w-40 flex-1 truncate text-xs text-muted transition-colors duration-150 group-hover:text-foreground/85">
                    {entry.thesis || entry.card.thesis_summary}
                  </span>
                </button>
                <button
                  onClick={() => removeEntry(entry.id)}
                  aria-label={`Delete the ${entry.card.ticker} review`}
                  className="-m-2 shrink-0 p-2 font-mono text-sm leading-none text-muted transition-colors duration-150 hover:text-refused"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">
            Reviews are saved in this browser only — nothing leaves your machine.
          </p>
        </section>
      )}

      <footer className="mt-16 border-t border-edge pt-5 text-sm leading-relaxed text-muted">
        <p>
          Veto reviews the argument you wrote — it does not rate securities.
          Nothing here is investment advice or a recommendation to buy or sell
          anything. Sources can be wrong or stale; verify independently. Your
          thesis is sent to the Anthropic API for processing.
        </p>
      </footer>
    </div>
  );
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function SourceLinks({
  urls,
  titleFor,
  className = "",
}: {
  urls: string[];
  titleFor: (url: string) => string | null;
  className?: string;
}) {
  const valid = [...new Set(urls)].filter((u) => /^https?:\/\//i.test(u));
  if (valid.length === 0) return null;
  return (
    <p className={`mt-1.5 flex flex-wrap gap-x-2 gap-y-1 ${className}`}>
      {valid.map((url) => {
        const host = hostnameOf(url);
        if (!host) return null;
        return (
          <a
            key={url}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            title={titleFor(url) ?? url}
            className="inline-flex max-w-full items-baseline gap-1 rounded border border-edge bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted transition-colors duration-150 hover:border-accent/40 hover:text-foreground"
          >
            <span className="truncate">{host}</span>
            <span aria-hidden className="shrink-0 text-[10px]">
              {"↗︎"}
            </span>
          </a>
        );
      })}
    </p>
  );
}

function dateOf(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function VerdictTag({ verdict }: { verdict: FinalVerdict }) {
  return (
    <span
      className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wider ${
        verdict === "REFUSED"
          ? "border-refused/50 text-refused"
          : "border-blessed/40 text-blessed"
      }`}
    >
      {verdict}
    </span>
  );
}

function SampleTag() {
  return (
    <span className="shrink-0 rounded border border-edge px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wider text-muted">
      sample
    </span>
  );
}

function StageDot({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  return (
    <span className={done ? "text-foreground" : active ? "text-accent" : "text-muted"}>
      {label}
    </span>
  );
}

function VerdictSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <h3 className="font-mono text-xs uppercase tracking-widest text-muted">{title}</h3>
      <div className="mt-1.5 text-sm leading-relaxed text-foreground/85">{children}</div>
    </div>
  );
}
