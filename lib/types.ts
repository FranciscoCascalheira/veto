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
}

export interface Verdict {
  premise_verdicts: PremiseVerdict[];
  bear_case: string;
  red_flags: string[];
  verdict: FinalVerdict;
  verdict_reason: string;
  what_would_need_to_be_true: string[];
  suggested_invalidation: string;
}

export type EngineEvent =
  | { t: "stage"; v: "structuring" | "verifying" | "verdict" }
  | { t: "card"; v: TradeCard }
  | { t: "text"; v: string }
  | { t: "search"; v: string }
  | { t: "fetch"; v: string }
  | { t: "verdict"; v: Verdict }
  | { t: "error"; v: string }
  | { t: "done" };
