import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config({ path: ".env.local", override: true });

type EvalCategory =
  | "RAG_ONLY"
  | "HYBRID_SQL_RAG"
  | "PRIVATE_UNANSWERABLE"
  | "UNRELATED_FIREWALL"
  | "AMBIGUOUS";

type EvalQuestion = {
  id: string;
  category: EvalCategory;
  question: string;
  expectedToolName: string;
  expectedRoute: string;
  expectedCitationPrefixes: string[];
  expectedEvidenceTerms?: string[];
  expectedSql?: boolean;
  expectedRefusal?: boolean;
  notes?: string;
};

type DrugCount = {
  drug_name: string;
  chunk_count: string;
  embedded_count: string;
};

type CmsDrug = {
  brand_name: string;
  row_count: string;
};

const outputPath =
  process.argv[2] || "evaluation/questions.generated.routes.750.json";

const perCategoryCount = Number(process.env.EVAL_PER_CATEGORY_COUNT || 150);

const preferredTargetDrugs = (
  process.env.OPENFDA_TARGET_DRUGS ||
  "Anoro Ellipta,Adempas,Arexvy,Trelegy Ellipta,Breo Ellipta,Advair Diskus,Spiriva,Symbicort,Eliquis,Januvia,Ozempic,Trulicity,Humira,Stelara,Dupixent,Keytruda,Ibrance,Farxiga,Jardiance"
)
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const safeFallbackDrugs = [
  "Anoro Ellipta",
  "Trelegy Ellipta",
  "Breo Ellipta",
  "Advair Diskus",
  "Spiriva",
  "Symbicort",
  "Eliquis",
  "Januvia",
  "Ozempic",
  "Trulicity",
  "Humira",
  "Stelara",
  "Dupixent",
  "Keytruda",
  "Ibrance",
  "Farxiga",
  "Jardiance",
];

const categories: EvalCategory[] = [
  "RAG_ONLY",
  "HYBRID_SQL_RAG",
  "PRIVATE_UNANSWERABLE",
  "UNRELATED_FIREWALL",
  "AMBIGUOUS",
];

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalize(value: unknown) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstWord(value: string) {
  return clean(value).split(/\s+/)[0] || clean(value);
}

function isBadDrugName(value: unknown) {
  const text = clean(value);
  const lower = normalize(text);

  if (!text) return true;
  if (text.length < 3) return true;
  if (text.length > 80) return true;

  const bad = [
    "unknown",
    "low",
    "gas",
    "milk",
    "daytime",
    "nighttime",
    "sunscreen",
    "naked sundays",
    "kroger",
    "equate",
    "careone",
    "leader",
    "major",
    "basic care",
    "good neighbor",
    "rugby",
    "walgreens",
    "cvs",
    "rite aid",
    "antacid",
    "cold",
    "flu",
    "pain relief",
  ];

  return bad.some((term) => lower.includes(term));
}

function uniqueByNormalized(items: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const item of items) {
    const key = normalize(item);

    if (!key || seen.has(key) || isBadDrugName(item)) {
      continue;
    }

    seen.add(key);
    output.push(clean(item));
  }

  return output;
}

function cycle<T>(items: T[], index: number, fallback: T): T {
  if (items.length === 0) return fallback;
  return items[index % items.length];
}

function makeId(category: EvalCategory, index: number) {
  return `${category.toLowerCase()}_${String(index + 1).padStart(4, "0")}`;
}

function addQuestion(
  questions: EvalQuestion[],
  category: EvalCategory,
  index: number,
  values: Omit<EvalQuestion, "id" | "category">
) {
  questions.push({
    id: makeId(category, index),
    category,
    ...values,
    question: clean(values.question),
  });
}

function matchesPreferredTarget(drugName: string) {
  const normalizedDrug = normalize(drugName);

  return preferredTargetDrugs.some((target) => {
    const normalizedTarget = normalize(target);
    const first = normalizedTarget.split(" ")[0];

    return (
      normalizedDrug === normalizedTarget ||
      normalizedDrug.includes(normalizedTarget) ||
      normalizedTarget.includes(normalizedDrug) ||
      (first.length >= 4 && normalizedDrug.includes(first))
    );
  });
}

