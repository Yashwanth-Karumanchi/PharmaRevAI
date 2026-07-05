import type { AgentStep, SourceEvidence, SqlEvidence } from "@/types/evidence";

export const sampleSources: SourceEvidence[] = [
  {
    id: "source-1",
    title: "CMS Medicare Part D Spending by Drug",
    dataset: "CMS Part D Spending",
    score: 0.94,
    status: "used",
    excerpt:
      "This dataset supports analysis of Medicare Part D drug spending, including total spending, manufacturer, drug name, and spending changes over time.",
    metadata: [
      "Source type: structured public dataset",
      "Used for: spending trend calculations",
      "Limitation: Medicare spending is not private company revenue",
    ],
  },
  {
    id: "source-2",
    title: "openFDA Drug Label",
    dataset: "openFDA",
    score: 0.88,
    status: "used",
    excerpt:
      "The FDA label can provide public product context such as indication, purpose, dosage, warnings, and adverse reaction sections.",
    metadata: [
      "Source type: public FDA label",
      "Used for: drug/product context",
      "Limitation: label text does not explain sales performance",
    ],
  },
  {
    id: "source-3",
    title: "Private deal-loss explanation",
    dataset: "Unavailable internal CRM data",
    score: 0.18,
    status: "rejected",
    excerpt:
      "The available public datasets do not contain internal sales-rep, discount, CRM opportunity, or private contract data.",
    metadata: [
      "Rejected because no internal deal table exists",
      "Rejected because public data cannot prove private margin leakage",
      "Final answer must include this limitation",
    ],
  },
];

export const sampleSqlEvidence: SqlEvidence = {
  query: `select
  brand_name,
  manufacturer,
  min(year) as start_year,
  max(year) as end_year,
  max(total_spending) - min(total_spending) as spending_increase
from cms_part_d_spending
where year between 2023 and 2024
group by brand_name, manufacturer
order by spending_increase desc
limit 10;`,
  resultRows: [
    {
      rank: 1,
      brand_name: "ExampleDrug A",
      manufacturer: "Example Pharma Inc.",
      spending_increase: "$128.4M",
    },
    {
      rank: 2,
      brand_name: "ExampleDrug B",
      manufacturer: "Sample Therapeutics",
      spending_increase: "$91.7M",
    },
    {
      rank: 3,
      brand_name: "ExampleDrug C",
      manufacturer: "Demo BioPharma",
      spending_increase: "$73.2M",
    },
  ],
  notes: [
    "This is sample UI data for now.",
    "Later, this query will run against real Supabase tables.",
    "The LLM should not invent spending numbers. Numeric claims must come from SQL results.",
    "This SQL result supports public Medicare Part D spending trends only, not private deal profit.",
  ],
};

export const sampleAgentSteps: AgentStep[] = [
  {
    id: "step-1",
    name: "Query Router",
    status: "complete",
    summary: "Classified the question as HYBRID_SQL_RAG.",
    details: [
      "The user asked for both a numeric trend and supporting evidence.",
      "SQL is needed for exact spending changes.",
      "RAG is needed for dataset meaning and public product context.",
    ],
  },
  {
    id: "step-2",
    name: "Entity Extractor",
    status: "complete",
    summary: "Detected metric, dataset, and time range.",
    details: [
      "Metric: Medicare Part D spending increase",
      "Dataset: CMS Part D Spending by Drug",
      "Potential evidence source: CMS metadata and openFDA labels",
    ],
  },
  {
    id: "step-3",
    name: "SQL Agent",
    status: "complete",
    summary: "Prepared a safe read-only SQL query.",
    details: [
      "Only SELECT queries are allowed.",
      "The query uses approved public-data tables.",
      "The query result is used for numeric claims.",
    ],
  },
  {
    id: "step-4",
    name: "RAG Retriever",
    status: "complete",
    summary: "Retrieved source chunks from the knowledge base.",
    details: [
      "Retrieved CMS methodology context.",
      "Retrieved openFDA product context.",
      "Rejected unsupported private deal-loss claims.",
    ],
  },
  {
    id: "step-5",
    name: "Grounding Verifier",
    status: "warning",
    summary: "Approved public-data claims but blocked private-deal interpretation.",
    details: [
      "Spending trend claim is allowed if SQL supports it.",
      "Product context is allowed if cited from FDA/CMS sources.",
      "Private revenue or deal-loss claims must be refused because data is unavailable.",
    ],
  },
];