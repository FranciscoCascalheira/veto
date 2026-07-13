export type Direction = "long" | "short";
export type PremiseState = "CONFIRMED" | "PARTIAL" | "FALSE" | "UNVERIFIABLE";
export type FinalVerdict = "BLESSED" | "REFUSED";

export interface Premise {
  id: string;
  claim: string;
  load_bearing: boolean;
}

export interface TradeCard {
  ticker: string;
  company: string;
  direction: Direction;
  horizon: string;
  thesis_summary: string;
  premises: Premise[];
  stated_invalidation: string | null;
}

export interface PremiseVerdict {
  id: string;
  verdict: PremiseState;
  evidence: string;
  source_urls: string[];
}

export interface Verdict {
  premise_verdicts: PremiseVerdict[];
  bear_case: string;
  bear_case_source_urls: string[];
  red_flags: string[];
  verdict: FinalVerdict;
  verdict_reason: string;
  what_would_need_to_be_true: string[];
  suggested_invalidation: string;
}

// A source the engine actually observed during the run: a search result the
// desk saw, a page it fetched, or a passage it cited. `cited` marks sources
// that were consulted (fetched or cited), not merely listed in search results.
export interface SourceRef {
  url: string;
  title: string | null;
  cited: boolean;
}

export type EngineEvent =
  | { t: "stage"; v: "structuring" | "verifying" | "verdict" }
  | { t: "card"; v: TradeCard }
  | { t: "text"; v: string }
  | { t: "search"; v: string }
  | { t: "fetch"; v: string }
  | { t: "sources"; v: SourceRef[] }
  | { t: "verdict"; v: Verdict }
  // Opaque conversation history, held client-side (no server storage) and
  // returned verbatim with an argue-back challenge to continue the review.
  | { t: "transcript"; v: unknown[] }
  | { t: "error"; v: string }
  | { t: "done" };
