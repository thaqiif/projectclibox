import { NextRequest, NextResponse } from "next/server";
import { guardJsonRequiredSameOrigin } from "@/lib/route-guards";
import { issueTerminalCapability } from "@/lib/terminal-capabilities";

export async function POST(request: NextRequest) {
  const guard = guardJsonRequiredSameOrigin(request);
  if (guard) return guard;

  const body = await request.json().catch(() => null);
  const sessionName =
    body && typeof body === "object" && "sessionName" in body
      ? (body as { sessionName?: unknown }).sessionName
      : null;
  if (typeof sessionName !== "string") {
    return NextResponse.json(
      { error: "sessionName is required" },
      { status: 400 }
    );
  }

  try {
    const token = await issueTerminalCapability(sessionName);
    return NextResponse.json(
      { token, expiresIn: 60 },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not authorize terminal";
    const status =
      message === "Terminal session is not live" ? 404 : message.startsWith("Too many") ? 429 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
