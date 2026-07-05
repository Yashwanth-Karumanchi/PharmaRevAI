import { NextResponse } from "next/server";
import { sql } from "@/lib/db/client";

export async function GET() {
  try {
    const result = await sql`
      select count(*)::int as count
      from chat_sessions
    `;

    return NextResponse.json({
      ok: true,
      message: "Neon database connection successful",
      checkedTable: "chat_sessions",
      rowCount: result[0].count,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown database error";

    return NextResponse.json(
      {
        ok: false,
        message: "Neon database connection failed",
        error: message,
      },
      { status: 500 }
    );
  }
}