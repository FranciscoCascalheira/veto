import Anthropic from "@anthropic-ai/sdk";
import type { EngineEvent, SourceRef, StressOutcome, TradeCard, Verdict } from "./types";
import { STRUCTURE_SYSTEM, VERIFY_SYSTEM, argueBrief, stressBrief, verifyBrief } from "./prompts";

const MODEL = "claude-opus-4-8";
// The stress round adds up to two extra turns (attack + possible pause_turn)
// on top of the ordinary verify loop.
const MAX_LOOP_ITERATIONS = 10;

const CARD_JSON_SCHEMA: Anthropic.Messages.Tool.InputSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "ticker",
    "company",
    "direction",
    "horizon",
    "thesis_summary",
    "premises",
    "stated_invalidation",
  ],
  properties: {
    ticker: {
      type: "string",
      description:
        "Primary ticker symbol in uppercase. If the user did not name a listed security, use the closest identifier they gave.",
    },
    company: { type: "string" },
    direction: { type: "string", enum: ["long", "short"] },
    horizon: {
      type: "string",
      description:
        "Holding horizon as stated by the user, or a conservative inference such as '3-6 months'.",
    },
    thesis_summary: {
      type: "string",
      description:
        "Faithful one-paragraph restatement of the user's argument. Note explicitly if the thesis is vague.",
    },
    premises: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "claim", "load_bearing"],
        properties: {
          id: { type: "string", description: "P1, P2, ..." },
          claim: {
            type: "string",
            description:
              "One specific, falsifiable factual claim the thesis depends on. Never an opinion.",
          },
          load_bearing: {
            type: "boolean",
            description: "True if the thesis collapses when this claim is false.",
          },
        },
      },
    },
    stated_invalidation: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description:
        "The user's own stop/invalidation condition if they stated one, else null.",
    },
  },
};

const VERDICT_JSON_SCHEMA: Anthropic.Messages.Tool.InputSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "premise_verdicts",
    "bear_case",
    "bear_case_source_urls",
    "red_flags",
    "verdict",
    "verdict_reason",
    "what_would_need_to_be_true",
    "suggested_invalidation",
  ],
  properties: {
    premise_verdicts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "verdict", "evidence", "source_urls"],
        properties: {
          id: { type: "string", description: "Premise id from the card (P1, P2, ...)." },
          verdict: {
            type: "string",
            enum: ["CONFIRMED", "PARTIAL", "FALSE", "UNVERIFIABLE"],
          },
          evidence: {
            type: "string",
            description:
              "What fresh sources showed, naming the sources. For UNVERIFIABLE, what was searched and not found.",
          },
          source_urls: {
            type: "array",
            items: { type: "string" },
            description:
              "URLs of the sources this classification rests on, copied verbatim from search or fetch results used in this review. Never construct, guess, or shorten a URL. Empty when no source was used (e.g. UNVERIFIABLE with nothing found).",
          },
        },
      },
    },
    bear_case: {
      type: "string",
      description: "The strongest argument against this thesis, stated plainly.",
    },
    bear_case_source_urls: {
      type: "array",
      items: { type: "string" },
      description:
        "URLs supporting the bear case and adversarial sweep findings, copied verbatim from search or fetch results used in this review. Never construct, guess, or shorten a URL. Empty if none.",
    },
    red_flags: {
      type: "array",
      items: { type: "string" },
      description:
        "Findings from the adversarial sweep (insider selling, dilution, short interest, valuation stretch, catalyst already priced in). Empty only after actually looking.",
    },
    verdict: { type: "string", enum: ["BLESSED", "REFUSED"] },
    verdict_reason: {
      type: "string",
      description:
        "Why this verdict, citing the desk rules applied. About the argument, never the security.",
    },
    what_would_need_to_be_true: {
      type: "array",
      items: { type: "string" },
      description:
        "Concrete conditions under which a refused card would earn a blessing, or a blessed card would keep it.",
    },
    suggested_invalidation: {
      type: "string",
      description:
        "One checkable condition (event, level, date) that should kill the trade if it happens.",
    },
  },
};

function buildTools(): Anthropic.Messages.ToolUnion[] {
  return [
    { type: "web_search_20260209", name: "web_search", max_uses: 8 },
    { type: "web_fetch_20260209", name: "web_fetch", max_uses: 5, max_content_tokens: 30000 },
    {
      name: "submit_verdict",
      description:
        "Submit the final review verdict for this trade card. Call exactly once, after all premises are classified and the adversarial sweep is complete.",
      strict: true,
      input_schema: VERDICT_JSON_SCHEMA,
    },
  ];
}

async function structureCard(client: Anthropic, thesis: string): Promise<TradeCard> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: STRUCTURE_SYSTEM,
    messages: [{ role: "user", content: thesis }],
    output_config: {
      format: { type: "json_schema", schema: CARD_JSON_SCHEMA },
    },
  });
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Could not structure the thesis into a trade card.");
  }
  return JSON.parse(textBlock.text) as TradeCard;
}

