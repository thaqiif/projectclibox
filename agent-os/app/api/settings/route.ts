import { NextRequest, NextResponse } from "next/server";
import { getDb, queries } from "@/lib/db";
import { isSupportedSettingKey } from "@/lib/settings";

export async function GET() {
  try {
    const db = getDb();
    const rows = queries.getAllSettings(db).all() as {
      key: string;
      value: string;
    }[];
    const settings: Record<string, string> = {};
    for (const { key, value } of rows) {
      settings[key] = value;
    }
    return NextResponse.json({ settings });
  } catch (error) {
    console.error("Error getting settings:", error);
    return NextResponse.json(
      { error: "Failed to get settings" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { key, value } = body;

    if (!key || value === undefined) {
      return NextResponse.json(
        { error: "Missing key or value" },
        { status: 400 }
      );
    }

    if (!isSupportedSettingKey(key)) {
      return NextResponse.json(
        { error: "Unsupported setting" },
        { status: 400 }
      );
    }

    const db = getDb();
    queries.setSetting(db).run(key, String(value));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error setting:", error);
    return NextResponse.json(
      { error: "Failed to save setting" },
      { status: 500 }
    );
  }
}
