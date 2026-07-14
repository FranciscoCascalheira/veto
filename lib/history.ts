import type { FinalVerdict, SourceRef, StressOutcome, TradeCard, Verdict } from "./types";

// One item of the review-desk feed, as rendered by the UI and persisted with
// each review. "stress" marks the desk turning on its own preliminary
// blessing.
export type FeedItem =
  | { kind: "text"; text: string }
  | { kind: "search"; query: string }
  | { kind: "fetch"; url: string }
  | { kind: "challenge"; text: string }
  | { kind: "stress" };

// A finished review as kept in this browser's localStorage — no accounts, no
// server storage. `transcript` is the client-held conversation that lets the
// verdict be contested again; it embeds full search results, so it dominates
// the storage budget and is shed first under pressure (the review stays
// readable, it just can't be continued in place).
export interface StoredReview {
  id: string;
  createdAt: number;
  updatedAt: number;
  demo: boolean;
  thesis: string;
  card: TradeCard;
  verdict: Verdict;
  verdictHistory: FinalVerdict[];
  stress: StressOutcome | null;
  sources: SourceRef[];
  feed: FeedItem[];
  transcript: unknown[] | null;
  invalidationClosed: boolean;
}

const KEY = "veto-history";
const MAX_ENTRIES = 30;
// Only the newest reviews keep a transcript (see StoredReview).
const TRANSCRIPTS_KEPT = 10;

export function newReviewId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function isStoredReview(value: unknown): value is StoredReview {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.createdAt === "number" &&
    typeof v.updatedAt === "number" &&
    typeof v.thesis === "string" &&
    typeof v.card === "object" &&
    v.card !== null &&
    typeof v.verdict === "object" &&
    v.verdict !== null &&
    Array.isArray(v.verdictHistory) &&
    Array.isArray(v.sources) &&
    Array.isArray(v.feed)
  );
}

// Coerce the loosely-typed fields to their canonical form. Runs on both
// localStorage reads and imported files, so a hand-edited or older export
// can't smuggle a bad `stress`/`transcript`/flag through.
function normalizeReview(entry: StoredReview): StoredReview {
  return {
    ...entry,
    demo: entry.demo === true,
    stress: entry.stress === "upheld" || entry.stress === "withdrawn" ? entry.stress : null,
    transcript: Array.isArray(entry.transcript) ? entry.transcript : null,
    invalidationClosed: entry.invalidationClosed === true,
  };
}

export function loadHistory(): StoredReview[] {
  if (typeof window === "undefined") return [];
  let parsed: unknown;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(isStoredReview)
    .map(normalizeReview)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

// Write through, shedding weight instead of failing: transcripts beyond the
// newest few are dropped up front; on a quota error the oldest remaining
// transcript goes first, then whole oldest entries. Returns what was actually
// kept so the UI mirrors storage.
function persist(entries: StoredReview[]): StoredReview[] {
  let list = entries
    .slice(0, MAX_ENTRIES)
    .map((entry, i) =>
      i >= TRANSCRIPTS_KEPT && entry.transcript ? { ...entry, transcript: null } : entry,
    );
  if (typeof window === "undefined") return list;
  for (;;) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(list));
      return list;
    } catch {
      let oldestWithTranscript = -1;
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].transcript) {
          oldestWithTranscript = i;
          break;
        }
      }
      if (oldestWithTranscript >= 0) {
        list = list.map((entry, i) =>
          i === oldestWithTranscript ? { ...entry, transcript: null } : entry,
        );
      } else if (list.length > 1) {
        list = list.slice(0, -1);
      } else {
        // Storage is unusable even for one bare entry; keep the in-memory view.
        return list;
      }
    }
  }
}

export function upsertReview(entry: StoredReview): StoredReview[] {
  const current = loadHistory();
  const existing = current.find((e) => e.id === entry.id);
  const merged = existing ? { ...entry, createdAt: existing.createdAt } : entry;
  return persist([merged, ...current.filter((e) => e.id !== entry.id)]);
}

export function deleteReview(id: string): StoredReview[] {
  return persist(loadHistory().filter((e) => e.id !== id));
}

export function closeInvalidation(id: string): StoredReview[] {
  return persist(
    loadHistory().map((e) => (e.id === id ? { ...e, invalidationClosed: true } : e)),
  );
}

// ---------------------------------------------------------------------------
// Backup / restore — a plain JSON file, no accounts. Lets a review survive a
// cleared browser or move to another machine.
// ---------------------------------------------------------------------------

const BACKUP_FORMAT = "veto-history";
const BACKUP_VERSION = 1;

interface HistoryBackup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: number;
  reviews: StoredReview[];
}

export function exportHistory(now: number): string {
  const backup: HistoryBackup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now,
    reviews: loadHistory(),
  };
  return JSON.stringify(backup, null, 2);
}

export interface ImportResult {
  history: StoredReview[];
  added: number;
  updated: number;
  skipped: number;
}

// Accepts either a wrapped backup ({format, reviews}) or a bare array, so a
// file that predates the wrapper still restores. Merges by id: an incoming
// review wins only if it is strictly newer, and it keeps the original
// createdAt. Same-or-older ids are counted as skipped.
export function importHistory(text: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  const raw = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" &&
        parsed !== null &&
        Array.isArray((parsed as { reviews?: unknown }).reviews)
      ? (parsed as { reviews: unknown[] }).reviews
      : null;
  if (!raw) throw new Error("That file isn't a Veto history backup.");

  const incoming = raw.filter(isStoredReview).map(normalizeReview);
  if (incoming.length === 0) throw new Error("No reviews found in that backup.");

  const byId = new Map(loadHistory().map((e) => [e.id, e]));
  let added = 0;
  let updated = 0;
  let skipped = 0;
  for (const entry of incoming) {
    const existing = byId.get(entry.id);
    if (!existing) {
      byId.set(entry.id, entry);
      added += 1;
    } else if (entry.updatedAt > existing.updatedAt) {
      byId.set(entry.id, { ...entry, createdAt: existing.createdAt });
      updated += 1;
    } else {
      skipped += 1;
    }
  }
  const merged = [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  return { history: persist(merged), added, updated, skipped };
}

export function backupFilename(now: number): string {
  const d = new Date(now);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `veto-history-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
}