// Every source the desk actually touched, keyed by URL. Search results are
// recorded as seen (cited=false); fetched pages and cited passages are
// upgraded to cited=true. This is the ground truth the UI resolves the
// model-reported source_urls against.
function recordSource(
  sources: Map<string, SourceRef>,
  url: string,
  title: string | null,
  cited: boolean,
) {
  const existing = sources.get(url);
  if (existing) {
    if (title && !existing.title) existing.title = title;
    if (cited) existing.cited = true;
  } else {
    sources.set(url, { url, title, cited });
  }
}

// Runs on live ContentBlock[] and on client-round-tripped transcript blocks
// alike, so every check is structural rather than typed.
function harvestSources(sources: Map<string, SourceRef>, content: unknown) {
  if (!Array.isArray(content)) return;
  for (const raw of content) {
    if (typeof raw !== "object" || raw === null) continue;
    const block = raw as { type?: unknown; content?: unknown; citations?: unknown };
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const result of block.content as Array<{ url?: unknown; title?: unknown }>) {
        if (typeof result.url === "string") {
          recordSource(
            sources,
            result.url,
            typeof result.title === "string" ? result.title : null,
            false,
          );
        }
      }
    } else if (
      block.type === "web_fetch_tool_result" &&
      typeof block.content === "object" &&
      block.content !== null
    ) {
      const fetched = block.content as {
        type?: unknown;
        url?: unknown;
        content?: { title?: unknown } | null;
      };
      if (fetched.type === "web_fetch_result" && typeof fetched.url === "string") {
        const title =
          fetched.content &&
          typeof fetched.content === "object" &&
          typeof fetched.content.title === "string"
            ? fetched.content.title
            : null;
        recordSource(sources, fetched.url, title, true);
      }
    } else if (block.type === "text" && Array.isArray(block.citations)) {
      for (const citation of block.citations as Array<{
        type?: unknown;
        url?: unknown;
        title?: unknown;
      }>) {
        if (
          citation.type === "web_search_result_location" &&
          typeof citation.url === "string"
        ) {
          recordSource(
            sources,
            citation.url,
            typeof citation.title === "string" ? citation.title : null,
            true,
          );
        }
      }
    }
  }
}

// The verify/attack loop. Appends to `messages` in place — including the
// closing tool_result for submit_verdict, so the finished transcript can be
// continued with a follow-up user turn (argue-back) without a dangling
// tool call. Returns the verdict (and the stress-test outcome, when a
// preliminary blessing was attacked) via the generator's return value.
async function* runVerifyLoop(
  client: Anthropic,
  messages: Anthropic.Messages.MessageParam[],
  sources: Map<string, SourceRef>,
): AsyncGenerator<EngineEvent, { verdict: Verdict | null; stress: StressOutcome | null }> {
  const tools = buildTools();
  let verdict: Verdict | null = null;
  let forcedFinal = false;
  let stressed = false;

  for (let iteration = 0; iteration < MAX_LOOP_ITERATIONS && !verdict; iteration++) {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      system: VERIFY_SYSTEM,
      tools,
      messages,
      // Forced tool choice is only used for the final nudge; thinking stays on
      // for the analysis turns.
      ...(forcedFinal
        ? { tool_choice: { type: "tool" as const, name: "submit_verdict" } }
        : { thinking: { type: "adaptive" as const } }),
    });

    // Track tool_use blocks by index so their streamed inputs can be surfaced
    // (search queries, fetched URLs) as they happen.
    const pendingToolInputs = new Map<number, { name: string; json: string }>();

    for await (const event of stream) {
      if (event.type === "content_block_start") {
        const block = event.content_block;
        if (block.type === "server_tool_use" || block.type === "tool_use") {
          pendingToolInputs.set(event.index, { name: block.name, json: "" });
        }
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          yield { t: "text", v: event.delta.text };
        } else if (event.delta.type === "input_json_delta") {
          const pending = pendingToolInputs.get(event.index);
          if (pending) pending.json += event.delta.partial_json;
        }
      } else if (event.type === "content_block_stop") {
        const pending = pendingToolInputs.get(event.index);
        if (pending) {
          pendingToolInputs.delete(event.index);
          if (pending.name === "web_search" || pending.name === "web_fetch") {
            try {
              const input = JSON.parse(pending.json || "{}") as Record<string, unknown>;
              if (pending.name === "web_search" && input.query) {
                yield { t: "search", v: String(input.query) };
              } else if (pending.name === "web_fetch" && input.url) {
                yield { t: "fetch", v: String(input.url) };
              }
            } catch {
              // Partial tool input that failed to parse — nothing to surface.
            }
          }
        }
      }
    }

    const message = await stream.finalMessage();
    harvestSources(sources, message.content);
    messages.push({ role: "assistant", content: message.content });

    if (message.stop_reason === "pause_turn") {
      // Server-side tool loop paused; re-send to let it resume.
      continue;
    }

    if (message.stop_reason === "tool_use") {
      const verdictBlock = message.content.find(
        (b) => b.type === "tool_use" && b.name === "submit_verdict",
      );
      if (verdictBlock && verdictBlock.type === "tool_use") {
        const submitted = verdictBlock.input as Verdict;
        // House rule: no blessing leaves the desk untested. The first BLESSED
        // of a round is logged, not delivered — the desk attacks it once and
        // resubmits. Refusals ship as-is (default-to-protection covers them),
        // and a forced-final submission is never reopened.
        if (submitted.verdict === "BLESSED" && !stressed && !forcedFinal) {
          stressed = true;
          messages.push({
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: verdictBlock.id,
                content: "Preliminary verdict logged, not delivered. Instructions follow.",
              },
              { type: "text", text: stressBrief() },
            ],
          });
          yield { t: "stress", v: "begin" };
          continue;
        }
        verdict = submitted;
        messages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: verdictBlock.id,
              content: "Verdict recorded and delivered to the trader.",
            },
          ],
        });
        break;
      }
    }

    if (!forcedFinal) {
      // Finished talking without submitting — force the verdict once.
      forcedFinal = true;
      messages.push({
        role: "user",
        content: "Submit your verdict now by calling the submit_verdict tool.",
      });
    } else {
      break;
    }
  }

  const stress: StressOutcome | null =
    stressed && verdict ? (verdict.verdict === "BLESSED" ? "upheld" : "withdrawn") : null;
  return { verdict, stress };
}

