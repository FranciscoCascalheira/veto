import Anthropic from "@anthropic-ai/sdk";
import type { EngineEvent, SourceRef, TradeCard, Verdict } from "./types";
import { STRUCTURE_SYSTEM, VERIFY_SYSTEM, verifyBrief } from "./prompts";

const MODEL = "claude-opus-4-8";
const MAX_LOOP_ITERATIONS = 8;

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

export async function* runRefutation(
  client: Anthropic,
  thesis: string,
): AsyncGenerator<EngineEvent> {
  yield { t: "stage", v: "structuring" };
  const card = await structureCard(client, thesis);
  yield { t: "card", v: card };

  yield { t: "stage", v: "verifying" };

  const tools = buildTools();
  const messages: Anthropic.Messages.MessageParam[] = [
    { role: "user", content: verifyBrief(card, thesis) },
  ];

  let verdict: Verdict | null = null;
  let forcedFinal = false;

  // Every source the desk actually touched, keyed by URL. Search results are
  // recorded as seen (cited=false); fetched pages and cited passages are
  // upgraded to cited=true. This is the ground truth the UI resolves the
  // model-reported source_urls against.
  const sources = new Map<string, SourceRef>();
  const recordSource = (url: string, title: string | null, cited: boolean) => {
    const existing = sources.get(url);
    if (existing) {
      if (title && !existing.title) existing.title = title;
      if (cited) existing.cited = true;
    } else {
      sources.set(url, { url, title, cited });
    }
  };
  const harvestSources = (content: Anthropic.Messages.ContentBlock[]) => {
    for (const block of content) {
      if (block.type === "web_search_tool_result") {
        if (Array.isArray(block.content)) {
          for (const result of block.content) {
            recordSource(result.url, result.title, false);
          }
        }
      } else if (block.type === "web_fetch_tool_result") {
        if ("type" in block.content && block.content.type === "web_fetch_result") {
          recordSource(block.content.url, block.content.content.title, true);
        }
      } else if (block.type === "text" && block.citations) {
        for (const citation of block.citations) {
          if (citation.type === "web_search_result_location") {
            recordSource(citation.url, citation.title, true);
          }
        }
      }
    }
  };

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
    harvestSources(message.content);
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
        verdict = verdictBlock.input as Verdict;
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

  if (!verdict) {
    yield { t: "error", v: "The reviewer finished without submitting a verdict. Run it again." };
    return;
  }

  if (sources.size > 0) {
    // Cited sources first so the UI's url->title map favors what was read.
    yield {
      t: "sources",
      v: [...sources.values()].sort((a, b) => Number(b.cited) - Number(a.cited)),
    };
  }
  yield { t: "stage", v: "verdict" };
  yield { t: "verdict", v: verdict };
}