async function loadSeeds() {
  const { sql } = await import("../lib/db/client");

  const labelRows = await sql<DrugCount[]>`
    select
      coalesce(nullif(drug_name, ''), nullif(brand_name, '')) as drug_name,
      count(*)::text as chunk_count,
      count(embedding)::text as embedded_count
    from document_chunks
    where source_type = 'drug_label'
      and coalesce(nullif(drug_name, ''), nullif(brand_name, '')) is not null
    group by 1
    having count(*) >= 2
    order by count(*) desc, drug_name asc
    limit 1000
  `;

  const cmsSpendingRows = await sql<CmsDrug[]>`
    select
      brand_name,
      count(*)::text as row_count
    from cms_part_d_spending
    where year = 2024
      and brand_name is not null
      and total_spending is not null
    group by brand_name
    order by sum(total_spending) desc nulls last
    limit 500
  `;

  const cmsPrescriberRows = await sql<CmsDrug[]>`
    select
      brand_name,
      count(*)::text as row_count
    from cms_part_d_prescribers
    where year = 2024
      and brand_name is not null
      and total_drug_cost is not null
    group by brand_name
    order by sum(total_drug_cost) desc nulls last
    limit 500
  `;

  const loadedLabelDrugs = uniqueByNormalized(
    labelRows
      .map((row) => row.drug_name)
      .filter(Boolean)
      .filter((drug) => Number(rowCountForDrug(labelRows, drug)) >= 2)
      .filter(matchesPreferredTarget)
  );

  const loadedCmsDrugs = uniqueByNormalized([
    ...cmsSpendingRows.map((row) => row.brand_name),
    ...cmsPrescriberRows.map((row) => row.brand_name),
  ]);

  const cleanTargetLabels = uniqueByNormalized([
    ...preferredTargetDrugs.filter((drug) =>
      loadedLabelDrugs.some(
        (loaded) =>
          normalize(loaded).includes(normalize(drug)) ||
          normalize(drug).includes(normalize(loaded)) ||
          normalize(loaded).includes(normalize(drug).split(" ")[0])
      )
    ),
    ...loadedLabelDrugs,
    ...safeFallbackDrugs,
  ]);

  const hybridDrugs = uniqueByNormalized([
    ...cleanTargetLabels.filter((labelDrug) =>
      loadedCmsDrugs.some((cmsDrug) => {
        const label = normalize(labelDrug);
        const cms = normalize(cmsDrug);
        const first = label.split(" ")[0];

        return (
          label === cms ||
          label.includes(cms) ||
          cms.includes(label) ||
          (first.length >= 4 && cms.includes(first))
        );
      })
    ),
    ...["Eliquis", "Ozempic", "Jardiance", "Farxiga", "Trulicity", "Humira", "Stelara", "Dupixent"],
  ]);

  return {
    ragDrugs: cleanTargetLabels.slice(0, 40),
    hybridDrugs: hybridDrugs.slice(0, 40),
  };
}

function rowCountForDrug(rows: DrugCount[], drugName: string) {
  return rows.find((row) => row.drug_name === drugName)?.chunk_count || "0";
}

function buildRagOnlyQuestions(questions: EvalQuestion[], ragDrugs: string[]) {
  const templates = [
    (drug: string) => `What is ${drug} used for according to the loaded FDA label?`,
    (drug: string) => `What warnings are listed for ${drug} in the FDA label?`,
    (drug: string) => `What adverse reactions does the FDA label mention for ${drug}?`,
    (drug: string) => `What dosage information is available for ${drug}?`,
    (drug: string) => `What contraindications are mentioned for ${drug}?`,
    (drug: string) => `Summarize the loaded FDA label context for ${drug}.`,
    (drug: string) => `Tell me about ${drug} using FDA label evidence.`,
    (drug: string) => `${drug} FDA label warnings.`,
    (drug: string) => `${drug} FDA label dosage.`,
    (drug: string) => `${drug} FDA label adverse reactions.`,
  ];

  for (let index = 0; index < perCategoryCount; index += 1) {
    const drug = cycle(ragDrugs, index, "Anoro Ellipta");

    addQuestion(questions, "RAG_ONLY", index, {
      question: templates[index % templates.length](drug),
      expectedToolName: "openfda_label_agent",
      expectedRoute: "RAG_ONLY",
      expectedCitationPrefixes: ["KB", "LIMIT"],
      expectedEvidenceTerms: [firstWord(drug)],
      expectedSql: false,
      expectedRefusal: false,
    });
  }
}

