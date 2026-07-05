import { sql } from "../db/client";
import { verifyGroundedAnswer } from "./groundingVerifier";
import type { SourceEvidence } from "../../types/evidence";

type FdaChunkRow = {
  id: string;
  chunk_text: string;
  section: string | null;
  chunk_index: number | null;
  title: string | null;
  source_url: string | null;
  source_dataset: string | null;
  drug_name: string | null;
  brand_name: string | null;
  generic_name: string | null;
  manufacturer_name: string | null;
};

type FdaLabelAgentResult = {
  answer: string;
  rows: Record<string, string | number>[];
  sqlQuery: string;
  sources: SourceEvidence[];
  entities: Record<string, unknown>;
  route: "RAG_ONLY";
  composer?: Record<string, unknown>;
  verification?: ReturnType<typeof verifyGroundedAnswer>;
};

const defaultTargetDrugs =
  "Anoro Ellipta,Adempas,Arexvy,Trelegy Ellipta,Breo Ellipta,Advair Diskus,Spiriva,Symbicort,Eliquis,Januvia,Ozempic,Trulicity,Humira,Stelara,Dupixent,Keytruda,Ibrance,Farxiga,Jardiance";

const aliases: Record<string, string[]> = {
  "Anoro Ellipta": ["anoro", "anoro ellipta"],
  Adempas: ["adempas", "riociguat"],
  Arexvy: ["arexvy"],
  "Trelegy Ellipta": ["trelegy", "trelegy ellipta"],
  "Breo Ellipta": ["breo", "breo ellipta"],
  "Advair Diskus": ["advair", "advair diskus"],
  Spiriva: ["spiriva"],
  Symbicort: ["symbicort"],
  Eliquis: ["eliquis", "apixaban"],
  Januvia: ["januvia", "sitagliptin"],
  Ozempic: ["ozempic", "semaglutide"],
  Trulicity: ["trulicity", "dulaglutide"],
  Humira: ["humira", "adalimumab"],
  Stelara: ["stelara", "ustekinumab"],
  Dupixent: ["dupixent", "dupilumab"],
  Keytruda: ["keytruda", "pembrolizumab", "keytruda qlex"],
  Ibrance: ["ibrance", "palbociclib"],
  Farxiga: ["farxiga", "dapagliflozin"],
  Jardiance: ["jardiance", "empagliflozin"],
};

const envTargetDrugs = (process.env.OPENFDA_TARGET_DRUGS || defaultTargetDrugs)
  .split(",")
  .map((drug) => drug.trim())
  .filter(Boolean);

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

