import type { FinalVerdict, SourceRef, StressOutcome, TradeCard, Verdict } from "./types";
import type { FeedItem } from "./history";

// Everything a shareable artifact needs, decoupled from live/stored state so
// both a just-finished review and a reopened one export identically.
export interface ExportReview {
  card: TradeCard;
  verdict: Verdict;
  verdictHistory: FinalVerdict[];
  stress: StressOutcome | null;
  sources: SourceRef[];
  feed: FeedItem[];
  thesis: string;
  demo: boolean;
  reviewedAt: number;
}

function stressLabel(stress: StressOutcome): string {
  return stress === "upheld"
    ? "stress-tested — blessing upheld"
    : "stress-tested — preliminary blessing withdrawn";
}

// Exports travel without the page around them, so the canonical URL and the
// regulatory line ride along on every artifact.
const SITE_URL = "https://veto-production.up.railway.app";
const SITE_HOST = "veto-production.up.railway.app";
const DISCLAIMER =
  "Veto reviews the argument, not the security. Nothing here is investment advice or a recommendation to buy or sell anything. Sources can be wrong or stale; verify independently.";

function isoDate(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function outcomeOf(history: FinalVerdict[]): "upheld" | "overturned" | null {
  if (history.length < 2) return null;
  return history[history.length - 1] === history[history.length - 2]
    ? "upheld"
    : "overturned";
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

function sourcesLine(urls: string[], sources: SourceRef[]): string | null {
  const valid = [...new Set(urls)].filter((u) => /^https?:\/\//i.test(u));
  if (valid.length === 0) return null;
  return valid
    .map((url) => {
      const title = sources.find((s) => s.url === url)?.title;
      return `[${title ?? hostOf(url)}](${url})`;
    })
    .join(" · ");
}

export function reviewToMarkdown(review: ExportReview): string {
  const { card, verdict, verdictHistory, sources, feed, thesis, demo } = review;
  const lines: string[] = [];

  lines.push(`# ${card.ticker} — ${verdict.verdict}`);
  lines.push("");
  const rounds = verdictHistory.length - 1;
  const meta = [
    `**${card.company}**`,
    card.direction,
    card.horizon,
    `reviewed ${isoDate(review.reviewedAt)} by [Veto](${SITE_URL})`,
  ];
  if (rounds > 0) meta.push(`contested ×${rounds} — verdict ${outcomeOf(verdictHistory)}`);
  if (review.stress) meta.push(stressLabel(review.stress));
  lines.push(meta.join(" · "));
  if (demo) {
    lines.push("");
    lines.push("*Sample review of a fictional ticker — illustrative only.*");
  }
  lines.push("");
  if (thesis) {
    lines.push(...thesis.trim().split("\n").map((l) => `> ${l}`));
    lines.push("");
  }
  lines.push(card.thesis_summary);
  lines.push("");

  lines.push("## Premises");
  lines.push("");
  for (const premise of card.premises) {
    const pv = verdict.premise_verdicts.find((v) => v.id === premise.id);
    const state = pv?.verdict ?? "UNVERIFIABLE";
    const load = premise.load_bearing ? " · load-bearing" : "";
    lines.push(`- **${premise.id} · ${state}${load}** — ${premise.claim}`);
    if (pv?.evidence) lines.push(`  - Evidence: ${pv.evidence}`);
    const src = pv ? sourcesLine(pv.source_urls ?? [], sources) : null;
    if (src) lines.push(`  - Sources: ${src}`);
  }
  lines.push("");

  lines.push("## The bear case");
  lines.push("");
  lines.push(verdict.bear_case);
  const bearSrc = sourcesLine(verdict.bear_case_source_urls ?? [], sources);
  if (bearSrc) {
    lines.push("");
    lines.push(`Sources: ${bearSrc}`);
  }
  lines.push("");

  if (verdict.red_flags.length > 0) {
    lines.push("## Red flags");
    lines.push("");
    for (const flag of verdict.red_flags) lines.push(`- ${flag}`);
    lines.push("");
  }

  const challenges = feed.filter((item) => item.kind === "challenge");
  if (challenges.length > 0) {
    lines.push("## Challenges");
    lines.push("");
    challenges.forEach((challenge, i) => {
      const before = verdictHistory[i];
      const after = verdictHistory[i + 1];
      const outcome = after ? (after === before ? "verdict upheld" : `verdict overturned to ${after}`) : "";
      lines.push(`${i + 1}. "${challenge.text}"${outcome ? ` — ${outcome}` : ""}`);
    });
    lines.push("");
  }

  lines.push(`## Verdict: ${verdict.verdict}`);
  lines.push("");
  lines.push(verdict.verdict_reason);
  lines.push("");
  if (verdict.what_would_need_to_be_true.length > 0) {
    lines.push("What would need to be true:");
    lines.push("");
    for (const item of verdict.what_would_need_to_be_true) lines.push(`- ${item}`);
    lines.push("");
  }
  if (card.stated_invalidation) {
    lines.push(`**Stated invalidation:** ${card.stated_invalidation}`);
    lines.push("");
  }
  lines.push(`**Suggested invalidation:** ${verdict.suggested_invalidation}`);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(`${DISCLAIMER.replace("Veto reviews", `[Veto](${SITE_URL}) reviews`)}`);
  lines.push("");
  return lines.join("\n");
}

export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand("copy");
  area.remove();
  if (!ok) throw new Error("Clipboard unavailable.");
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

// The PNG re-reads the design tokens and font stacks from the live document,
// so the artifact stays in lockstep with globals.css.
function cssValue(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function readTokens() {
  return {
    background: cssValue("--background", "#14110d"),
    edge: cssValue("--edge", "#2c2620"),
    foreground: cssValue("--foreground", "#e9e2d4"),
    muted: cssValue("--muted", "#8f8471"),
    accent: cssValue("--accent", "#e8a33d"),
    refused: cssValue("--refused", "#e5484d"),
    blessed: cssValue("--blessed", "#52a35e"),
  };
}

function readFonts() {
  const mono = cssValue("--font-geist-mono", "");
  const sans = cssValue("--font-geist-sans", "");
  return {
    mono: mono ? `${mono}, monospace` : "ui-monospace, monospace",
    sans: sans ? `${sans}, sans-serif` : "system-ui, sans-serif",
  };
}

type Ctx = CanvasRenderingContext2D & { letterSpacing?: string };

function wrap(ctx: Ctx, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const last = lines[lines.length - 1];
    const probe = last ? `${last} ${word}` : word;
    if (last !== undefined && ctx.measureText(probe).width <= maxWidth) {
      lines[lines.length - 1] = probe;
    } else if (ctx.measureText(word).width <= maxWidth || word.length < 2) {
      lines.push(word);
    } else {
      // A single token wider than the column (long URL etc.): hard-break it.
      let rest = word;
      while (ctx.measureText(rest).width > maxWidth && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && ctx.measureText(rest.slice(0, cut)).width > maxWidth) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      lines.push(rest);
    }
  }
  return lines;
}

function clampLines(ctx: Ctx, lines: string[], max: number, maxWidth: number): string[] {
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  let last = kept[max - 1];
  while (last.length > 0 && ctx.measureText(`${last}…`).width > maxWidth) {
    last = last.slice(0, -1).trimEnd();
  }
  kept[max - 1] = `${last}…`;
  return kept;
}

const PNG_WIDTH = 1200;
const PNG_PAD = 72;
const PNG_SCALE = 2;

// Single layout routine used for both passes: a measuring pass (draw=false)
// that returns the total height, then a paint pass onto the real canvas.
function paint(
  ctx: Ctx,
  review: ExportReview,
  draw: boolean,
  totalHeight: number,
): number {
  const t = readTokens();
  const f = readFonts();
  const { card, verdict, verdictHistory } = review;
  const verdictColor = verdict.verdict === "REFUSED" ? t.refused : t.blessed;
  const contentW = PNG_WIDTH - PNG_PAD * 2;
  const x = PNG_PAD;
  let y = 0;

  const setFont = (weight: number, size: number, family: string, spacing = "0px") => {
    ctx.font = `${weight} ${size}px ${family}`;
    if ("letterSpacing" in ctx) ctx.letterSpacing = spacing;
  };
  const put = (text: string, px: number, py: number, color: string, alpha = 1) => {
    if (!draw) return;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillText(text, px, py);
    ctx.globalAlpha = 1;
  };
  const hairline = () => {
    y += 36;
    if (draw) {
      ctx.strokeStyle = t.edge;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + contentW, y);
      ctx.stroke();
    }
    y += 36;
  };
  const sectionHeader = (label: string) => {
    setFont(500, 14, f.mono, "2px");
    put(label.toUpperCase(), x, y, t.muted);
    y += 26;
  };

  if (draw) {
    ctx.fillStyle = t.background;
    ctx.fillRect(0, 0, PNG_WIDTH, totalHeight);
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = verdictColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(12, 12, PNG_WIDTH - 24, totalHeight - 24, 14);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.textBaseline = "alphabetic";
  }

  // Header: wordmark left, date right.
  y = PNG_PAD + 8;
  setFont(600, 26, f.mono, "9px");
  put("VETO", x, y, t.foreground);
  setFont(400, 17, f.mono);
  const dateLabel = isoDate(review.reviewedAt);
  put(dateLabel, x + contentW - ctx.measureText(dateLabel).width, y, t.muted);
  y += 16;
  if (review.demo) {
    y += 24;
    setFont(500, 14, f.mono, "2px");
    put("SAMPLE REVIEW — FICTIONAL TICKER", x, y, t.muted);
  }

  // Ticker line.
  y += 58;
  setFont(700, 40, f.mono);
  put(card.ticker, x, y, t.foreground);
  const tickerW = ctx.measureText(card.ticker).width;
  setFont(400, 20, f.sans);
  const company = clampLines(ctx, wrap(ctx, card.company, contentW - tickerW - 20), 1, contentW - tickerW - 20);
  put(company[0] ?? "", x + tickerW + 20, y, t.muted);
  y += 32;
  setFont(500, 15, f.mono, "1.5px");
  put(`${card.direction.toUpperCase()} · ${card.horizon.toUpperCase()}`, x, y, t.accent);

  // Verdict.
  y += 92;
  setFont(700, 64, f.mono, "14px");
  put(verdict.verdict, x, y, verdictColor);
  const rounds = verdictHistory.length - 1;
  if (rounds > 0) {
    y += 34;
    setFont(500, 15, f.mono, "1.5px");
    put(`CONTESTED ×${rounds} · VERDICT ${outcomeOf(verdictHistory)?.toUpperCase()}`, x, y, t.muted);
  }
  if (review.stress) {
    // 30 is the stacking offset under CONTESTED; 34 is the first-sub-line slot.
    y += rounds > 0 ? 30 : 34;
    setFont(500, 15, f.mono, "1.5px");
    put(
      `STRESS-TESTED · ${review.stress === "upheld" ? "BLESSING UPHELD" : "PRELIMINARY BLESSING WITHDRAWN"}`,
      x,
      y,
      t.muted,
    );
  }
  y += 42;
  setFont(400, 19, f.sans);
  for (const line of clampLines(ctx, wrap(ctx, verdict.verdict_reason, contentW), 6, contentW)) {
    put(line, x, y, t.foreground, 0.9);
    y += 28;
  }

  hairline();

  // Premises receipt.
  sectionHeader("Premises");
  y += 8;
  for (const [index, premise] of card.premises.entries()) {
    const state = verdict.premise_verdicts.find((v) => v.id === premise.id)?.verdict ?? "UNVERIFIABLE";
    const stateColor =
      state === "CONFIRMED" ? t.blessed : state === "FALSE" ? t.refused : state === "PARTIAL" ? t.accent : t.muted;
    setFont(500, 16, f.mono);
    put(premise.id, x, y, t.muted);
    setFont(600, 16, f.mono, "1px");
    put(state, x + 52, y, stateColor);
    if (premise.load_bearing) {
      const stateW = ctx.measureText(state).width;
      setFont(500, 13, f.mono, "1px");
      put("· LOAD-BEARING", x + 52 + stateW + 14, y, t.muted);
    }
    y += 26;
    setFont(400, 18, f.sans);
    for (const line of clampLines(ctx, wrap(ctx, premise.claim, contentW - 52), 3, contentW - 52)) {
      put(line, x + 52, y, t.foreground, 0.9);
      y += 26;
    }
    if (index < card.premises.length - 1) y += 14;
  }

  hairline();

  // Bear case.
  sectionHeader("The bear case");
  y += 4;
  setFont(400, 18, f.sans);
  for (const line of clampLines(ctx, wrap(ctx, verdict.bear_case, contentW), 5, contentW)) {
    put(line, x, y, t.foreground, 0.85);
    y += 27;
  }

  y += 30;
  sectionHeader("Suggested invalidation");
  y += 4;
  setFont(400, 17, f.mono);
  for (const line of wrap(ctx, verdict.suggested_invalidation, contentW)) {
    put(line, x, y, t.foreground, 0.85);
    y += 26;
  }

  hairline();

  // Footer: disclaimer + canonical host.
  setFont(400, 15, f.sans);
  for (const line of wrap(ctx, DISCLAIMER, contentW)) {
    put(line, x, y, t.muted);
    y += 22;
  }
  y += 10;
  setFont(500, 15, f.mono);
  put(SITE_HOST, x, y, t.accent);
  y += PNG_PAD - 16;

  return y;
}

export async function renderVerdictPng(review: ExportReview): Promise<Blob> {
  await document.fonts.ready;
  const probe = document.createElement("canvas").getContext("2d") as Ctx | null;
  if (!probe) throw new Error("Canvas is unavailable in this browser.");
  const height = Math.ceil(paint(probe, review, false, 0));

  const canvas = document.createElement("canvas");
  canvas.width = PNG_WIDTH * PNG_SCALE;
  canvas.height = height * PNG_SCALE;
  const ctx = canvas.getContext("2d") as Ctx | null;
  if (!ctx) throw new Error("Canvas is unavailable in this browser.");
  ctx.scale(PNG_SCALE, PNG_SCALE);
  paint(ctx, review, true, height);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("PNG encoding failed."))),
      "image/png",
    );
  });
}

export function pngFilename(review: ExportReview): string {
  const ticker = review.card.ticker.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "review";
  return `veto-${ticker}-${review.verdict.verdict.toLowerCase()}-${isoDate(review.reviewedAt)}.png`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
