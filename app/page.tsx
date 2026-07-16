"use client";

import { useEffect, useRef, useState } from "react";
import type {
  EngineEvent,
  FinalVerdict,
  PremiseState,
  SourceRef,
  StressOutcome,
  TradeCard,
  Verdict,
} from "@/lib/types";
import {
  backupFilename,
  closeInvalidation,
  deleteReview,
  exportHistory,
  importHistory,
  loadHistory,
  newReviewId,
  upsertReview,
  type FeedItem,
  type StoredReview,
} from "@/lib/history";
import {
  copyText,
  downloadBlob,
  pngFilename,
  renderVerdictPng,
  reviewToMarkdown,
  type ExportReview,
} from "@/lib/export";

type Status = "idle" | "structuring" | "verifying" | "clarifying" | "done" | "error";

// Every replay of the sample review lands on this one history entry, so it
// never piles up duplicates. The re-check prefill matches the canned
// argue-back round the demo answers with.
const DEMO_HISTORY_ID = "demo-sample";
const DEMO_RECHECK_CHALLENGE =
  "The Army's FY2027 budget line funding this program was approved last week — the LOI is as good as signed.";

// The challenge a re-check submits: a time check on the review's own
// invalidation. The demo answers a fixed challenge, so it gets that one.
function recheckChallengeFor(entry: StoredReview): string {
  return entry.demo
    ? DEMO_RECHECK_CHALLENGE
    : `Time check on the invalidation this review set: "${entry.verdict.suggested_invalidation}" — has it triggered since? Verify against fresh sources as of today and update the verdict.`;
}

// Mutable mirror of the review currently on screen. handleEvent runs inside
// the streaming loop where React state reads would be stale, so the data a
// finished round persists to history is accumulated here.
type ActiveReview = {
  id: string;
  createdAt: number;
  updatedAt: number;
  demo: boolean;
  thesis: string;
  card: TradeCard | null;
  feed: FeedItem[];
  sources: SourceRef[];
  verdictHistory: FinalVerdict[];
  verdict: Verdict | null;
  stress: StressOutcome | null;
  transcript: unknown[] | null;
};

function appendFeed(prev: FeedItem[], item: FeedItem): FeedItem[] {
  const last = prev[prev.length - 1];
  if (item.kind === "text" && last?.kind === "text") {
    return [...prev.slice(0, -1), { kind: "text", text: last.text + item.text }];
  }
  return [...prev, item];
}