function cleanLabelText(value: unknown) {
  return clean(value)
    .replace(/Source:\s*openFDA Drug Label Dataset/gi, "")
    .replace(/Title:\s*openFDA label:/gi, "")
    .replace(/Drug:\s*/gi, "")
    .replace(/Brand name:\s*/gi, "")
    .replace(/Generic name:\s*/gi, "")
    .replace(/Manufacturer:\s*/gi, "")
    .replace(/Section:\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateSentence(value: string, maxLength = 320) {
  const text = cleanLabelText(value);

  if (text.length <= maxLength) return text;

  const clipped = text.slice(0, maxLength);
  const lastPeriod = clipped.lastIndexOf(".");

  if (lastPeriod > 120) {
    return clipped.slice(0, lastPeriod + 1).trim();
  }

  return `${clipped.trim()}...`;
}

function buildAliasMap() {
  const map = new Map<string, Set<string>>();

  for (const drug of envTargetDrugs) {
    const existing = map.get(drug) || new Set<string>();
    existing.add(drug);

    const first = normalize(drug).split(" ")[0];

    if (first.length >= 4) existing.add(first);

    map.set(drug, existing);
  }

  for (const [canonical, values] of Object.entries(aliases)) {
    const existing = map.get(canonical) || new Set<string>();

    for (const value of values) existing.add(value);

    map.set(canonical, existing);
  }

  return Array.from(map.entries()).map(([canonical, values]) => ({
    canonical,
    aliases: Array.from(values).map(normalize),
  }));
}

const aliasMap = buildAliasMap();

function extractDrugCandidate(question: string) {
  const text = normalize(question);

  for (const item of aliasMap) {
    if (item.aliases.some((alias) => text.includes(alias))) {
      return item.canonical;
    }
  }

  return clean(
    question
      .replace(/[?.,]/g, " ")
      .replace(
        /\b(what|is|are|the|fda|label|used|for|warnings|warning|adverse|reactions|reaction|dosage|dose|contraindications|contraindication|safety|side|effects|according|to|loaded|evidence|tell|me|about|summarize|use|indication|indications)\b/gi,
        " "
      )
      .replace(/\s+/g, " ")
      .trim()
  );
}

function patternsForDrug(drug: string) {
  const normalizedDrug = normalize(drug);
  const found = aliasMap.find(
    (item) =>
      normalize(item.canonical) === normalizedDrug ||
      item.aliases.includes(normalizedDrug)
  );

  const values = new Set<string>();

  if (drug) {
    values.add(drug);
    const first = normalize(drug).split(" ")[0];
    if (first.length >= 4) values.add(first);
  }

  if (found) {
    values.add(found.canonical);
    for (const alias of found.aliases) values.add(alias);
  }

  return Array.from(values)
    .map(clean)
    .filter(Boolean)
    .map((value) => `%${value}%`);
}

function requestedSectionIntent(question: string) {
  const q = normalize(question);

  if (q.includes("warning") || q.includes("safety") || q.includes("precaution")) {
    return "warnings";
  }

  if (q.includes("adverse") || q.includes("side effect") || q.includes("reaction")) {
    return "adverse";
  }

  if (q.includes("dosage") || q.includes("dose")) {
    return "dosage";
  }

  if (q.includes("used for") || q.includes("treat") || q.includes("indication") || q.includes("use")) {
    return "indication";
  }

  if (q.includes("contraindication")) {
    return "contraindication";
  }

  return "general";
}

function preferredSectionRank(question: string, section: string | null) {
  const intent = requestedSectionIntent(question);
  const s = normalize(section || "");

  if (intent === "warnings") {
    if (s.includes("warning")) return 0;
    if (s.includes("contraindication")) return 1;
    if (s.includes("adverse")) return 2;
  }

  if (intent === "adverse") {
    if (s.includes("adverse")) return 0;
    if (s.includes("warning")) return 1;
  }

  if (intent === "dosage") {
    if (s.includes("dosage")) return 0;
  }

  if (intent === "indication") {
    if (s.includes("indication")) return 0;
    if (s.includes("purpose")) return 1;
    if (s.includes("description")) return 2;
  }

  if (intent === "contraindication") {
    if (s.includes("contraindication")) return 0;
    if (s.includes("warning")) return 1;
  }

  if (s.includes("indication")) return 10;
  if (s.includes("warning")) return 11;
  if (s.includes("adverse")) return 12;
  if (s.includes("dosage")) return 13;
  if (s.includes("contraindication")) return 14;
  return 99;
}

function sectionGroup(section: string | null) {
  const s = normalize(section || "unknown");

  if (s.includes("indication") || s.includes("purpose")) return "indication";
  if (s.includes("warning") || s.includes("precaution")) return "warnings";
  if (s.includes("adverse")) return "adverse";
  if (s.includes("dosage") || s.includes("administration")) return "dosage";
  if (s.includes("contraindication")) return "contraindication";
  if (s.includes("description")) return "description";
  return s;
}

async function retrieveChunks(question: string, drug: string) {
  const patterns = patternsForDrug(drug);
  const safePatterns = patterns.length > 0 ? patterns : ["%__no_match__%"];

  const rows = await sql<FdaChunkRow[]>`
    select
      dc.id::text as id,
      dc.chunk_text,
      dc.section,
      dc.chunk_index,
      d.title,
      coalesce(dc.source_url, d.source_url) as source_url,
      coalesce(dc.source_dataset, d.source_dataset, 'openFDA Drug Label Dataset') as source_dataset,
      coalesce(dc.drug_name, d.drug_name, dc.metadata->>'drugName', d.metadata->>'drugName', '') as drug_name,
      coalesce(dc.brand_name, d.brand_name, dc.metadata->>'brandName', d.metadata->>'brandName', '') as brand_name,
      coalesce(dc.generic_name, d.generic_name, dc.metadata->>'genericName', d.metadata->>'genericName', '') as generic_name,
      coalesce(dc.manufacturer_name, d.manufacturer_name, dc.metadata->>'manufacturerName', d.metadata->>'manufacturerName', '') as manufacturer_name
    from document_chunks dc
    left join documents d on d.id = dc.document_id
    where dc.source_type = 'drug_label'
      and (
        dc.drug_name ilike any(${safePatterns})
        or dc.brand_name ilike any(${safePatterns})
        or dc.generic_name ilike any(${safePatterns})
        or d.drug_name ilike any(${safePatterns})
        or d.brand_name ilike any(${safePatterns})
        or d.generic_name ilike any(${safePatterns})
        or d.title ilike any(${safePatterns})
        or dc.chunk_text ilike any(${safePatterns})
        or dc.metadata::text ilike any(${safePatterns})
        or d.metadata::text ilike any(${safePatterns})
      )
    order by
      case
        when lower(coalesce(dc.section, '')) like '%indication%' then 1
        when lower(coalesce(dc.section, '')) like '%warning%' then 2
        when lower(coalesce(dc.section, '')) like '%adverse%' then 3
        when lower(coalesce(dc.section, '')) like '%dosage%' then 4
        when lower(coalesce(dc.section, '')) like '%contraindication%' then 5
        else 9
      end,
      dc.chunk_index asc nulls last
    limit 12
  `;

  const intent = requestedSectionIntent(question);
  const sortedRows = rows.sort(
    (a, b) =>
      preferredSectionRank(question, a.section) -
      preferredSectionRank(question, b.section)
  );

  const selected: FdaChunkRow[] = [];
  const seenGroups = new Set<string>();
  const seenText = new Set<string>();

  for (const row of sortedRows) {
    const group = sectionGroup(row.section);
    const fingerprint = normalize(truncateSentence(row.chunk_text, 180));

    if (seenText.has(fingerprint)) continue;

    if (intent !== "general" && selected.length >= 1) break;

    if (intent === "general" && seenGroups.has(group)) continue;

    selected.push(row);
    seenGroups.add(group);
    seenText.add(fingerprint);

    if (selected.length >= 2) break;
  }

  return selected;
}

function buildSources(rows: FdaChunkRow[]) {
  const kbSources: SourceEvidence[] = rows.map((row, index) => {
    const label = `KB-${index + 1}`;
    const drug = clean(row.drug_name || row.brand_name || row.title || "Requested drug");

    return {
      id: row.id,
      title: row.title || `openFDA label: ${drug}`,
      dataset: clean(row.source_dataset || "openFDA Drug Label Dataset"),
      score: Number((1 - index * 0.05).toFixed(2)),
      status: "used",
      excerpt: truncateSentence(row.chunk_text, 700),
      metadata: [
        `Citation: [${label}]`,
        `Drug: ${drug}`,
        `Brand name: ${clean(row.brand_name || "")}`,
        `Generic name: ${clean(row.generic_name || "")}`,
        `Manufacturer: ${clean(row.manufacturer_name || "")}`,
        `Section: ${clean(row.section || "Unknown")}`,
        `Source URL: ${clean(row.source_url || "")}`,
      ].filter(Boolean),
      citationLabel: label,
      citationType: "kb",
    };
  });

  const limitSource: SourceEvidence = {
    id: "openfda-label-limitation",
    title: "FDA label evidence limitation",
    dataset: "System limitation",
    score: 1,
    status: "used",
    excerpt:
      "This answer uses FDA label evidence available to PharmaRev. It is not medical advice.",
    metadata: ["Citation: [LIMIT-1]", "Scope: available FDA label evidence only"],
    citationLabel: "LIMIT-1",
    citationType: "limit",
  };

  return [...kbSources, limitSource];
}

function sectionTitle(source: SourceEvidence) {
  return (
    source.metadata
      .find((item) => item.startsWith("Section:"))
      ?.replace("Section:", "")
      .trim() || "Label evidence"
  );
}

function buildAnswer({
  question,
  drug,
  sources,
}: {
  question: string;
  drug: string;
  sources: SourceEvidence[];
}) {
  const kbSources = sources.filter((source) => source.citationType === "kb");
  const displayDrug = drug || "the requested drug";
  const intent = requestedSectionIntent(question);

  if (kbSources.length === 0) {
    return [
      `I could not find enough FDA label evidence for ${displayDrug}. [LIMIT-1]`,
      "",
      "Data limitation: This answer uses only FDA label evidence available to PharmaRev and is not medical advice. [LIMIT-1]",
    ].join("\n");
  }

  const introByIntent: Record<string, string> = {
    indication: `Here is what the available FDA label evidence says about the use or indication for ${displayDrug}. [KB-1]`,
    warnings: `Here is the available FDA label warning or safety context for ${displayDrug}. [KB-1]`,
    adverse: `Here is the available FDA label adverse-reaction context for ${displayDrug}. [KB-1]`,
    dosage: `Here is the available FDA label dosage context for ${displayDrug}. [KB-1]`,
    contraindication: `Here is the available FDA label contraindication context for ${displayDrug}. [KB-1]`,
    general: `Here is the relevant FDA label evidence for ${displayDrug}. [KB-1]`,
  };

  const bullets = kbSources.slice(0, intent === "general" ? 2 : 1).map((source) => {
    return `- **${sectionTitle(source)}:** ${truncateSentence(source.excerpt, 300)} [${source.citationLabel}]`;
  });

  return [
    introByIntent[intent] || introByIntent.general,
    "",
    ...bullets,
    "",
    "Data limitation: This answer uses only FDA label evidence available to PharmaRev and is not medical advice. [LIMIT-1]",
  ].join("\n");
}

export async function answerFdaLabelQuestion(
  question: string
): Promise<FdaLabelAgentResult> {
  const drug = extractDrugCandidate(question);
  const chunks = await retrieveChunks(question, drug);
  const sources = buildSources(chunks);

  const answer = buildAnswer({
    question,
    drug,
    sources,
  });

  const verification = verifyGroundedAnswer({
    answer,
    sources,
    rows: [],
    needsSql: false,
    needsRag: true,
  });

  return {
    answer,
    rows: [],
    sqlQuery: `Direct FDA label evidence lookup for drug="${drug}"`,
    sources,
    entities: {
      drugCandidate: drug,
      sourceType: "drug_label",
      retrievalMode: "direct_fda_label_evidence_lookup",
      retrievedChunkCount: chunks.length,
      selectedSections: chunks.map((chunk) => chunk.section || "Unknown"),
    },
    route: "RAG_ONLY",
    composer: {
      role: "deterministic_fda_label_agent",
      usedLlm: false,
      status: "complete",
      dedupe: "one_chunk_per_requested_section",
    },
    verification,
  };
}

export const answerOpenFdaLabelQuestion = answerFdaLabelQuestion;
export const answerFdaQuestion = answerFdaLabelQuestion;
