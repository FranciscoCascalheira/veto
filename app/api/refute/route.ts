import Anthropic from "@anthropic-ai/sdk";
import type { NextRequest } from "next/server";
import { runRefutation } from "@/lib/engine";
import { DEMO_DELAYS, DEMO_EVENTS } from "@/lib/demo";

export const runtime = "nodejs";
export const maxDuration = 300;

const FREE_RUNS_PER_DAY = Number(process.env.FREE_RUNS_PER_DAY ?? 3);

// Per-IP daily counter for the optional server-key free tier. In-memory on
// purpose for v1: resets on redeploy and is per-instance on serverless.
const usage = new Map<string, { day: string; count: number }>();

function consumeFreeRun(ip: string): boolean {
  const day = new Date().toISOString().slice(0, 10);
  const entry = usage.get(ip);
  if (!entry || entry.day !== day) {
    usage.set(ip, { day, count: 1 });
    return true;
  }
  if (entry.count >= FREE_RUNS_PER_DAY) return false;
  entry.count += 1;
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

function demoResponse(): Response {
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
      for (const event of DEMO_EVENTS) {
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
  const body = (await req.json().catch(() => ({}))) as {
    thesis?: unknown;
    demo?: unknown;
  };
  if (body.demo === true) return demoResponse();
  const thesis = typeof body.thesis === "string" ? body.thesis.trim() : "";
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
        for await (const event of runRefutation(client, thesis)) {
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
