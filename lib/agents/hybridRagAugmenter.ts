import type { SourceEvidence } from "../../types/evidence";
import { sql } from "../db/client";

type AnyAgentResult = Record<string, unknown>;

type LabelChunkRow = {
  id: string;
  drug_name: string | null;
  brand_name: string | null;
  generic_name: string | null;
  manufacturer_name: string | null;
  source_dataset: string | null;
  source_url: string | null;
  section: string | null;
  chunk_text: string;
};

type DrugAlias = {
  canonical: string;
  aliases: string[];
};

const defaultTargetDrugs =
  "Anoro Ellipta,Adempas,Arexvy,Trelegy Ellipta,Breo Ellipta,Advair Diskus,Spiriva,Symbicort,Eliquis,Januvia,Ozempic,Trulicity,Humira,Stelara,Dupixent,Keytruda,Ibrance,Farxiga,Jardiance";

const manualAliases: DrugAlias[] = [
  { canonical: "Anoro Ellipta", aliases: ["anoro", "anoro ellipta"] },
  { canonical: "Trelegy Ellipta", aliases: ["trelegy", "trelegy ellipta"] },
  { canonical: "Breo Ellipta", aliases: ["breo", "breo ellipta"] },
  { canonical: "Advair Diskus", aliases: ["advair", "advair diskus"] },
  { canonical: "Spiriva", aliases: ["spiriva"] },
  { canonical: "Symbicort", aliases: ["symbicort"] },
  { canonical: "Adempas", aliases: ["adempas"] },
  { canonical: "Arexvy", aliases: ["arexvy"] },
  { canonical: "Eliquis", aliases: ["eliquis", "apixaban"] },
  { canonical: "Januvia", aliases: ["januvia", "sitagliptin"] },
  { canonical: "Ozempic", aliases: ["ozempic", "semaglutide"] },
  { canonical: "Trulicity", aliases: ["trulicity", "dulaglutide"] },
  { canonical: "Humira", aliases: ["humira", "adalimumab"] },
  { canonical: "Stelara", aliases: ["stelara", "ustekinumab"] },
  { canonical: "Dupixent", aliases: ["dupixent", "dupilumab"] },
  { canonical: "Keytruda", aliases: ["keytruda", "pembrolizumab"] },
  { canonical: "Ibrance", aliases: ["ibrance", "palbociclib"] },
  { canonical: "Farxiga", aliases: ["farxiga", "dapagliflozin"] },
  { canonical: "Jardiance", aliases: ["jardiance", "empagliflozin"] },
];

const drugAliases = buildDrugAliases();

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

function buildDrugAliases() {
  const envTargetDrugs = (process.env.OPENFDA_TARGET_DRUGS || defaultTargetDrugs)
    .split(",")
    .map((drug) => drug.trim())
    .filter(Boolean);

  const byCanonical = new Map<string, Set<string>>();

  for (const drug of envTargetDrugs) {
    const canonical = clean(drug);
    const aliases = byCanonical.get(canonical) || new Set<string>();
    aliases.add(canonical);

    const first = normalize(canonical).split(" ")[0];

    if (first.length >= 4) {
      aliases.add(first);
    }

    byCanonical.set(canonical, aliases);
  }

  for (const item of manualAliases) {
    const aliases = byCanonical.get(item.canonical) || new Set<string>();

    for (const alias of item.aliases) {
      aliases.add(alias);
    }

    byCanonical.set(item.canonical, aliases);
  }

  return Array.from(byCanonical.entries()).map(([canonical, aliases]) => ({
    canonical,
    aliases: Array.from(aliases).map(normalize).filter(Boolean),
  }));
}

function extractDrugFromQuestion(question: string) {
  const text = normalize(question);

  for (const drug of drugAliases) {
    if (drug.aliases.some((alias) => text.includes(alias))) {
      return drug.canonical;
    }
  }

  return "";
}

function drugPatterns(drug: string) {
  const normalizedDrug = normalize(drug);
  const match = drugAliases.find(
    (item) =>
      normalize(item.canonical) === normalizedDrug ||
      item.aliases.includes(normalizedDrug)
  );

  const aliases = new Set<string>();

  if (drug) {
    aliases.add(drug);

    const first = normalize(drug).split(" ")[0];

    if (first.length >= 4) {
      aliases.add(first);
    }
  }

  if (match) {
    aliases.add(match.canonical);

    for (const alias of match.aliases) {
      aliases.add(alias);
    }
  }

  return Array.from(aliases)
    .map(clean)
    .filter(Boolean)
    .map((alias) => `%${alias}%`);
}

function asSourceArray(value: unknown): SourceEvidence[] {
  if (!Array.isArray(value)) return [];
  return value as SourceEvidence[];
}

