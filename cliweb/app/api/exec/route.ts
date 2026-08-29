import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import { buildCliwebEnvironment } from "@/lib/runtime-environment";

const execAsync = promisify(exec);

// Max execution time (10 seconds)
const TIMEOUT = 10000;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { command } = body;

    if (!command) {
      return NextResponse.json(
        { error: "No command specified" },
        { status: 400 }
      );
    }

    const startTime = Date.now();
    const environment = buildCliwebEnvironment();

    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: TIMEOUT,
        shell: environment.SHELL,
        env: environment,
      });

      const duration = Date.now() - startTime;

      return NextResponse.json({
        success: true,
        output: stdout || stderr,
        duration,
      });
    } catch (execError: unknown) {
      const duration = Date.now() - startTime;
      const error = execError as {
        stdout?: string;
        stderr?: string;
        message?: string;
      };

      return NextResponse.json({
        success: false,
        output:
          error.stderr || error.stdout || error.message || "Unknown error",
        duration,
      });
    }
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
