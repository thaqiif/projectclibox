import { NextResponse } from "next/server";
import { listTerminals, killTerminal } from "@/lib/terminals";

/**
 * POST /api/tmux/kill-all - close every terminal.
 *
 * This used to kill only terminals whose names matched AgentOS's own naming
 * scheme, then sweep a database table to match. Terminals are just tmux
 * workspaces now, with no rows to clean up and no notion of "managed": what
 * the sidebar lists is what this closes.
 */
export async function POST() {
  try {
    const terminals = await listTerminals();
    const killed: string[] = [];

    for (const terminal of terminals) {
      try {
        await killTerminal(terminal.name);
        killed.push(terminal.name);
      } catch {
        // Already gone, or died while we were iterating. Either is fine.
      }
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
