import { NextRequest, NextResponse } from "next/server";
import {
  createTerminalWithName,
  killTerminal,
  renameTerminal,
  sanitizeTerminalName,
  terminalExists,
} from "@/lib/terminals";
import {
  forgetTerminal,
  registeredTerminalPath,
  renameTerminalRow,
  terminalRowExists,
} from "@/lib/terminal-registry";
import {
  guardJsonRequiredSameOrigin,
  guardJsonSameOrigin,
  guardSameOrigin,
} from "@/lib/route-guards";
import { rememberTerminal } from "@/lib/terminal-registry";

/**
 * DELETE /api/terminals/:name - close a terminal for good.
 *
 * Killing the tmux terminal alone would leave the registry entry behind and
 * the terminal would reappear as restartable. Closing is explicit user
 * intent, so the entry is forgotten too.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  // DELETE carries no JSON body. Next's Node adapter can still expose an
  // empty request stream here, so check origin directly instead of content type.
  const guard = guardSameOrigin(request);
  if (guard) return guard;

  try {
    const { name } = await params;
    const decoded = decodeURIComponent(name);

    // The terminal may already be gone (this is how a stopped terminal is
    // removed); forgetting it is the part that must happen either way.
    await killTerminal(decoded).catch(() => {});
    forgetTerminal(decoded);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error killing terminal:", error);
    return NextResponse.json(
      { error: "Failed to kill terminal" },
      { status: 500 }
    );
  }
}

/** POST /api/terminals/:name - restart a stopped registered terminal. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const guard = guardJsonRequiredSameOrigin(request);
  if (guard) return guard;

  try {
    const { name } = await params;
    const decoded = decodeURIComponent(name);
    const cwd = registeredTerminalPath(decoded);
    if (!cwd) {
      return NextResponse.json(
        { error: "No registered terminal with that name" },
        { status: 404 }
      );
    }
    if (await terminalExists(decoded)) {
      return NextResponse.json(
        { error: "Terminal is already running" },
        { status: 409 }
      );
    }

    const terminal = await createTerminalWithName(decoded, cwd);
    rememberTerminal(terminal.name, terminal.path);
    return NextResponse.json({ success: true, name: terminal.name });
  } catch (error) {
    console.error("Error restarting terminal:", error);
    return NextResponse.json(
      { error: "Failed to restart terminal" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/terminals/:name - rename a terminal.
 *
 * A terminal's name *is* its tmux name, so this has to keep tmux
 * and the registry saying the same thing. Every failure here used to be
 * swallowed and the registry renamed regardless, which is how a rename
 * tmux had rejected or rewritten produced one dead entry under the name
 * the user typed and a second, live one under the name tmux chose.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const guard = guardJsonSameOrigin(request);
  if (guard) return guard;

  try {
    const { name } = await params;
    const { newName } = await request.json();

    if (!newName || typeof newName !== "string") {
      return NextResponse.json(
        { error: "newName is required" },
        { status: 400 }
      );
    }

    const decoded = decodeURIComponent(name);
    const requested = newName.trim();
    const target = sanitizeTerminalName(requested);

    if (!target) {
      return NextResponse.json(
        { error: "Name cannot be empty" },
        { status: 400 }
      );
    }

    if (target === decoded) {
      // Nothing to do, but report the sanitized name so a rename of
      // "v1.2.0" to itself does not look like it failed.
      return NextResponse.json({ success: true, name: target, requested });
    }

    // Renaming onto a name already in use would collide in tmux and again
    // on the registry's unique index. Say so instead of half-applying it.
    if ((await terminalExists(target)) || terminalRowExists(target)) {
      return NextResponse.json(
        { error: `A terminal named "${target}" already exists` },
        { status: 409 }
      );
    }

    // A stopped terminal has no tmux process to rename — only a registry entry.
    const actual = (await terminalExists(decoded))
      ? await renameTerminal(decoded, target)
      : target;

    renameTerminalRow(decoded, actual);

    return NextResponse.json({ success: true, name: actual, requested });
  } catch (error) {
    console.error("Error renaming terminal:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to rename terminal",
      },
      { status: 500 }
    );
  }
}