async function* emitOutcome(
  verdict: Verdict,
  sources: Map<string, SourceRef>,
  messages: Anthropic.Messages.MessageParam[],
  stress: StressOutcome | null,
): AsyncGenerator<EngineEvent> {
  if (sources.size > 0) {
    // Cited sources first so the UI's url->title map favors what was read.
    yield {
      t: "sources",
      v: [...sources.values()].sort((a, b) => Number(b.cited) - Number(a.cited)),
    };
  }
  yield { t: "stage", v: "verdict" };
  // Outcome before the verdict, so the UI knows it as the verdict renders.
  if (stress) yield { t: "stress", v: stress };
  yield { t: "verdict", v: verdict };
  // The conversation so far, held by the client (no server-side storage) and
  // sent back verbatim to continue the review with an argue-back turn.
  yield { t: "transcript", v: messages };
}

export async function* runRefutation(
  client: Anthropic,
  thesis: string,
): AsyncGenerator<EngineEvent> {
  yield { t: "stage", v: "structuring" };
  const card = await structureCard(client, thesis);
  yield { t: "card", v: card };

  yield { t: "stage", v: "verifying" };

  const messages: Anthropic.Messages.MessageParam[] = [
    { role: "user", content: verifyBrief(card, thesis) },
  ];
  const sources = new Map<string, SourceRef>();
  const { verdict, stress } = yield* runVerifyLoop(client, messages, sources);

  if (!verdict) {
    yield { t: "error", v: "The reviewer finished without submitting a verdict. Run it again." };
    return;
  }
  yield* emitOutcome(verdict, sources, messages, stress);
}

// Shallow structural check on a client-held transcript before it goes back to
// the API. Deeper garbage is rejected by the API itself and surfaced as an
// error event; this only blocks obviously malformed or oversized payloads.
export function asTranscript(value: unknown): Anthropic.Messages.MessageParam[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 80) return null;
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) return null;
    const { role, content } = entry as { role?: unknown; content?: unknown };
    if (role !== "user" && role !== "assistant") return null;
    if (typeof content !== "string" && !Array.isArray(content)) return null;
  }
  if ((value[0] as { role: string }).role !== "user") return null;
  return value as Anthropic.Messages.MessageParam[];
}

export async function* runArgueBack(
  client: Anthropic,
  transcript: Anthropic.Messages.MessageParam[],
  challenge: string,
): AsyncGenerator<EngineEvent> {
  yield { t: "stage", v: "verifying" };

  // Re-harvest the whole prior conversation so sources from earlier rounds
  // still resolve to titles in the updated verdict.
  const sources = new Map<string, SourceRef>();
  for (const message of transcript) {
    if (message.role === "assistant") harvestSources(sources, message.content);
  }

  const messages: Anthropic.Messages.MessageParam[] = [
    ...transcript,
    { role: "user", content: argueBrief(challenge) },
  ];
  const { verdict, stress } = yield* runVerifyLoop(client, messages, sources);

  if (!verdict) {
    yield {
      t: "error",
      v: "The reviewer finished without submitting an updated verdict. Contest it again.",
    };
    return;
  }
  yield* emitOutcome(verdict, sources, messages, stress);
}
