import Anthropic from "@anthropic-ai/sdk";
import type { NextRequest } from "next/server";
import { asTranscript, runArgueBack, runRefutation } from "@/lib/engine";
import { DEMO_ARGUE_EVENTS, DEMO_DELAYS, DEMO_EVENTS } from "@/lib/demo";
import type { EngineEvent } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const FREE_RUNS_PER_DAY = Number(process.env.FREE_RUNS_PER_DAY ?? 3);
const FREE_RUNS_GLOBAL_PER_DAY = Number(process.env.FREE_RUNS_GLOBAL_PER_DAY ?? 25);

// Per-IP and global daily counters for the optional server-key free tier.
// In-memory on purpose for v1: resets on redeploy. The public URL is
// scannable, so keyless runs are bounded twice (per IP and globally) and,
// when FRIENDS_CODE is set, gated behind a shared access code.
const usage = new Map<string, { day: string; count: number }>();
let globalUsage = { day: "", count: 0 };

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function consumeFreeRun(ip: string): boolean {
  const day = today();
  const entry = usage.get(ip);
  if (!entry || entry.day !== day) {
    usage.set(ip, { day, count: 1 });
    return true;
  }
  if (entry.count >= FREE_RUNS_PER_DAY) return false;
  entry.count += 1;
  return true;
}

function consumeGlobalRun(): boolean {
  const day = today();
  if (globalUsage.day !== day) globalUsage = { day, count: 0 };
  if (globalUsage.count >= FREE_RUNS_GLOBAL_PER_DAY) return false;
  globalUsage.count += 1;
  return true;
}

function errorMessage(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return "Anthropic rejected the API key. Check the key and try again.";
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return "This API key does not have access to the model.";
  }
  if (err instanceof Anthropic.RateLimitError) {
    return "Rate limited by Anthropic. Wait a minute and retry.";
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return "Could not reach the Anthropic API.";
  }
  if (err instanceof Anthropic.APIError) {
    return `Anthropic API error${err.status ? ` (${err.status})` : ""}: ${err.message}`;
  }
  return err instanceof Error ? err.message : "Unexpected error.";
}

function demoResponse(events: EngineEvent[]): Response {
  const encoder = new TextEncoder();
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const stream = new ReadableStream({
    async start(controller) {
      // enqueue throws once the client disconnects; treat that as "stop".
      const send = (obj: unknown): boolean => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
          return true;
        } catch {
          return false;
        }
      };
      for (const event of events) {
        await sleep(DEMO_DELAYS[event.t]);
        if (!send(event)) return;
      }
      send({ t: "done" });
      try {
        controller.close();
      } catch {
        // already closed by disconnect
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

export async function POST(req: NextRequest) {
  // Transcripts round-trip the full conversation (search results included),
  // so bodies can be large — but not unbounded.
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > 5_000_000) {
    return Response.json({ error: "Request too large." }, { status: 413 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    thesis?: unknown;
    demo?: unknown;
    code?: unknown;
    challenge?: unknown;
    transcript?: unknown;
  };
  const challenge = typeof body.challenge === "string" ? body.challenge.trim() : "";
  const isArgue = challenge.length > 0;

  if (body.demo === true) {
    return demoResponse(isArgue ? DEMO_ARGUE_EVENTS : DEMO_EVENTS);
  }

  const thesis = typeof body.thesis === "string" ? body.thesis.trim() : "";
  let transcript: Anthropic.Messages.MessageParam[] | null = null;
  if (isArgue) {
    if (challenge.length < 10) {
      return Response.json(
        { error: "Bring a real challenge — a fact the desk can check." },
        { status: 400 },
      );
    }
    if (challenge.length > 3000) {
      return Response.json(
        { error: "Challenge too long — keep it under 3000 characters." },
        { status: 400 },
      );
    }
    transcript = asTranscript(body.transcript);
    if (!transcript) {
      return Response.json(
        { error: "This review can no longer be contested. Run it again." },
        { status: 400 },
      );
    }
  } else {
    if (thesis.length < 20) {
      return Response.json(
        { error: "Write a real thesis — at least a couple of sentences." },
        { status: 400 },
      );
    }
    if (thesis.length > 8000) {
      return Response.json(
        { error: "Thesis too long — keep it under 8000 characters." },
        { status: 400 },
      );
    }
  }

  const byok = req.headers.get("x-anthropic-api-key")?.trim();
  let apiKey = byok ?? "";
  if (!apiKey) {
    const serverKey = process.env.ANTHROPIC_API_KEY;
    if (!serverKey) {
      return Response.json(
        { error: "No API key. Paste your Anthropic API key to run Veto." },
        { status: 401 },
      );
    }
    const friendsCode = process.env.FRIENDS_CODE?.trim();
    if (friendsCode) {
      const given = typeof body.code === "string" ? body.code.trim() : "";
      if (given !== friendsCode) {
        return Response.json(
          {
            error:
              "Free runs on this site need an access code. Enter it below, or use your own Anthropic API key.",
          },
          { status: 401 },
        );
      }
    }
    if (!consumeGlobalRun()) {
      return Response.json(
        {
          error:
            "The site's free-run budget for today is spent. Bring your own Anthropic API key to continue.",
        },
        { status: 429 },
      );
    }
    const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
    if (!consumeFreeRun(ip)) {
      return Response.json(
        { error: "Free runs for today are used up. Bring your own Anthropic API key to continue." },
        { status: 429 },
      );
    }
    apiKey = serverKey;
  }

  const client = new Anthropic({ apiKey });
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // enqueue throws once the client disconnects; swallow it so a mid-run
      // disconnect doesn't surface as an unhandled rejection.
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          // client gone — nothing left to deliver to
        }
      };
      try {
        const run = transcript
          ? runArgueBack(client, transcript, challenge)
          : runRefutation(client, thesis);
        for await (const event of run) {
          send(event);
        }
        send({ t: "done" });
      } catch (err) {
        send({ t: "error", v: errorMessage(err) });
      } finally {
        try {
          controller.close();
        } catch {
          // already closed by disconnect
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
