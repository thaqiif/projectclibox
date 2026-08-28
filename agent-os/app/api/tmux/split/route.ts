import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * POST /api/tmux/split - split the attached tmux terminal's active pane.
 *
 * Splitting is delegated to tmux rather than done in the browser layout.
 * A React-side split only existed in one tab's memory, so it evaporated on
 * refresh; a tmux split is part of the terminal's own window layout and is
 * still there when you re-attach, from this browser or any other client.
 *
 * "Split horizontal" puts the new pane to the right, which is tmux's -h;
 * "split vertical" puts it below, which is -v. The mapping used to be
 * inverted, so each button produced the other split.
 */
export async function POST(request: NextRequest) {
  try {
    const { terminal, direction } = await request.json();

    if (!terminal || typeof terminal !== "string") {
      return NextResponse.json(
        { error: "terminal is required" },
        { status: 400 }
      );
    }

    if (direction !== "horizontal" && direction !== "vertical") {
      return NextResponse.json(
        { error: "direction must be 'horizontal' or 'vertical'" },
        { status: 400 }
      );
    }

    const flag = direction === "horizontal" ? "-h" : "-v";

    // execFile, not exec: terminal names reach us from the client and must
    // never be pasted into a shell string.
    await execFileAsync("tmux", [
      "split-window",
      flag,
      "-t",
      terminal,
      "-c",
      "#{pane_current_path}",
    ]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error splitting tmux pane:", error);
    return NextResponse.json(
      { error: "Failed to split tmux pane" },
      { status: 500 }
    );
  }
}