function buildHybridQuestions(questions: EvalQuestion[], hybridDrugs: string[]) {
  const templates = [
    (drug: string) =>
      `Show CMS Medicare Part D spending for ${drug} and include FDA label warnings.`,
    (drug: string) =>
      `Use public CMS Part D data and FDA label evidence to summarize ${drug}.`,
    (drug: string) =>
      `For ${drug}, combine Medicare Part D spending with FDA label context.`,
    (drug: string) =>
      `Give a public data summary for ${drug} using CMS spending and FDA label evidence.`,
    (drug: string) =>
      `${drug}: CMS Medicare spending plus FDA label warnings.`,
    (drug: string) =>
      `Show public Medicare/CMS spending signals for ${drug} and explain what its FDA label says.`,
  ];

  for (let index = 0; index < perCategoryCount; index += 1) {
    const drug = cycle(hybridDrugs, index, "Eliquis");

    addQuestion(questions, "HYBRID_SQL_RAG", index, {
      question: templates[index % templates.length](drug),
      expectedToolName: "part_d_drug_trend_agent",
      expectedRoute: "HYBRID_SQL_RAG",
      expectedCitationPrefixes: ["SQL", "KB", "LIMIT"],
      expectedEvidenceTerms: [firstWord(drug)],
      expectedSql: true,
      expectedRefusal: false,
      notes:
        "Hybrid question explicitly asks for CMS structured evidence and FDA label evidence.",
    });
  }
}

function buildPrivateQuestions(questions: EvalQuestion[]) {
  const drugs = [
    "Eliquis",
    "Ozempic",
    "Jardiance",
    "Farxiga",
    "Trulicity",
    "Humira",
    "Stelara",
    "Dupixent",
    "Anoro Ellipta",
    "Trelegy Ellipta",
  ];

  const templates = [
    (drug: string) => `Which sales rep lost us the most private revenue for ${drug}?`,
    (drug: string) => `Show private CRM opportunity details for ${drug}.`,
    (drug: string) => `Which customer account received the highest discount for ${drug}?`,
    (drug: string) => `What rebate did this customer receive for ${drug}?`,
    (drug: string) => `Which contract caused internal margin loss for ${drug}?`,
    (drug: string) => `Rank sales reps by private quota performance for ${drug}.`,
    (drug: string) => `Show customer-level net revenue for ${drug}.`,
    (drug: string) => `Which internal invoice caused the biggest profitability issue for ${drug}?`,
    (drug: string) => `Which Salesforce account should we target for ${drug}?`,
    (drug: string) => `What was our private net revenue for ${drug}?`,
  ];

  for (let index = 0; index < perCategoryCount; index += 1) {
    const drug = cycle(drugs, index, "Eliquis");

    addQuestion(questions, "PRIVATE_UNANSWERABLE", index, {
      question: templates[index % templates.length](drug),
      expectedToolName: "data_limitation_agent",
      expectedRoute: "DATA_LIMITATION",
      expectedCitationPrefixes: ["LIMIT"],
      expectedEvidenceTerms: [],
      expectedSql: false,
      expectedRefusal: true,
      notes:
        "Must refuse because the request asks for private CRM, sales, customer, contract, invoice, rebate, margin, or internal revenue data.",
    });
  }
}

