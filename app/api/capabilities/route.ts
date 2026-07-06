
import { NextResponse } from "next/server";
import { sql } from "@/lib/db/client";

export const dynamic = "force-dynamic";

type YearRow = {
  year: number;
};

type TopDrugRow = {
  brand_name: string | null;
  total_spending: string;
};

type PromptCategory = "ranking" | "overview" | "prescriber" | "label";

type PromptCard = {
  id: string;
  title: string;
  description: string;
  prompt: string;
  category: PromptCategory;
};

function formatAvailableYears(years: number[]) {
  if (years.length === 0) {
    return "Not available";
  }

  return [...years].sort((a, b) => a - b).join(", ");
}

function buildPromptCards({
  availableYears,
  sampleDrug,
}: {
  availableYears: number[];
  sampleDrug: string | null;
}): PromptCard[] {
  const latestYear = [...availableYears].sort((a, b) => b - a)[0] ?? 2024;
  const exampleDrug = sampleDrug || "Eliquis";

  return [
    {
      id: "highest-spending",
      title: "Highest spending drugs",
      description: `Rank medicines by Medicare Part D spending in ${latestYear}.`,
      prompt: `Which drugs had the highest Medicare Part D spending in ${latestYear}?`,
      category: "ranking",
    },
    {
      id: "spending-overview",
      title: "Spending overview",
      description: `Summarize the available Medicare Part D spending picture for ${latestYear}.`,
      prompt: `Show the overall Medicare Part D spending overview for ${latestYear}.`,
      category: "overview",
    },
    {
      id: "prescriber-locations",
      title: "Prescriber cost locations",
      description: "Find where public prescriber costs are concentrated.",
      prompt: `For ${exampleDrug}, where were prescriber costs highest?`,
      category: "prescriber",
    },
    {
      id: "label-context",
      title: "FDA label context",
      description: "Answer from cited FDA label evidence.",
      prompt: `What is ${exampleDrug} used for according to the FDA label?`,
      category: "label",
    },
  ];
}

export async function GET() {
  try {
    const yearRows = await sql<YearRow[]>`
      select distinct year
      from cms_part_d_spending
      where year is not null
      order by year desc
    `;

    const availableYears = yearRows
      .map((row) => Number(row.year))
      .filter(Number.isFinite);

    const latestYear = availableYears[0] ?? null;

    let sampleDrug: string | null = null;

    if (latestYear) {
      const topDrugRows = await sql<TopDrugRow[]>`
        select
          brand_name,
          sum(total_spending)::numeric::text as total_spending
        from cms_part_d_spending
        where year = ${latestYear}
          and brand_name is not null
          and total_spending is not null
          and lower(coalesce(manufacturer, '')) <> 'overall'
        group by brand_name
        order by sum(total_spending) desc
        limit 1
      `;

      sampleDrug = topDrugRows[0]?.brand_name ?? null;
    }

    const prompts = buildPromptCards({
      availableYears,
      sampleDrug,
    });

    return NextResponse.json({
      ok: true,
      dataSource: "PharmaRev public evidence",
      availableYears,
      availableYearsLabel: formatAvailableYears(availableYears),
      sampleDrug,
      supportedIntents: [
        {
          intent: "PART_D_SPENDING",
          agent: "part_d_spending_agent",
          description: "Medicare Part D spending rankings, overviews, and drug trends.",
        },
        {
          intent: "PART_D_PRESCRIBERS",
          agent: "part_d_prescriber_agent",
          description: "Public prescriber cost concentration by location, provider, or specialty.",
        },
        {
          intent: "OPEN_PAYMENTS",
          agent: "open_payments_agent",
          description: "CMS Open Payments summaries by company or payment category.",
        },
        {
          intent: "FDA_LABEL_CONTEXT",
          agent: "openfda_label_agent",
          description: "FDA label evidence such as use, warnings, dosage, and adverse reactions.",
        },
      ],
      prompts,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown capabilities error";

    return NextResponse.json(
      {
        ok: false,
        error: message,
        dataSource: "PharmaRev public evidence",
        availableYears: [],
        availableYearsLabel: "Unavailable",
        sampleDrug: null,
        supportedIntents: [],
        prompts: buildPromptCards({
          availableYears: [],
          sampleDrug: null,
        }),
      },
      { status: 500 }
    );
  }
}
