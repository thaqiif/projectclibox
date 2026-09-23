import { NextRequest, NextResponse } from "next/server";
import { createTerminal, toRecord } from "@/lib/terminals";
import {
  listKnownTerminals,
  rememberTerminal,
} from "@/lib/terminal-registry";
import { getAllProjects } from "@/lib/projects";
import { resolveProjectForPath } from "@/lib/terminal-projects";
import { guardJsonSameOrigin } from "@/lib/route-guards";

/**
 * GET /api/terminals - every terminal, with its project.
 *
 * tmux is the source of truth for what is running: a terminal started from a
 * plain shell shows up here exactly like one started from the UI. The
 * registry adds terminals whose tmux process has been killed, which come back
 * marked `alive: false` so they can be restarted rather than disappearing.
 */
export async function GET() {
  try {
    const terminals = await listKnownTerminals();
    const projects = getAllProjects();

    return NextResponse.json(
      terminals.map((terminal) =>
        toRecord(
          terminal,
          resolveProjectForPath(terminal.path, projects),
          terminal.alive
        )
      )
    );
  } catch (error) {
    console.error("Error listing terminals:", error);
    return NextResponse.json(
      { error: "Failed to list terminals" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/terminals - open a new terminal.
 *
 * Takes a working directory and nothing else. Any additional CLI is the
 * user's choice, made by typing its name once the shell is up.
 */
export async function POST(request: NextRequest) {
  const guard = guardJsonSameOrigin(request);
  if (guard) return guard;

  try {
    const body = await request.json().catch(() => ({}));
    const { cwd, projectId } = body as { cwd?: string; projectId?: string };

    let workingDirectory = cwd;

    if (!workingDirectory && projectId) {
      const project = getAllProjects().find((p) => p.id === projectId);
      workingDirectory = project?.working_directory;
    }

    if (!workingDirectory) {
      workingDirectory = process.env.HOME || "/";
    }

    const terminal = await createTerminal(workingDirectory);
    rememberTerminal(terminal.name, terminal.path);
    const projects = getAllProjects();

    return NextResponse.json(
      toRecord(terminal, resolveProjectForPath(terminal.path, projects))
    );
  } catch (error) {
    console.error("Error creating terminal:", error);
    return NextResponse.json(
      { error: "Failed to create terminal" },
      { status: 500 }
    );
  }
}