// Fold one engine event into a private review accumulator — the batch
// re-check's counterpart to handleEvent, with no React state and no visible
// side effects. Only the events an argue round emits are handled.
function applyEventToReview(acc: ActiveReview, event: EngineEvent) {
  switch (event.t) {
    case "card":
      acc.card = event.v;
      break;
    case "text":
      acc.feed = appendFeed(acc.feed, { kind: "text", text: event.v });
      break;
    case "search":
      acc.feed = appendFeed(acc.feed, { kind: "search", query: event.v });
      break;
    case "fetch":
      acc.feed = appendFeed(acc.feed, { kind: "fetch", url: event.v });
      break;
    case "sources":
      acc.sources = event.v;
      break;
    case "stress":
      if (event.v === "begin") acc.feed = appendFeed(acc.feed, { kind: "stress" });
      else acc.stress = event.v;
      break;
    case "verdict":
      acc.verdict = event.v;
      acc.verdictHistory = [...acc.verdictHistory, event.v.verdict];
      break;
    case "transcript":
      acc.transcript = event.v;
      break;
  }
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
  const [stress, setStress] = useState<StressOutcome | null>(null);
  const [transcript, setTranscript] = useState<unknown[] | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [challenge, setChallenge] = useState("");
  const [questions, setQuestions] = useState<string[] | null>(null);
  const [answers, setAnswers] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<StoredReview[]>([]);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [pngState, setPngState] = useState<"idle" | "working" | "saved" | "failed">("idle");
  const [historyMsg, setHistoryMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [recheckState, setRecheckState] = useState<{
    done: number;
    total: number;
    current: string | null;
    failed: number;
    running: boolean;
  } | null>(null);
  const [recheckConfirm, setRecheckConfirm] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);
  const argueRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<ActiveReview | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      case "questions":
        setQuestions(event.v);
        setStatus("clarifying");
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
      case "stress":
        if (event.v === "begin") {
          setFeed((prev) => appendFeed(prev, { kind: "stress" }));
          if (active) active.feed = appendFeed(active.feed, { kind: "stress" });
        } else {
          setStress(event.v);
          if (active) active.stress = event.v;
        }
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
          active.updatedAt = Date.now();
          setHistory(
            upsertReview({
              id: active.id,
              createdAt: active.createdAt,
              updatedAt: active.updatedAt,
              demo: active.demo,
              thesis: active.thesis,
              card: active.card,
              verdict: active.verdict,
              verdictHistory: active.verdictHistory,
              stress: active.stress,
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

  // Drive one SSE review, dispatching each event to `onEvent`. The main flow
  // passes handleEvent (updates the visible review); the batch re-check passes
  // a handler that writes into a private accumulator instead.
  async function consumeStream(
    payload: Record<string, unknown>,
    withKey: boolean,
    onEvent: (event: EngineEvent) => void,
  ) {
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
        onEvent(JSON.parse(line.slice(6)) as EngineEvent);
      }
    }
  }

  function streamReview(payload: Record<string, unknown>, withKey: boolean) {
    return consumeStream(payload, withKey, handleEvent);
  }

  async function run(demo = false) {
    if (status === "structuring" || status === "verifying") return;
    activeRef.current = {
      id: demo ? DEMO_HISTORY_ID : newReviewId(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      demo,
      thesis: demo ? "" : thesis,
      card: null,
      feed: [],
      sources: [],
      verdictHistory: [],
      verdict: null,
      stress: null,
      transcript: null,
    };
    setCard(null);
    setFeed([]);
    setSources([]);
    setVerdict(null);
    setVerdictHistory([]);
    setStress(null);
    setTranscript(null);
    setIsDemo(demo);
    setChallenge("");
    setQuestions(null);
    setAnswers("");
    setError(null);
    setCopyState("idle");
    setPngState("idle");
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
    // A stress outcome describes the round that produced the current verdict;
    // the new round starts clean and earns its own (or none).
    setStress(null);
    if (activeRef.current) {
      activeRef.current.feed = appendFeed(activeRef.current.feed, { kind: "challenge", text });
      activeRef.current.stress = null;
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

  // Answer the intake desk's questions (or proceed without) and continue the
  // same review — no new history entry, the original card/verdict populate the
  // activeRef that run() already opened.
  async function answerIntake(proceed: boolean) {
    if (running) return;
    const text = proceed ? "" : answers.trim();
    if (!proceed && text.length < 2) return;
    setError(null);
    setQuestions(null);
    setStatus("structuring");
    if (activeRef.current) activeRef.current.thesis = thesis;
    try {
      await streamReview({ thesis, answers: text, code }, true);
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
      updatedAt: entry.updatedAt,
      demo: entry.demo,
      thesis: entry.thesis,
      card: entry.card,
      feed: entry.feed,
      sources: entry.sources,
      verdictHistory: [...entry.verdictHistory],
      verdict: entry.verdict,
      stress: entry.stress,
      transcript: entry.transcript,
    };
    if (entry.thesis) setThesis(entry.thesis);
    setCard(entry.card);
    setFeed(entry.feed);
    setSources(entry.sources);
    setVerdict(entry.verdict);
    setVerdictHistory(entry.verdictHistory);
    setStress(entry.stress);
    setTranscript(entry.transcript);
    setIsDemo(entry.demo);
    setChallenge("");
    setQuestions(null);
    setAnswers("");
    setError(null);
    setCopyState("idle");
    setPngState("idle");
    setStatus("done");
    if (scroll) resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function recheck(entry: StoredReview) {
    if (status === "structuring" || status === "verifying") return;
    const contestable = entry.demo || entry.transcript !== null;
    reopen(entry, false);
    if (contestable) {
      setChallenge(recheckChallengeFor(entry));
      setTimeout(() => {
        argueRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 80);
    } else {
      // The stored conversation was shed for space; the original thesis is
      // back in the box for a fresh full review.
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  // The displayed review, packaged for export. State reads are current at
  // click time; the mirror supplies what the UI doesn't keep in state.
  function buildExportReview(): ExportReview | null {
    const active = activeRef.current;
    if (!card || !verdict || !active) return null;
    return {
      card,
      verdict,
      verdictHistory,
      stress: active.stress,
      sources,
      feed,
      thesis: active.thesis,
      demo: active.demo,
      reviewedAt: active.updatedAt,
    };
  }

  async function copyMarkdown() {
    const review = buildExportReview();
    if (!review) return;
    try {
      await copyText(reviewToMarkdown(review));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    setTimeout(() => setCopyState("idle"), 2000);
  }

  async function downloadPng() {
    const review = buildExportReview();
    if (!review || pngState === "working") return;
    setPngState("working");
    try {
      downloadBlob(await renderVerdictPng(review), pngFilename(review));
      setPngState("saved");
    } catch {
      setPngState("failed");
    }
    setTimeout(() => setPngState("idle"), 2000);
  }

  function removeEntry(id: string) {
    setHistory(deleteReview(id));
  }

  function flashHistory(text: string, error = false) {
    setHistoryMsg({ text, error });
    setTimeout(() => setHistoryMsg(null), 4000);
  }

  function backUpHistory() {
    const now = Date.now();
    downloadBlob(
      new Blob([exportHistory(now)], { type: "application/json" }),
      backupFilename(now),
    );
  }

  function onImportFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset so re-picking the same file fires onChange again.
    event.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const result = importHistory(String(reader.result));
        setHistory(result.history);
        const parts: string[] = [];
        if (result.added) parts.push(`${result.added} added`);
        if (result.updated) parts.push(`${result.updated} updated`);
        if (result.skipped) parts.push(`${result.skipped} already current`);
        flashHistory(parts.length ? `Imported — ${parts.join(", ")}.` : "Nothing to import.");
      } catch (err) {
        flashHistory(err instanceof Error ? err.message : "Import failed.", true);
      }
    };
    reader.onerror = () => flashHistory("Could not read that file.", true);
    reader.readAsText(file);
  }

  function markClosed(id: string) {
    setHistory(closeInvalidation(id));
  }

  const running = status === "structuring" || status === "verifying";
  const openInvalidations = history.filter((entry) => !entry.invalidationClosed);
  // Only reviews still holding their transcript (or the demo) can be contested
  // in place, so only those can be batch re-checked; the rest were shed for
  // space and would need a fresh full review.
  const recheckTargets = openInvalidations.filter((e) => e.demo || e.transcript !== null);

  // Re-check every contestable open invalidation in turn — each a full argue
  // round run headless into a private accumulator, then written to history.
  // Sequential on purpose: it spends a review per item, so it stays visible
  // and gated behind an explicit confirm.
  async function recheckAll() {
    if (recheckState?.running || running) return;
    const targets = recheckTargets;
    if (targets.length === 0) return;
    setRecheckConfirm(false);
    let failed = 0;
    for (let i = 0; i < targets.length; i++) {
      const entry = targets[i];
      setRecheckState({ done: i, total: targets.length, current: entry.card.ticker, failed, running: true });
      const challenge = recheckChallengeFor(entry);
      const acc: ActiveReview = {
        id: entry.id,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        demo: entry.demo,
        thesis: entry.thesis,
        card: entry.card,
        feed: appendFeed([...entry.feed], { kind: "challenge", text: challenge }),
        sources: entry.sources,
        verdictHistory: [...entry.verdictHistory],
        verdict: entry.verdict,
        stress: entry.stress,
        transcript: entry.transcript,
      };
      try {
        await consumeStream(
          entry.demo ? { demo: true, challenge } : { challenge, transcript: entry.transcript, code },
          !entry.demo,
          (event) => applyEventToReview(acc, event),
        );
        if (acc.verdict && acc.card) {
          setHistory(
            upsertReview({
              id: acc.id,
              createdAt: acc.createdAt,
              updatedAt: Date.now(),
              demo: acc.demo,
              thesis: acc.thesis,
              card: acc.card,
              verdict: acc.verdict,
              verdictHistory: acc.verdictHistory,
              stress: acc.stress,
              sources: acc.sources,
              feed: acc.feed,
              transcript: acc.transcript,
              invalidationClosed: false,
            }),
          );
        } else {
          failed += 1;
        }
      } catch {
        failed += 1;
      }
    }
    setRecheckState({ done: targets.length, total: targets.length, current: null, failed, running: false });
    setTimeout(() => setRecheckState(null), 6000);
  }
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
            className="rounded-md bg-field px-5 py-2 text-sm font-medium text-field-ink transition-colors duration-150 hover:bg-field/90 disabled:opacity-40"
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
            {status !== "clarifying" && (
              <div className="flex items-center gap-3 font-mono text-xs uppercase tracking-widest text-muted">
                <StageDot active={status === "structuring"} done={card !== null} label="Structure" />
                <span aria-hidden className="text-edge">—</span>
                <StageDot active={status === "verifying"} done={verdict !== null} label="Verify + attack" />
                <span aria-hidden className="text-edge">—</span>
                <StageDot active={false} done={verdict !== null} label="Verdict" />
              </div>
            )}

            {status === "clarifying" && questions && (
              <div className="animate-enter rounded-lg border border-edge bg-surface p-4">
                <h2 className="font-mono text-xs uppercase tracking-widest text-muted">
                  The desk needs specifics
                </h2>
                <p className="mt-1.5 text-xs text-muted">
                  This thesis is too thin to review honestly yet. Answer what you
                  can — the desk folds it in before structuring — or have it
                  reviewed as written.
                </p>
                <ol className="mt-3 space-y-2 text-sm leading-relaxed">
                  {questions.map((q, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="mt-0.5 font-mono text-xs text-muted">{i + 1}</span>
                      <span className="flex-1 text-foreground/90">{q}</span>
                    </li>
                  ))}
                </ol>
                <textarea
                  name="answers"
                  value={answers}
                  onChange={(e) => setAnswers(e.target.value)}
                  placeholder="Answer the desk — a source, a date, the level that would prove you wrong."
                  rows={3}
                  className="mt-3 w-full resize-y rounded-md border border-edge bg-surface-2 p-3 text-sm leading-relaxed text-foreground placeholder:text-muted focus:border-accent/60 focus:outline-none"
                />
                <div className="mt-2 flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
                  <button
                    onClick={() => answerIntake(true)}
                    className="-m-2 p-2 font-mono text-[11px] uppercase tracking-wider text-accent transition-colors duration-150 hover:text-foreground"
                  >
                    Review as written
                  </button>
                  <button
                    onClick={() => answerIntake(false)}
                    disabled={answers.trim().length < 2}
                    className="rounded-md bg-field px-5 py-2 text-sm font-medium text-field-ink transition-colors duration-150 hover:bg-field/90 disabled:opacity-40"
                  >
                    Answer and review
                  </button>
                </div>
              </div>
            )}

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
                    ) : item.kind === "stress" ? (
                      <p
                        key={i}
                        className="border-l-2 border-accent/50 pl-3 text-foreground/85"
                      >
                        <span className="mr-2 font-mono text-xs uppercase tracking-wider text-accent">
                          stress test
                        </span>
                        House rule: no blessing leaves the desk untested. The desk
                        now attacks its own verdict.
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
                {/* Verdict-first — the stamp is the hero, per the B preview
                    Francisco picked. But in the document register it speaks in
                    Instrument Serif, not a mono-bold terminal stamp: that mono
                    weight was the last thing on the card still reading "console".
                    See ai-workflow/RUBRIC.md. */}
                <div
                  className={`font-serif text-[2.5rem] leading-none tracking-[0.01em] ${
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
                {stress && (
                  <p className="mt-1 font-mono text-xs uppercase tracking-wider text-muted">
                    stress-tested ·{" "}
                    {stress === "upheld"
                      ? "blessing upheld"
                      : "preliminary blessing withdrawn"}
                  </p>
                )}
                {/* The desk's ruling — the one sentence the product exists to
                    produce. It was set at text-sm, the same size as every label
                    around it, which is what made the verdict block read flat.
                    Serif, not italic: on the seed, italic is for quotes and
                    asides; a ruling is neither. */}
                <p className="mt-4 max-w-[52ch] font-serif text-2xl leading-snug text-foreground">
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
                  {/* Prose, so it reads as prose. The "this is a checkable
                      condition" signal is already carried by the mono eyebrow
                      above it; setting the sentence in mono too was redundant
                      signal paid for in legibility — and it was the one line
                      the reader has to act on. */}
                  <p className="text-sm leading-relaxed text-foreground/85">
                    {verdict.suggested_invalidation}
                  </p>
                </VerdictSection>

                <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-edge pt-4">
                  <button
                    onClick={() => copyMarkdown()}
                    className={`font-mono text-[11px] uppercase tracking-wider transition-colors duration-150 hover:text-foreground ${
                      copyState === "failed" ? "text-refused" : "text-muted"
                    }`}
                  >
                    {copyState === "copied"
                      ? "Copied"
                      : copyState === "failed"
                        ? "Copy failed"
                        : "Copy as Markdown"}
                  </button>
                  <button
                    onClick={() => downloadPng()}
                    className={`font-mono text-[11px] uppercase tracking-wider transition-colors duration-150 hover:text-foreground ${
                      pngState === "failed" ? "text-refused" : "text-muted"
                    }`}
                  >
                    {pngState === "working"
                      ? "Rendering…"
                      : pngState === "saved"
                        ? "Saved"
                        : pngState === "failed"
                          ? "Export failed"
                          : "Download PNG"}
                  </button>
                </div>
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
                    className="rounded-md bg-field px-5 py-2 text-sm font-medium text-field-ink transition-colors duration-150 hover:bg-field/90 disabled:opacity-40"
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
                  className="mt-3 rounded-md bg-field px-4 py-1.5 text-sm font-medium text-field-ink transition-colors duration-150 hover:bg-field/90 disabled:opacity-40"
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
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-mono text-xs uppercase tracking-widest text-muted">
              Open invalidations
            </h2>
            {recheckState ? (
              <span
                className={`font-mono text-[11px] uppercase tracking-wider ${
                  recheckState.running ? "text-accent" : "text-muted"
                }`}
              >
                {recheckState.running ? (
                  `Re-checking ${recheckState.current} · ${recheckState.done + 1}/${recheckState.total}`
                ) : (
                  <>
                    Re-checked {recheckState.total - recheckState.failed}/{recheckState.total}
                    {recheckState.failed > 0 && (
                      <span className="text-refused"> · {recheckState.failed} failed</span>
                    )}
                  </>
                )}
              </span>
            ) : recheckConfirm ? (
              <span className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-wider">
                <button
                  onClick={() => recheckAll()}
                  className="text-accent transition-colors duration-150 hover:text-foreground"
                >
                  Confirm
                </button>
                <button
                  onClick={() => setRecheckConfirm(false)}
                  className="text-accent transition-colors duration-150 hover:text-foreground"
                >
                  Cancel
                </button>
              </span>
            ) : (
              recheckTargets.length >= 2 && (
                <button
                  onClick={() => setRecheckConfirm(true)}
                  className="font-mono text-[11px] uppercase tracking-wider text-accent transition-colors duration-150 hover:text-foreground"
                >
                  Re-check all
                </button>
              )
            )}
          </div>
          {recheckConfirm && !recheckState ? (
            <p className="mt-2 font-mono text-[11px] text-muted">
              Re-check {recheckTargets.length}
              {recheckTargets.length < openInvalidations.length
                ? ` of ${openInvalidations.length}`
                : ""}{" "}
              open {recheckTargets.length === 1 ? "invalidation" : "invalidations"}? Each runs a
              full review.
              {recheckTargets.length < openInvalidations.length
                ? " The rest dropped their saved conversation to make room — re-check those individually as a fresh review."
                : ""}
            </p>
          ) : (
            <p className="mt-1.5 text-xs text-muted">
              Every verdict names the condition that should kill the trade. These
              are still open — re-check one when time has passed or news lands.
            </p>
          )}
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
                    disabled={recheckState?.running}
                    className="font-mono text-[11px] uppercase tracking-wider text-accent transition-colors duration-150 hover:text-foreground disabled:cursor-not-allowed"
                  >
                    Re-check
                  </button>
                  <button
                    onClick={() => markClosed(entry.id)}
                    disabled={recheckState?.running}
                    className="font-mono text-[11px] uppercase tracking-wider text-accent transition-colors duration-150 hover:text-foreground disabled:cursor-not-allowed"
                  >
                    Mark closed
                  </button>
                </div>
                <p className="mt-1.5 text-sm leading-relaxed text-foreground/85">
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
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-edge pt-3">
            <p className="text-xs text-muted">
              Reviews are saved in this browser only — nothing leaves your machine.
            </p>
            <div className="flex gap-x-4 sm:ml-auto">
              <button
                onClick={backUpHistory}
                className="font-mono text-[11px] uppercase tracking-wider text-accent transition-colors duration-150 hover:text-foreground"
              >
                Back up
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="font-mono text-[11px] uppercase tracking-wider text-accent transition-colors duration-150 hover:text-foreground"
              >
                Import
              </button>
            </div>
          </div>
          {historyMsg && (
            <p
              className={`mt-2 font-mono text-[11px] ${
                historyMsg.error ? "text-refused" : "text-muted"
              }`}
            >
              {historyMsg.text}
            </p>
          )}
        </section>
      )}

      {!running && history.length === 0 && status === "idle" && (
        <div className="mt-10">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="font-mono text-[11px] uppercase tracking-wider text-accent transition-colors duration-150 hover:text-foreground"
          >
            Restore a backup
          </button>
          {historyMsg && (
            <p
              className={`mt-2 font-mono text-[11px] ${
                historyMsg.error ? "text-refused" : "text-muted"
              }`}
            >
              {historyMsg.text}
            </p>
          )}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        onChange={onImportFile}
        className="hidden"
      />

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
