import type { EngineEvent } from "./types";

// A canned review of a FICTIONAL ticker, so visitors can watch the full flow
// without an API key. The case is didactic on purpose: a load-bearing premise
// that turns out to be a letter of intent, not a signed contract — the exact
// class of error the desk exists to catch.
export const DEMO_EVENTS: EngineEvent[] = [
  { t: "stage", v: "structuring" },
  {
    t: "card",
    v: {
      ticker: "HLCN",
      company: "Halcyon Robotics (fictional — sample review)",
      direction: "long",
      horizon: "3-6 months",
      thesis_summary:
        "Trader expects a re-rating after Halcyon's announced defense contract: a claimed $400M multi-year award from the US Army, a valuation below 10x forward earnings, and squeeze fuel from ~30% short interest. Target +50% in 3-6 months; stated exit below $22.",
      premises: [
        {
          id: "P1",
          claim: "Halcyon signed a $400M multi-year contract with the US Army in June 2026.",
          load_bearing: true,
        },
        {
          id: "P2",
          claim: "Halcyon trades below 10x forward earnings.",
          load_bearing: true,
        },
        {
          id: "P3",
          claim: "Short interest is above 30% of float.",
          load_bearing: false,
        },
      ],
      stated_invalidation: "Close below $22.",
    },
  },
  { t: "stage", v: "verifying" },
  { t: "text", v: "Sample review of a fictional ticker — illustrative only.\n" },
  { t: "search", v: "Halcyon Robotics US Army contract $400M June 2026" },
  {
    t: "text",
    v: "P1: the June press release announces a letter of intent, not a signed contract. Checking procurement records.\n",
  },
  { t: "fetch", v: "https://ir.halcyon-robotics.example/press/2026-06-12" },
  {
    t: "text",
    v: "No award in official procurement records. \"Agreed\" is not \"signed\" — P1 is FALSE.\n",
  },
  { t: "search", v: "HLCN forward earnings estimates 2026" },
  {
    t: "text",
    v: "P2: consensus puts it near 12x forward, not sub-10x. Directionally cheap, overstated — PARTIAL.\n",
  },
  { t: "search", v: "HLCN short interest percent of float" },
  { t: "text", v: "P3: ~31% of float per exchange data — CONFIRMED.\n" },
  { t: "search", v: "Halcyon Robotics insider transactions" },
  {
    t: "text",
    v: "Sweep: CFO sold two weeks after the LOI. Announcement-day gap of +18% suggests the \"contract\" is partly priced in.\n",
  },
  {
    t: "sources",
    v: [
      {
        url: "https://ir.halcyon-robotics.example/press/2026-06-12",
        title: "Halcyon Robotics announces letter of intent with US Army",
        cited: true,
      },
      {
        url: "https://procurement.records.example/search?vendor=halcyon",
        title: "Federal procurement records — vendor search",
        cited: true,
      },
      {
        url: "https://marketdata.example/HLCN/estimates",
        title: "HLCN consensus estimates",
        cited: true,
      },
      {
        url: "https://exchange.example/HLCN/short-interest",
        title: "HLCN short interest report",
        cited: true,
      },
      {
        url: "https://filings.example/halcyon/insider-transactions",
        title: "Halcyon Robotics insider transactions",
        cited: true,
      },
    ],
  },
  { t: "stage", v: "verdict" },
  {
    t: "verdict",
    v: {
      premise_verdicts: [
        {
          id: "P1",
          verdict: "FALSE",
          evidence:
            "The June press release announces a letter of intent, not a signed contract; no award appears in official procurement records.",
          source_urls: [
            "https://ir.halcyon-robotics.example/press/2026-06-12",
            "https://procurement.records.example/search?vendor=halcyon",
          ],
        },
        {
          id: "P2",
          verdict: "PARTIAL",
          evidence:
            "Consensus forward multiple is ~12x, not below 10x. Directionally right, overstated.",
          source_urls: ["https://marketdata.example/HLCN/estimates"],
        },
        {
          id: "P3",
          verdict: "CONFIRMED",
          evidence: "Short interest ~31% of float per exchange data.",
          source_urls: ["https://exchange.example/HLCN/short-interest"],
        },
      ],
      bear_case:
        "The re-rating case rests on a contract that does not exist yet. If the LOI stalls or shrinks, the stock re-prices on a broken narrative — and the squeeze fuel cuts both ways on the way down.",
      bear_case_source_urls: [
        "https://filings.example/halcyon/insider-transactions",
        "https://ir.halcyon-robotics.example/press/2026-06-12",
      ],
      red_flags: [
        "CFO sold shares two weeks after the LOI announcement.",
        "The +18% move on announcement day suggests the claimed catalyst is already partly priced in.",
      ],
      verdict: "REFUSED",
      verdict_reason:
        "Desk rule 1: load-bearing premise P1 is FALSE — the \"contract\" is a letter of intent, not a signed award. An overstated valuation premise compounds it. A squeeze setup stacked on a false premise is a coin flip, not a thesis.",
      what_would_need_to_be_true: [
        "A definitive signed contract in a primary source (procurement record or 8-K), not a press-release LOI.",
        "A forward multiple actually below the peer group after the estimate revision cycle.",
      ],
      suggested_invalidation:
        "If no definitive contract is announced by the end of Q3 2026, the thesis is dead regardless of price.",
    },
  },
];

export const DEMO_DELAYS: Record<EngineEvent["t"], number> = {
  stage: 500,
  card: 700,
  text: 850,
  search: 650,
  fetch: 650,
  sources: 300,
  verdict: 400,
  error: 0,
  done: 0,
};
