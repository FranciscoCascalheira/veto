"use client";

import { useEffect, useRef, useState } from "react";
import type {
  EngineEvent,
  PremiseState,
  TradeCard,
  Verdict,
} from "@/lib/types";

type FeedItem =
  | { kind: "text"; text: string }
  | { kind: "search"; query: string }
  | { kind: "fetch"; url: string };

type Status = "idle" | "structuring" | "verifying" | "done" | "error";

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
  const [status, setStatus] = useState<Status>("idle");
  const [card, setCard] = useState<TradeCard | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem("veto-api-key");
    if (saved) setApiKey(saved);
  }, []);

  function saveKey(value: string) {
    setApiKey(value);
    if (value) localStorage.setItem("veto-api-key", value);
    else localStorage.removeItem("veto-api-key");
  }

  function handleEvent(event: EngineEvent) {
    switch (event.t) {
      case "stage":
        if (event.v === "structuring") setStatus("structuring");
        if (event.v === "verifying") setStatus("verifying");
        break;
      case "card":
        setCard(event.v);
        break;
      case "text":
        setFeed((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.kind === "text") {
            return [...prev.slice(0, -1), { kind: "text", text: last.text + event.v }];
          }
          return [...prev, { kind: "text", text: event.v }];
        });
        break;
      case "search":
        setFeed((prev) => [...prev, { kind: "search", query: event.v }]);
        break;
      case "fetch":
        setFeed((prev) => [...prev, { kind: "fetch", url: event.v }]);
        break;
      case "verdict":
        setVerdict(event.v);
        setStatus("done");
        break;
      case "error":
        setError(event.v);
        setStatus("error");
        break;
      case "done":
        break;
    }
  }

  async function run() {
    if (status === "structuring" || status === "verifying") return;
    setCard(null);
    setFeed([]);
    setVerdict(null);
    setError(null);
    setStatus("structuring");
    resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

    try {
      const res = await fetch("/api/refute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { "x-anthropic-api-key": apiKey } : {}),
        },
        body: JSON.stringify({ thesis }),
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error.");
      setStatus("error");
    }
  }

  const running = status === "structuring" || status === "verifying";
  const verdictFor = (id: string): PremiseState | null =>
    verdict?.premise_verdicts.find((p) => p.id === id)?.verdict ?? null;

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
          value={thesis}
          onChange={(e) => setThesis(e.target.value)}
          placeholder={PLACEHOLDER}
          rows={6}
          className="w-full resize-y rounded-md border border-edge bg-surface-2 p-3 text-sm leading-relaxed text-foreground placeholder:text-muted/60 focus:border-accent/60 focus:outline-none"
        />
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => saveKey(e.target.value)}
            placeholder="sk-ant-… (your Anthropic API key)"
            className="flex-1 rounded-md border border-edge bg-surface-2 px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted/60 focus:border-accent/60 focus:outline-none"
          />
          <button
            onClick={run}
            disabled={running || thesis.trim().length < 20}
            className="rounded-md bg-accent px-5 py-2 text-sm font-medium text-background transition-opacity disabled:opacity-40"
          >
            {running ? "Under review…" : "Submit for review"}
          </button>
        </div>
        <p className="mt-2 text-xs text-muted">
          Bring your own key: it is sent with this request only and never stored
          server-side. Leave it empty to use the site&apos;s free daily runs, when
          enabled.
        </p>
      </section>

      <div ref={resultRef}>
        {status !== "idle" && (
          <section className="mt-10 space-y-6">
            <div className="flex items-center gap-3 font-mono text-xs uppercase tracking-widest text-muted">
              <StageDot active={status === "structuring"} done={card !== null} label="Structure" />
              <span className="text-edge">—</span>
              <StageDot active={status === "verifying"} done={verdict !== null} label="Verify + attack" />
              <span className="text-edge">—</span>
              <StageDot active={false} done={verdict !== null} label="Verdict" />
            </div>

            {card && (
              <div className="rounded-lg border border-edge bg-surface p-4">
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
                <ul className="mt-4 space-y-2">
                  {card.premises.map((p) => {
                    const state = verdictFor(p.id);
                    return (
                      <li key={p.id} className="flex items-start gap-3 text-sm">
                        <span className="mt-0.5 font-mono text-xs text-muted">{p.id}</span>
                        <span className="flex-1 leading-snug text-foreground/90">
                          {p.claim}
                          {p.load_bearing && (
                            <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-muted">
                              load-bearing
                            </span>
                          )}
                        </span>
                        <span
                          className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
                            state ? PREMISE_BADGE[state] : "border-edge text-muted/60"
                          }`}
                        >
                          {state ?? "checking"}
                        </span>
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
              <div className="rounded-lg border border-edge bg-surface p-4">
                <h2 className="font-mono text-xs uppercase tracking-widest text-muted">
                  Review desk
                </h2>
                <div className="mt-3 space-y-2 text-sm leading-relaxed">
                  {feed.map((item, i) =>
                    item.kind === "text" ? (
                      <p key={i} className="whitespace-pre-wrap text-foreground/85">
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
                    <p className="font-mono text-xs text-muted/60">working…</p>
                  )}
                </div>
              </div>
            )}

            {verdict && (
              <div
                className={`rounded-lg border-2 p-5 ${
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
                <p className="mt-3 text-sm leading-relaxed text-foreground/90">
                  {verdict.verdict_reason}
                </p>

                <VerdictSection title="The bear case">
                  <p>{verdict.bear_case}</p>
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

            {error && (
              <div className="rounded-lg border border-refused/50 bg-refused/5 p-4 text-sm text-foreground/90">
                {error}
              </div>
            )}
          </section>
        )}
      </div>

      <footer className="mt-16 border-t border-edge pt-5 text-xs leading-relaxed text-muted">
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

function StageDot({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  return (
    <span className={done ? "text-foreground" : active ? "text-accent" : "text-muted/50"}>
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
