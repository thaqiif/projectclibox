import { NextRequest, NextResponse } from "next/server";
import { getDb, queries } from "@/lib/db";
import { guardJsonSameOrigin } from "@/lib/route-guards";
import {
  DEFAULT_MONITOR_WORKSPACE,
  MONITOR_WORKSPACE_SETTING_KEY,
  normalizeMonitorWorkspace,
} from "@/lib/monitor-workspace";

export async function GET() {
  try {
    const db = getDb();
    const row = queries.getSetting(db).get(MONITOR_WORKSPACE_SETTING_KEY) as
      | { value: string }
      | undefined;
    if (!row) {
      return NextResponse.json(DEFAULT_MONITOR_WORKSPACE);
    }
    try {
      return NextResponse.json(
        normalizeMonitorWorkspace(JSON.parse(row.value))
      );
    } catch {
      try {
        queries
          .setSetting(db)
          .run(
            MONITOR_WORKSPACE_SETTING_KEY,
            JSON.stringify(DEFAULT_MONITOR_WORKSPACE)
          );
      } catch (resetError) {
        console.error("Error resetting monitor workspace:", resetError);
      }
      return NextResponse.json(DEFAULT_MONITOR_WORKSPACE);
    }
  } catch (error) {
    console.error("Error getting monitor workspace:", error);
    return NextResponse.json(
      { error: "Failed to get monitor workspace" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  // CSRF parity with the other mutating routes: cross-origin JSON POSTs
  // will not attach application/json (no CORS preflight), and form/array
  // style cross-origin PUTs fail the same-origin check.
  const guard = guardJsonSameOrigin(request);
  if (guard) return guard;

  try {
    const workspace = normalizeMonitorWorkspace(await request.json());
    queries
      .setSetting(getDb())
      .run(MONITOR_WORKSPACE_SETTING_KEY, JSON.stringify(workspace));
    return NextResponse.json(workspace);
  } catch (error) {
    // The body mirrors normalizeMonitorWorkspace's rejection message.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid workspace" },
      { status: 400 }
    );
  }
}
