import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

type CmsDrugRow = {
  brand_name: string | null;
  generic_name: string | null;
  total_spending: string;
};

type OpenFdaLabelRecord = {
  id?: string;
  set_id?: string;
  effective_time?: string;
  openfda?: {
    brand_name?: string[];
    generic_name?: string[];
    manufacturer_name?: string[];
    product_ndc?: string[];
    substance_name?: string[];
    spl_id?: string[];
  };
  indications_and_usage?: string[];
  purpose?: string[];
  description?: string[];
  dosage_and_administration?: string[];
  warnings?: string[];
  adverse_reactions?: string[];
  contraindications?: string[];
  clinical_pharmacology?: string[];
};

type OpenFdaLabelResponse = {
  results?: OpenFdaLabelRecord[];
  error?: {
    code?: string;
    message?: string;
  };
};

type LabelSection = {
  sectionName: string;
  text: string;
};

const openFdaLabelUrl = "https://api.fda.gov/drug/label.json";

const maxDrugsToTry = Number(process.env.OPENFDA_MAX_DRUGS ?? 25);
const maxLabelsPerDrug = Number(process.env.OPENFDA_LABELS_PER_DRUG ?? 3);
const requestDelayMs = Number(process.env.OPENFDA_REQUEST_DELAY_MS ?? 250);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function cleanDrugNameForSearch(value: string) {
  return value
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstValue(value: string[] | undefined) {
  return value?.find((item) => item && item.trim())?.trim() ?? "";
}

function getRecordKey(record: OpenFdaLabelRecord, fallbackDrugName: string) {
  const splId = firstValue(record.openfda?.spl_id);
  const setId = record.set_id ?? "";
  const id = record.id ?? "";

  return (
    splId ||
    setId ||
    id ||
    `${fallbackDrugName}-${record.effective_time ?? "unknown"}`
  );
}

function getRecordTitle(record: OpenFdaLabelRecord, fallbackDrugName: string) {
  const brandName = firstValue(record.openfda?.brand_name) || fallbackDrugName;
  const genericName = firstValue(record.openfda?.generic_name);
  const manufacturer = firstValue(record.openfda?.manufacturer_name);

  const genericText = genericName ? ` (${genericName})` : "";
  const manufacturerText = manufacturer ? ` — ${manufacturer}` : "";

  return `openFDA label: ${brandName}${genericText}${manufacturerText}`;
}

function getRecordDrugName(record: OpenFdaLabelRecord, fallbackDrugName: string) {
  return firstValue(record.openfda?.brand_name) || fallbackDrugName;
}

function getRecordManufacturer(record: OpenFdaLabelRecord) {
  return firstValue(record.openfda?.manufacturer_name) || "Not listed";
}

function getLabelSections(record: OpenFdaLabelRecord): LabelSection[] {
  const sectionCandidates: { sectionName: string; values?: string[] }[] = [
    {
      sectionName: "Indications and Usage",
      values: record.indications_and_usage,
    },
    {
      sectionName: "Purpose",
      values: record.purpose,
    },
    {
      sectionName: "Description",
      values: record.description,
    },
    {
      sectionName: "Dosage and Administration",
      values: record.dosage_and_administration,
    },
    {
      sectionName: "Warnings",
      values: record.warnings,
    },
    {
      sectionName: "Adverse Reactions",
      values: record.adverse_reactions,
    },
    {
      sectionName: "Contraindications",
      values: record.contraindications,
    },
    {
      sectionName: "Clinical Pharmacology",
      values: record.clinical_pharmacology,
    },
  ];

  return sectionCandidates
    .flatMap((section) =>
      (section.values ?? []).map((value) => ({
        sectionName: section.sectionName,
        text: normalizeText(value),
      }))
    )
    .filter((section) => section.text.length > 40);
}

function splitIntoChunks(text: string, maxLength = 1200) {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const next = current ? `${current} ${sentence}` : sentence;

    if (next.length > maxLength && current) {
      chunks.push(current);
      current = sentence;
    } else {
      current = next;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.length > 0 ? chunks : [text.slice(0, maxLength)];
}

function buildChunkText({
  title,
  drugName,
  genericName,
  manufacturer,
  sectionName,
  text,
}: {
  title: string;
  drugName: string;
  genericName: string;
  manufacturer: string;
  sectionName: string;
  text: string;
}) {
  const genericLine = genericName ? `Generic name: ${genericName}\n` : "";

  return `Source: openFDA Drug Label
Dataset: openFDA drug labeling
Title: ${title}
Drug: ${drugName}
${genericLine}Manufacturer: ${manufacturer}
Section: ${sectionName}

${text}`;
}

async function fetchOpenFdaLabelsForField({
  field,
  drugName,
}: {
  field: "openfda.brand_name" | "openfda.generic_name";
  drugName: string;
}) {
  const searchDrugName = cleanDrugNameForSearch(drugName);

  const params = new URLSearchParams({
    search: `${field}:"${searchDrugName}"`,
    limit: String(maxLabelsPerDrug),
  });

  const response = await fetch(`${openFdaLabelUrl}?${params.toString()}`);

  if (!response.ok) {
    return {
      records: [] as OpenFdaLabelRecord[],
      error: `HTTP ${response.status}`,
    };
  }

  const data = (await response.json()) as OpenFdaLabelResponse;

  if (!data.results || data.results.length === 0) {
    return {
      records: [] as OpenFdaLabelRecord[],
      error: data.error?.message ?? "No results",
    };
  }

  return {
    records: data.results,
    error: "",
  };
}

async function fetchOpenFdaLabels({
  brandName,
  genericName,
}: {
  brandName: string;
  genericName: string;
}) {
  const brandResult = await fetchOpenFdaLabelsForField({
    field: "openfda.brand_name",
    drugName: brandName,
  });

  if (brandResult.records.length > 0) {
    return brandResult;
  }

  if (genericName) {
    const genericResult = await fetchOpenFdaLabelsForField({
      field: "openfda.generic_name",
      drugName: genericName,
    });

    if (genericResult.records.length > 0) {
      return genericResult;
    }

    return {
      records: [] as OpenFdaLabelRecord[],
      error: `${brandResult.error}; generic fallback: ${genericResult.error}`,
    };
  }

  return brandResult;
}

async function main() {
  const { sql } = await import("../lib/db/client");

  console.log("Starting openFDA label ingestion...");
  console.log(`Max drugs: ${maxDrugsToTry}`);
  console.log(`Labels per drug: ${maxLabelsPerDrug}`);

  const drugRows = await sql<CmsDrugRow[]>`
    select
      brand_name,
      generic_name,
      sum(total_spending)::numeric::text as total_spending
    from cms_part_d_spending
    where brand_name is not null
      and total_spending is not null
      and lower(coalesce(manufacturer, '')) <> 'overall'
    group by brand_name, generic_name
    order by sum(total_spending) desc
    limit ${maxDrugsToTry}
  `;

  if (drugRows.length === 0) {
    console.log("No CMS Part D drugs found. Load cms_part_d_spending first.");
    return;
  }

  let attemptedDrugs = 0;
  let matchedDrugs = 0;
  let insertedDocuments = 0;
  let skippedDocuments = 0;
  let insertedChunks = 0;

  for (const drugRow of drugRows) {
    const brandName = drugRow.brand_name?.trim();
    const genericName = drugRow.generic_name?.trim() ?? "";

    if (!brandName) {
      continue;
    }

    attemptedDrugs += 1;

    console.log(
      `\n[${attemptedDrugs}/${drugRows.length}] Searching openFDA label for: ${brandName}`
    );

    const { records, error } = await fetchOpenFdaLabels({
      brandName,
      genericName,
    });

    if (records.length === 0) {
      console.log(`No openFDA label found for ${brandName}. ${error}`);
      await sleep(requestDelayMs);
      continue;
    }

    matchedDrugs += 1;
    console.log(`Found ${records.length} openFDA label record(s).`);

    for (const [recordIndex, record] of records.entries()) {
      const recordKey = getRecordKey(record, brandName);

      const existingRows = await sql<{ id: string }[]>`
        select id
        from documents
        where dataset_name = 'openFDA Drug Label'
          and metadata->>'openfda_record_key' = ${recordKey}
        limit 1
      `;

      if (existingRows.length > 0) {
        skippedDocuments += 1;
        console.log(`Skipped existing label document: ${recordKey}`);
        continue;
      }

      const title = getRecordTitle(record, brandName);
      const recordDrugName = getRecordDrugName(record, brandName);
      const recordGenericName = firstValue(record.openfda?.generic_name);
      const manufacturer = getRecordManufacturer(record);
      const sections = getLabelSections(record);

      if (sections.length === 0) {
        console.log(`Skipped ${title}; no usable label sections found.`);
        continue;
      }

      const url = `${openFdaLabelUrl}?search=${encodeURIComponent(
        `openfda.brand_name:"${cleanDrugNameForSearch(brandName)}"`
      )}`;

      const documentRows = await sql<{ id: string }[]>`
        insert into documents (
          source_name,
          source_type,
          dataset_name,
          title,
          drug_name,
          manufacturer,
          year,
          url,
          metadata
        )
        values (
          'openFDA',
          'drug_label',
          'openFDA Drug Label',
          ${title},
          ${recordDrugName},
          ${manufacturer},
          null,
          ${url},
          ${sql.json({
            openfda_record_key: recordKey,
            source: "openFDA drug labeling API",
            source_type: "drug_label",
            brand_name: recordDrugName,
            generic_name: recordGenericName,
            manufacturer,
            product_ndc: record.openfda?.product_ndc ?? [],
            substance_name: record.openfda?.substance_name ?? [],
            spl_id: record.openfda?.spl_id ?? [],
            set_id: record.set_id ?? null,
            effective_time: record.effective_time ?? null,
            source_drug_from_cms: brandName,
            source_generic_from_cms: genericName,
            record_index: recordIndex,
          })}
        )
        returning id
      `;

      const documentId = documentRows[0].id;
      insertedDocuments += 1;

      let chunkIndex = 0;

      for (const section of sections) {
        const chunks = splitIntoChunks(section.text);

        for (const chunk of chunks) {
          const chunkText = buildChunkText({
            title,
            drugName: recordDrugName,
            genericName: recordGenericName,
            manufacturer,
            sectionName: section.sectionName,
            text: chunk,
          });

          await sql`
            insert into document_chunks (
              document_id,
              chunk_text,
              chunk_index,
              drug_name,
              manufacturer,
              source_type,
              year,
              metadata
            )
            values (
              ${documentId},
              ${chunkText},
              ${chunkIndex},
              ${recordDrugName},
              ${manufacturer},
              'drug_label',
              null,
              ${sql.json({
                source: "openFDA",
                dataset_name: "openFDA Drug Label",
                source_type: "drug_label",
                section_name: section.sectionName,
                brand_name: recordDrugName,
                generic_name: recordGenericName,
                manufacturer,
                openfda_record_key: recordKey,
                supports: [
                  "drug indication",
                  "drug purpose",
                  "label context",
                  "FDA product-context explanation"
                ],
              })}
            )
          `;

          chunkIndex += 1;
          insertedChunks += 1;
        }
      }

      console.log(`Inserted document with ${chunkIndex} chunks: ${title}`);
    }

    await sleep(requestDelayMs);
  }

  console.log("\nopenFDA label ingestion complete.");
  console.log({
    attemptedDrugs,
    matchedDrugs,
    insertedDocuments,
    skippedDocuments,
    insertedChunks,
  });
}

main().catch((error) => {
  console.error("openFDA label ingestion failed:", error);
  process.exit(1);
});