function asRows(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function hasKbSource(sources: SourceEvidence[]) {
  return sources.some(
    (source) =>
      source.citationType === "kb" ||
      String(source.citationLabel || "").toUpperCase().startsWith("KB")
  );
}

function sectionRank(section: string | null) {
  const text = normalize(section || "");

  if (text.includes("indication")) return 1;
  if (text.includes("warning")) return 2;
  if (text.includes("contraindication")) return 3;
  if (text.includes("adverse")) return 4;
  if (text.includes("dosage")) return 5;

  return 10;
}

async function retrieveLabelSources(drug: string) {
  if (!drug) return [];

  const patterns = drugPatterns(drug);

  const rows = await sql<LabelChunkRow[]>`
    select
      dc.id::text as id,
      coalesce(dc.drug_name, d.drug_name, dc.metadata->>'drugName', d.metadata->>'drugName', '') as drug_name,
      coalesce(dc.brand_name, d.brand_name, dc.metadata->>'brandName', d.metadata->>'brandName', '') as brand_name,
      coalesce(dc.generic_name, d.generic_name, dc.metadata->>'genericName', d.metadata->>'genericName', '') as generic_name,
      coalesce(dc.manufacturer_name, d.manufacturer_name, dc.metadata->>'manufacturerName', d.metadata->>'manufacturerName', '') as manufacturer_name,
      coalesce(dc.source_dataset, d.source_dataset, 'openFDA Drug Label Dataset') as source_dataset,
      coalesce(dc.source_url, d.source_url) as source_url,
      dc.section,
      dc.chunk_text
    from document_chunks dc
    left join documents d on d.id = dc.document_id
    where dc.source_type = 'drug_label'
      and (
        dc.drug_name ilike any(${patterns})
        or dc.brand_name ilike any(${patterns})
        or dc.generic_name ilike any(${patterns})
        or d.drug_name ilike any(${patterns})
        or d.brand_name ilike any(${patterns})
        or d.generic_name ilike any(${patterns})
        or d.title ilike any(${patterns})
        or dc.chunk_text ilike any(${patterns})
        or dc.metadata::text ilike any(${patterns})
        or d.metadata::text ilike any(${patterns})
      )
    order by
      case
        when lower(coalesce(dc.section, '')) like '%indication%' then 1
        when lower(coalesce(dc.section, '')) like '%warning%' then 2
        when lower(coalesce(dc.section, '')) like '%contraindication%' then 3
        when lower(coalesce(dc.section, '')) like '%adverse%' then 4
        when lower(coalesce(dc.section, '')) like '%dosage%' then 5
        else 10
      end,
      dc.chunk_index asc nulls last
    limit 4
  `;

  return rows
    .sort((a, b) => sectionRank(a.section) - sectionRank(b.section))
    .slice(0, 3);
}

function toKbSources(rows: LabelChunkRow[]): SourceEvidence[] {
  return rows.map((row, index) => {
    const label = `KB-${index + 1}`;

    return {
      id: row.id,
      title: `openFDA label: ${clean(row.drug_name || row.brand_name || "Drug label")}`,
      dataset: clean(row.source_dataset || "openFDA Drug Label Dataset"),
      score: Number((1 - index * 0.05).toFixed(2)),
      status: "used",
      excerpt: clean(row.chunk_text).slice(0, 900),
      metadata: [
        `Citation: [${label}]`,
        `Drug: ${clean(row.drug_name || row.brand_name || "")}`,
        `Brand name: ${clean(row.brand_name || "")}`,
        `Generic name: ${clean(row.generic_name || "")}`,
        `Manufacturer: ${clean(row.manufacturer_name || "")}`,
        `Section: ${clean(row.section || "")}`,
        `Source URL: ${clean(row.source_url || "")}`,
      ].filter(Boolean),
      citationLabel: label,
      citationType: "kb",
    };
  });
}

function addKbContextToAnswer({
  answer,
  kbSources,
}: {
  answer: string;
  kbSources: SourceEvidence[];
}) {
  if (kbSources.length === 0) {
    return answer;
  }

  if (answer.includes("[KB-")) {
    return answer;
  }

  const firstSource = kbSources[0];

  return [
    answer.trim(),
    "",
    "FDA label context:",
    `${firstSource.excerpt.slice(0, 450)} [${firstSource.citationLabel}]`,
  ].join("\n");
}

export async function augmentHybridResultWithLabelEvidence({
  question,
  result,
}: {
  question: string;
  result: AnyAgentResult;
}) {
  const sources = asSourceArray(result.sources);

  if (hasKbSource(sources)) {
    return {
      ...result,
      route: "HYBRID_SQL_RAG",
    };
  }

  const drug = extractDrugFromQuestion(question);

  if (!drug) {
    return {
      ...result,
      route: "HYBRID_SQL_RAG",
      metadata: {
        ...(typeof result.metadata === "object" && result.metadata ? result.metadata : {}),
        hybridLabelAugmentation: {
          status: "skipped",
          reason: "No target drug could be extracted from the hybrid question.",
        },
      },
    };
  }

  try {
    const rows = await retrieveLabelSources(drug);
    const kbSources = toKbSources(rows);

    const currentAnswer = clean(result.answer || result.content || "");
    const nextAnswer = addKbContextToAnswer({
      answer: currentAnswer,
      kbSources,
    });

    return {
      ...result,
      route: "HYBRID_SQL_RAG",
      answer: nextAnswer,
      content: nextAnswer,
      sources: [...sources, ...kbSources],
      rows: asRows(result.rows),
      metadata: {
        ...(typeof result.metadata === "object" && result.metadata ? result.metadata : {}),
        hybridLabelAugmentation: {
          status: kbSources.length > 0 ? "complete" : "empty",
          drug,
          kbSourceCount: kbSources.length,
        },
      },
    };
  } catch (error) {
    return {
      ...result,
      route: "HYBRID_SQL_RAG",
      metadata: {
        ...(typeof result.metadata === "object" && result.metadata ? result.metadata : {}),
        hybridLabelAugmentation: {
          status: "failed",
          drug,
          error: error instanceof Error ? error.message : "Unknown error.",
        },
      },
    };
  }
}