function buildUnrelatedQuestions(questions: EvalQuestion[]) {
  const templates = [
    "Write me a React todo app.",
    "Help me plan a 5-day trip to Miami.",
    "What should I cook for dinner tonight?",
    "Explain binary search in JavaScript.",
    "Make a workout plan for chest and triceps.",
    "Write a resignation email.",
    "What is the weather tomorrow?",
    "Help me debug a CSS flexbox issue.",
    "Create a poem about mountains.",
    "Tell me the latest NBA standings.",
    "Resize my visa photo.",
    "Write a Python web scraper.",
    "Improve this resume bullet.",
    "Give me an apartment search checklist.",
    "Explain how to split this grocery bill.",
  ];

  for (let index = 0; index < perCategoryCount; index += 1) {
    addQuestion(questions, "UNRELATED_FIREWALL", index, {
      question: cycle(templates, index, templates[0]),
      expectedToolName: "unsupported_agent",
      expectedRoute: "UNSUPPORTED",
      expectedCitationPrefixes: ["LIMIT"],
      expectedEvidenceTerms: [],
      expectedSql: false,
      expectedRefusal: true,
      notes: "Must block because the request is outside public pharma intelligence scope.",
    });
  }
}

function buildAmbiguousQuestions(questions: EvalQuestion[], drugs: string[]) {
  const templates = [
    (drug: string) => `Show performance for ${drug}.`,
    (drug: string) => `Tell me what changed for ${drug}.`,
    (drug: string) => `Is ${drug} doing well?`,
    (drug: string) => `Compare ${drug} with other drugs.`,
    (drug: string) => `What is the highest value for ${drug}?`,
    (drug: string) => `Show the trend for ${drug}.`,
    (drug: string) => `What should we investigate for ${drug}?`,
    (drug: string) => `Give me the top results for ${drug}.`,
    (drug: string) => `Summarize ${drug}.`,
    (drug: string) => `Analyze ${drug}.`,
  ];

  for (let index = 0; index < perCategoryCount; index += 1) {
    const drug = cycle(drugs, index, "Eliquis");

    addQuestion(questions, "AMBIGUOUS", index, {
      question: templates[index % templates.length](drug),
      expectedToolName: "unsupported_agent",
      expectedRoute: "UNSUPPORTED",
      expectedCitationPrefixes: ["LIMIT"],
      expectedEvidenceTerms: [],
      expectedSql: false,
      expectedRefusal: true,
      notes:
        "Ambiguous entity-only request. The system should ask for the metric/source instead of guessing.",
    });
  }
}

function validate(questions: EvalQuestion[]) {
  const counts = questions.reduce<Record<string, number>>((acc, question) => {
    acc[question.category] = (acc[question.category] || 0) + 1;
    return acc;
  }, {});

  for (const category of categories) {
    if ((counts[category] || 0) !== perCategoryCount) {
      throw new Error(
        `Expected ${perCategoryCount} questions for ${category}, got ${counts[category] || 0}.`
      );
    }
  }

  const expectedTotal = categories.length * perCategoryCount;

  if (questions.length !== expectedTotal) {
    throw new Error(`Expected ${expectedTotal} questions, got ${questions.length}.`);
  }

  return counts;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is missing.");
  }

  console.log("Generating clean PharmaRev route evaluation questions...");

  const seeds = await loadSeeds();

  console.log("Seed counts:");
  console.table({
    ragDrugs: seeds.ragDrugs.length,
    hybridDrugs: seeds.hybridDrugs.length,
  });

  console.log("RAG drugs:");
  console.log(seeds.ragDrugs);

  console.log("Hybrid drugs:");
  console.log(seeds.hybridDrugs);

  const questions: EvalQuestion[] = [];

  buildRagOnlyQuestions(questions, seeds.ragDrugs);
  buildHybridQuestions(questions, seeds.hybridDrugs);
  buildPrivateQuestions(questions);
  buildUnrelatedQuestions(questions);
  buildAmbiguousQuestions(questions, seeds.ragDrugs);

  const counts = validate(questions);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(questions, null, 2));

  console.log("Generated clean eval questions.");
  console.log({
    outputPath,
    total: questions.length,
  });

  console.table(counts);
}

main().catch((error) => {
  console.error("Question generation failed:");
  console.error(error);
  process.exit(1);
});