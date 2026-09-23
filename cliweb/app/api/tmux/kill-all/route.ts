import { NextResponse } from "next/server";
import { killTerminal } from "@/lib/terminals";
import { forgetTerminal, listKnownTerminals } from "@/lib/terminal-registry";
import { guardJsonSameOrigin } from "@/lib/route-guards";

/**
 * POST /api/tmux/kill-all - close every terminal for good.
 *
 * Closing a single terminal kills tmux and forgets the registry entry so it
 * leaves the sidebar. Close-all used to kill tmux only, which left every
 * terminal sitting in the list as a restartable ghost. Forget the same
 * entries the sidebar is showing, live or already stopped.
 */
export async function POST(request: Request) {
  const guard = guardJsonSameOrigin(request);
  if (guard) return guard;

  try {
    const terminals = await listKnownTerminals();
    const killed: string[] = [];

    for (const terminal of terminals) {
      try {
        await killTerminal(terminal.name);
      } catch {
        // Already gone, or died while we were iterating. Either is fine.
      }
      forgetTerminal(terminal.name);
      killed.push(terminal.name);
    }

    return NextResponse.json({ killed: killed.length, terminals: killed });
  } catch (error) {
    console.error("Error killing terminals:", error);
    return NextResponse.json(
      { error: "Failed to close terminals" },
      { status: 500 }
    );
  }
}
