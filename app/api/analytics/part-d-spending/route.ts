import { NextResponse } from "next/server";
import { answerPartDSpendingIncreaseQuestion } from "@/lib/agents/partDSpendingAgent";

export async function GET() {
  try {
    const result = await answerPartDSpendingIncreaseQuestion(
        "Which drugs had the biggest Medicare Part D spending increase?"
    );

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown analytics error";

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 }
    );
  }
}