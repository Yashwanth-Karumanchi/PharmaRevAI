import dotenv from "dotenv";

dotenv.config({ path: ".env.local", override: true });

type AuditStatus = "PASS" | "WARN" | "FAIL";

type AuditResult = {
  area: string;
  check: string;
  status: AuditStatus;
  details: string;
};

type ColumnInfo = {
  column_name: string;
  data_type: string;
  is_nullable: string;
};

const shouldFix = process.argv.includes("--fix");

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function maskDatabaseUrl(value: string | undefined) {
  if (!value) return "missing";

  try {
    const url = new URL(value);
    return `${url.protocol}//${url.username ? "***@" : ""}${url.hostname}${url.pathname}`;
  } catch {
    return "loaded-but-unparseable";
  }
}

function section(title: string) {
  console.log("\n" + "=".repeat(100));
  console.log(title);
  console.log("=".repeat(100));
}

function addResult(
  results: AuditResult[],
  area: string,
  check: string,
  status: AuditStatus,
  details: string
) {
  results.push({ area, check, status, details });
}

async function tableExists(sql: any, tableName: string) {
  const rows = await sql`
    select exists (
      select 1
      from information_schema.tables
      where table_schema = 'public'
        and table_name = ${tableName}
    ) as exists
  `;

  return Boolean(rows[0]?.exists);
}

async function getColumns(sql: any, tableName: string): Promise<ColumnInfo[]> {
  const rows = await sql<ColumnInfo[]>`
    select
      column_name,
      data_type,
      is_nullable
    from information_schema.columns
    where table_schema = 'public'
      and table_name = ${tableName}
    order by ordinal_position
  `;

  return rows;
}

function hasColumn(columns: ColumnInfo[], columnName: string) {
  return columns.some((column) => column.column_name === columnName);
}

function requireColumns({
  results,
  tableName,
  columns,
  required,
}: {
  results: AuditResult[];
  tableName: string;
  columns: ColumnInfo[];
  required: string[];
}) {
  const missing = required.filter((column) => !hasColumn(columns, column));

  addResult(
    results,
    tableName,
    "required_columns",
    missing.length === 0 ? "PASS" : "FAIL",
    missing.length === 0
      ? `All required columns exist: ${required.join(", ")}`
      : `Missing columns: ${missing.join(", ")}`
  );

  return missing;
}

async function fixKnowledgeBaseCompatibility(sql: any, results: AuditResult[]) {
  section("Compatibility fix: knowledgeBaseAgent schema aliases");

  const hasDocuments = await tableExists(sql, "documents");
  const hasChunks = await tableExists(sql, "document_chunks");

  if (!hasDocuments || !hasChunks) {
    addResult(
      results,
      "schema_compatibility",
      "kb_agent_alias_fix",
      "FAIL",
      "documents or document_chunks table is missing."
    );
    return;
  }

  await sql`
    alter table documents
    add column if not exists dataset_name text
  `;

  await sql`
    alter table document_chunks
    add column if not exists dataset_name text
  `;

  await sql`
    update documents
    set dataset_name = coalesce(
      nullif(dataset_name, ''),
      nullif(source_dataset, ''),
      nullif(metadata->>'sourceDataset', ''),
      nullif(metadata->>'datasetName', ''),
      nullif(metadata->>'dataset', ''),
      nullif(source_type, ''),
      'Unknown public dataset'
    )
    where dataset_name is null
       or dataset_name = ''
  `;

  await sql`
    update document_chunks
    set dataset_name = coalesce(
      nullif(dataset_name, ''),
      nullif(source_dataset, ''),
      nullif(metadata->>'sourceDataset', ''),
      nullif(metadata->>'datasetName', ''),
      nullif(metadata->>'dataset', ''),
      nullif(source_type, ''),
      'Unknown public dataset'
    )
    where dataset_name is null
       or dataset_name = ''
  `;

  await sql`
    create index if not exists idx_documents_dataset_name
    on documents (dataset_name)
  `;

  await sql`
    create index if not exists idx_document_chunks_dataset_name
    on document_chunks (dataset_name)
  `;

  const docCheck = await sql`
    select
      count(*)::int as total_documents,
      count(dataset_name)::int as documents_with_dataset_name
    from documents
  `;

  const chunkCheck = await sql`
    select
      count(*)::int as total_chunks,
      count(dataset_name)::int as chunks_with_dataset_name
    from document_chunks
  `;

  console.log("documents dataset_name check:");
  console.table(docCheck);

  console.log("document_chunks dataset_name check:");
  console.table(chunkCheck);

  addResult(
    results,
    "schema_compatibility",
    "kb_agent_alias_fix",
    "PASS",
    "Added/backfilled dataset_name aliases for documents and document_chunks."
  );
}

async function auditCmsPartDSpending(sql: any, results: AuditResult[]) {
  const tableName = "cms_part_d_spending";
  section(tableName);

  if (!(await tableExists(sql, tableName))) {
    addResult(results, tableName, "table_exists", "FAIL", "Table does not exist.");
    return;
  }

  const columns = await getColumns(sql, tableName);
  console.log("Columns:");
  console.table(columns);

  requireColumns({
    results,
    tableName,
    columns,
    required: [
      "year",
      "brand_name",
      "generic_name",
      "manufacturer",
      "total_spending",
      "total_claims",
      "total_beneficiaries",
      "source_dataset",
      "source_url",
      "metadata",
    ],
  });

  const counts = await sql`
    select
      count(*)::int as total_rows,
      count(year)::int as rows_with_year,
      count(brand_name)::int as rows_with_brand_name,
      count(generic_name)::int as rows_with_generic_name,
      count(manufacturer)::int as rows_with_manufacturer,
      count(total_spending)::int as rows_with_total_spending,
      count(total_claims)::int as rows_with_total_claims,
      count(total_beneficiaries)::int as rows_with_total_beneficiaries,
      min(year)::int as min_year,
      max(year)::int as max_year
    from cms_part_d_spending
  `;

  console.log("Counts:");
  console.table(counts);

  const countRow = counts[0] || {};
  const totalRows = toNumber(countRow.total_rows);
  const spendingRows = toNumber(countRow.rows_with_total_spending);
  const maxYear = toNumber(countRow.max_year);

  addResult(
    results,
    tableName,
    "row_count",
    totalRows > 0 ? "PASS" : "FAIL",
    `${totalRows} total rows`
  );

  addResult(
    results,
    tableName,
    "total_spending_populated",
    spendingRows > 0 ? "PASS" : "FAIL",
    `${spendingRows} rows have total_spending`
  );

  addResult(
    results,
    tableName,
    "expected_year_2024",
    maxYear === 2024 ? "PASS" : "WARN",
    `max_year=${maxYear}. Expected 2024 for current eval questions.`
  );

  const yearCounts = await sql`
    select
      year,
      count(*)::int as total_rows,
      count(total_spending)::int as rows_with_total_spending,
      sum(total_spending)::numeric(18, 2) as total_spending_sum
    from cms_part_d_spending
    group by year
    order by year
  `;

  console.log("Year counts:");
  console.table(yearCounts);

  const topRowsMaxYear = await sql`
    select
      brand_name,
      generic_name,
      manufacturer,
      total_spending,
      total_claims,
      total_beneficiaries,
      year
    from cms_part_d_spending
    where year = (select max(year) from cms_part_d_spending)
      and total_spending is not null
    order by total_spending desc nulls last
    limit 10
  `;

  console.log("Top spending rows using max(year):");
  console.table(topRowsMaxYear);

  addResult(
    results,
    tableName,
    "top_rows_max_year",
    topRowsMaxYear.length > 0 ? "PASS" : "FAIL",
    `${topRowsMaxYear.length} rows returned for max(year)`
  );

  const topRows2024 = await sql`
    select
      brand_name,
      generic_name,
      manufacturer,
      total_spending,
      total_claims,
      total_beneficiaries,
      year
    from cms_part_d_spending
    where year = 2024
      and total_spending is not null
    order by total_spending desc nulls last
    limit 10
  `;

  console.log("Top spending rows for 2024:");
  console.table(topRows2024);

  addResult(
    results,
    tableName,
    "top_rows_2024",
    topRows2024.length > 0 ? "PASS" : "FAIL",
    `${topRows2024.length} rows returned for 2024`
  );
}

async function auditCmsPartDPrescribers(sql: any, results: AuditResult[]) {
  const tableName = "cms_part_d_prescribers";
  section(tableName);

  if (!(await tableExists(sql, tableName))) {
    addResult(results, tableName, "table_exists", "FAIL", "Table does not exist.");
    return;
  }

  const columns = await getColumns(sql, tableName);
  console.log("Columns:");
  console.table(columns);

  requireColumns({
    results,
    tableName,
    columns,
    required: [
      "year",
      "brand_name",
      "generic_name",
      "provider_state",
      "provider_specialty",
      "total_drug_cost",
      "total_claim_count",
    ],
  });

  const counts = await sql`
    select
      count(*)::int as total_rows,
      count(year)::int as rows_with_year,
      count(brand_name)::int as rows_with_brand_name,
      count(provider_state)::int as rows_with_provider_state,
      count(provider_specialty)::int as rows_with_provider_specialty,
      count(total_drug_cost)::int as rows_with_total_drug_cost,
      count(total_claim_count)::int as rows_with_total_claim_count,
      min(year)::int as min_year,
      max(year)::int as max_year
    from cms_part_d_prescribers
  `;

  console.log("Counts:");
  console.table(counts);

  const countRow = counts[0] || {};
  const totalRows = toNumber(countRow.total_rows);
  const costRows = toNumber(countRow.rows_with_total_drug_cost);

  addResult(
    results,
    tableName,
    "row_count",
    totalRows > 0 ? "PASS" : "FAIL",
    `${totalRows} total rows`
  );

  addResult(
    results,
    tableName,
    "total_drug_cost_populated",
    costRows > 0 ? "PASS" : "FAIL",
    `${costRows} rows have total_drug_cost`
  );

  const yearCounts = await sql`
    select
      year,
      count(*)::int as total_rows,
      count(total_drug_cost)::int as rows_with_total_drug_cost,
      sum(total_drug_cost)::numeric(18, 2) as total_drug_cost_sum
    from cms_part_d_prescribers
    group by year
    order by year
  `;

  console.log("Year counts:");
  console.table(yearCounts);

  const topRows = await sql`
    select
      brand_name,
      provider_state,
      provider_specialty,
      sum(total_drug_cost)::numeric(18, 2) as total_drug_cost,
      sum(total_claim_count)::numeric(18, 0) as total_claim_count,
      max(year)::int as year
    from cms_part_d_prescribers
    where total_drug_cost is not null
    group by brand_name, provider_state, provider_specialty
    order by sum(total_drug_cost) desc nulls last
    limit 10
  `;

  console.log("Top prescriber rows:");
  console.table(topRows);

  addResult(
    results,
    tableName,
    "top_rows",
    topRows.length > 0 ? "PASS" : "FAIL",
    `${topRows.length} top rows returned`
  );
}

async function auditOpenPayments(sql: any, results: AuditResult[]) {
  const tableName = "open_payments";
  section(tableName);

  if (!(await tableExists(sql, tableName))) {
    addResult(results, tableName, "table_exists", "FAIL", "Table does not exist.");
    return;
  }

  const columns = await getColumns(sql, tableName);
  console.log("Columns:");
  console.table(columns);

  requireColumns({
    results,
    tableName,
    columns,
    required: [
      "program_year",
      "company_name",
      "payment_amount",
      "recipient_state",
      "physician_specialty",
    ],
  });

  const counts = await sql`
    select
      count(*)::int as total_rows,
      count(program_year)::int as rows_with_program_year,
      count(company_name)::int as rows_with_company_name,
      count(payment_amount)::int as rows_with_payment_amount,
      count(recipient_state)::int as rows_with_recipient_state,
      count(physician_specialty)::int as rows_with_physician_specialty,
      min(program_year)::int as min_program_year,
      max(program_year)::int as max_program_year
    from open_payments
  `;

  console.log("Counts:");
  console.table(counts);

  const countRow = counts[0] || {};
  const totalRows = toNumber(countRow.total_rows);
  const paymentRows = toNumber(countRow.rows_with_payment_amount);

  addResult(
    results,
    tableName,
    "row_count",
    totalRows > 0 ? "PASS" : "FAIL",
    `${totalRows} total rows`
  );

  addResult(
    results,
    tableName,
    "payment_amount_populated",
    paymentRows > 0 ? "PASS" : "FAIL",
    `${paymentRows} rows have payment_amount`
  );

  const yearCounts = await sql`
    select
      program_year,
      count(*)::int as total_rows,
      count(payment_amount)::int as rows_with_payment_amount,
      sum(payment_amount)::numeric(18, 2) as payment_amount_sum
    from open_payments
    group by program_year
    order by program_year
  `;

  console.log("Program year counts:");
  console.table(yearCounts);

  const topRows = await sql`
    select
      company_name,
      sum(payment_amount)::numeric(18, 2) as total_payment_amount,
      count(*)::int as payment_count,
      max(program_year)::int as program_year
    from open_payments
    where payment_amount is not null
    group by company_name
    order by sum(payment_amount) desc nulls last
    limit 10
  `;

  console.log("Top payment rows:");
  console.table(topRows);

  addResult(
    results,
    tableName,
    "top_rows",
    topRows.length > 0 ? "PASS" : "FAIL",
    `${topRows.length} top rows returned`
  );
}

async function auditPharmaSales(sql: any, results: AuditResult[]) {
  const tableName = "pharma_sales";
  section(tableName);

  if (!(await tableExists(sql, tableName))) {
    addResult(results, tableName, "table_exists", "FAIL", "Table does not exist.");
    return;
  }

  const columns = await getColumns(sql, tableName);
  console.log("Columns:");
  console.table(columns);

  requireColumns({
    results,
    tableName,
    columns,
    required: ["sale_year", "sale_month", "atc_category", "quantity_sold"],
  });

  const counts = await sql`
    select
      count(*)::int as total_rows,
      count(sale_year)::int as rows_with_sale_year,
      count(sale_month)::int as rows_with_sale_month,
      count(atc_category)::int as rows_with_atc_category,
      count(quantity_sold)::int as rows_with_quantity_sold,
      min(sale_year)::int as min_sale_year,
      max(sale_year)::int as max_sale_year
    from pharma_sales
  `;

  console.log("Counts:");
  console.table(counts);

  const countRow = counts[0] || {};
  const totalRows = toNumber(countRow.total_rows);
  const quantityRows = toNumber(countRow.rows_with_quantity_sold);

  addResult(
    results,
    tableName,
    "row_count",
    totalRows > 0 ? "PASS" : "FAIL",
    `${totalRows} total rows`
  );

  addResult(
    results,
    tableName,
    "quantity_sold_populated",
    quantityRows > 0 ? "PASS" : "FAIL",
    `${quantityRows} rows have quantity_sold`
  );

  const badCategories = await sql`
    select
      atc_category,
      count(*)::int as row_count,
      sum(quantity_sold)::numeric(18, 2) as total_quantity
    from pharma_sales
    where upper(coalesce(atc_category, '')) in ('YEAR', 'MONTH', 'HOUR', 'WEEKDAY')
    group by atc_category
    order by row_count desc
  `;

  console.log("Bad category pollution check:");
  console.table(badCategories);

  addResult(
    results,
    tableName,
    "bad_category_pollution",
    badCategories.length === 0 ? "PASS" : "WARN",
    badCategories.length === 0
      ? "No YEAR/MONTH/HOUR/WEEKDAY pollution found."
      : `${badCategories.length} polluted category values found.`
  );

  const topRows = await sql`
    select
      atc_category,
      sum(quantity_sold)::numeric(18, 2) as total_quantity_sold,
      count(*)::int as row_count,
      min(sale_year)::int as min_year,
      max(sale_year)::int as max_year
    from pharma_sales
    where quantity_sold is not null
      and atc_category is not null
      and upper(atc_category) not in ('YEAR', 'MONTH', 'HOUR', 'WEEKDAY')
    group by atc_category
    order by sum(quantity_sold) desc nulls last
    limit 10
  `;

  console.log("Top sales rows:");
  console.table(topRows);

  addResult(
    results,
    tableName,
    "top_rows",
    topRows.length > 0 ? "PASS" : "FAIL",
    `${topRows.length} top rows returned`
  );
}

async function auditDocumentsAndChunks(sql: any, results: AuditResult[]) {
  section("documents + document_chunks");

  const hasDocuments = await tableExists(sql, "documents");
  const hasChunks = await tableExists(sql, "document_chunks");

  if (!hasDocuments) {
    addResult(results, "documents", "table_exists", "FAIL", "documents table missing.");
    return;
  }

  if (!hasChunks) {
    addResult(results, "document_chunks", "table_exists", "FAIL", "document_chunks table missing.");
    return;
  }

  const docColumns = await getColumns(sql, "documents");
  const chunkColumns = await getColumns(sql, "document_chunks");

  console.log("documents columns:");
  console.table(docColumns);

  console.log("document_chunks columns:");
  console.table(chunkColumns);

  const missingDocColumns = requireColumns({
    results,
    tableName: "documents",
    columns: docColumns,
    required: [
      "id",
      "title",
      "source_type",
      "source_dataset",
      "source_url",
      "metadata",
      "dataset_name",
    ],
  });

  const missingChunkColumns = requireColumns({
    results,
    tableName: "document_chunks",
    columns: chunkColumns,
    required: [
      "id",
      "document_id",
      "chunk_text",
      "source_type",
      "source_dataset",
      "source_url",
      "metadata",
      "embedding",
      "embedding_model",
      "drug_name",
      "brand_name",
      "generic_name",
      "manufacturer_name",
      "dataset_name",
    ],
  });

  if (shouldFix && (missingDocColumns.includes("dataset_name") || missingChunkColumns.includes("dataset_name"))) {
    await fixKnowledgeBaseCompatibility(sql, results);
  }

  const docCounts = await sql`
    select
      source_type,
      count(*)::int as document_count,
      count(source_dataset)::int as documents_with_source_dataset,
      count(source_url)::int as documents_with_source_url
    from documents
    group by source_type
    order by document_count desc
  `;

  console.log("Document counts:");
  console.table(docCounts);

  const chunkCounts = await sql`
    select
      source_type,
      count(*)::int as chunk_count,
      count(embedding)::int as embedded_chunk_count,
      count(drug_name)::int as chunks_with_drug_name,
      count(source_dataset)::int as chunks_with_source_dataset,
      count(source_url)::int as chunks_with_source_url
    from document_chunks
    group by source_type
    order by chunk_count desc
  `;

  console.log("Chunk counts:");
  console.table(chunkCounts);

  const drugLabelRow = chunkCounts.find((row: any) => row.source_type === "drug_label");
  const drugLabelChunks = toNumber(drugLabelRow?.chunk_count);
  const embeddedDrugLabelChunks = toNumber(drugLabelRow?.embedded_chunk_count);

  addResult(
    results,
    "document_chunks",
    "drug_label_chunks",
    drugLabelChunks > 0 ? "PASS" : "FAIL",
    `${drugLabelChunks} drug label chunks`
  );

  addResult(
    results,
    "document_chunks",
    "drug_label_embeddings",
    embeddedDrugLabelChunks > 0 ? "PASS" : "FAIL",
    `${embeddedDrugLabelChunks} embedded drug label chunks`
  );

  const targetDrugs = [
    "anoro",
    "ellipta",
    "eliquis",
    "ozempic",
    "humira",
    "keytruda",
    "jardiance",
    "farxiga",
  ];

  for (const target of targetDrugs) {
    const rows = await sql`
      select
        count(*)::int as matching_chunks,
        count(embedding)::int as embedded_chunks
      from document_chunks
      where source_type = 'drug_label'
        and (
          drug_name ilike ${`%${target}%`}
          or brand_name ilike ${`%${target}%`}
          or chunk_text ilike ${`%${target}%`}
        )
    `;

    console.log(`Drug label check: ${target}`);
    console.table(rows);

    addResult(
      results,
      "document_chunks",
      `${target}_label_check`,
      toNumber(rows[0]?.matching_chunks) > 0 ? "PASS" : "WARN",
      `${toNumber(rows[0]?.matching_chunks)} chunks, ${toNumber(rows[0]?.embedded_chunks)} embedded`
    );
  }
}

async function runRawSqlSmokeTests(sql: any, results: AuditResult[]) {
  section("Raw SQL smoke tests");

  const tests = [
    {
      name: "cms_part_d_spending_top_2024",
      query: async () => sql`
        select brand_name, generic_name, manufacturer, total_spending, year
        from cms_part_d_spending
        where year = 2024
          and total_spending is not null
        order by total_spending desc nulls last
        limit 10
      `,
    },
    {
      name: "cms_part_d_spending_top_max_year",
      query: async () => sql`
        select brand_name, generic_name, manufacturer, total_spending, year
        from cms_part_d_spending
        where year = (select max(year) from cms_part_d_spending)
          and total_spending is not null
        order by total_spending desc nulls last
        limit 10
      `,
    },
    {
      name: "cms_part_d_prescriber_state_cost",
      query: async () => sql`
        select brand_name, provider_state, sum(total_drug_cost)::numeric(18, 2) as total_drug_cost
        from cms_part_d_prescribers
        where total_drug_cost is not null
        group by brand_name, provider_state
        order by sum(total_drug_cost) desc nulls last
        limit 10
      `,
    },
    {
      name: "open_payments_top_companies",
      query: async () => sql`
        select company_name, sum(payment_amount)::numeric(18, 2) as total_payment_amount
        from open_payments
        where payment_amount is not null
        group by company_name
        order by sum(payment_amount) desc nulls last
        limit 10
      `,
    },
    {
      name: "pharma_sales_top_categories",
      query: async () => sql`
        select atc_category, sum(quantity_sold)::numeric(18, 2) as total_quantity_sold
        from pharma_sales
        where quantity_sold is not null
          and atc_category is not null
          and upper(atc_category) not in ('YEAR', 'MONTH', 'HOUR', 'WEEKDAY')
        group by atc_category
        order by sum(quantity_sold) desc nulls last
        limit 10
      `,
    },
    {
      name: "openfda_anoro_chunks",
      query: async () => sql`
        select id, drug_name, section, left(chunk_text, 120) as preview
        from document_chunks
        where source_type = 'drug_label'
          and (
            drug_name ilike '%anoro%'
            or brand_name ilike '%anoro%'
            or chunk_text ilike '%anoro%'
          )
        limit 10
      `,
    },
  ];

  for (const test of tests) {
    try {
      const startedAt = Date.now();
      const rows = await test.query();
      const latencyMs = Date.now() - startedAt;

      console.log(`\n${test.name}`);
      console.log({ rowCount: rows.length, latencyMs });
      console.table(rows);

      addResult(
        results,
        "raw_sql",
        test.name,
        rows.length > 0 ? "PASS" : "FAIL",
        `${rows.length} rows, ${latencyMs}ms`
      );
    } catch (error) {
      console.log(`\n${test.name} failed`);
      console.error(error);

      addResult(
        results,
        "raw_sql",
        test.name,
        "FAIL",
        error instanceof Error ? error.message : "Unknown SQL error"
      );
    }
  }
}

async function runAgentSmokeTests(results: AuditResult[]) {
  section("Agent smoke tests");

  const tests = [
    {
      name: "part_d_top_spending_agent",
      modulePath: "../lib/agents/partDSpendingAgent",
      exports: [
        "answerPartDTopSpendingQuestion",
        "answerTopPartDSpendingQuestion",
        "answerPartDQuestion",
      ],
      question: "Which drugs had the highest Medicare Part D spending in 2024?",
      needsRowsOrSources: true,
    },
    {
      name: "part_d_drug_trend_agent",
      modulePath: "../lib/agents/partDSpendingAgent",
      exports: [
        "answerPartDDrugTrendQuestion",
        "answerPartDTrendQuestion",
        "answerDrugTrendQuestion",
      ],
      question: "Show public Medicare Part D spending for Eliquis.",
      needsRowsOrSources: true,
    },
    {
      name: "part_d_prescriber_agent",
      modulePath: "../lib/agents/partDPrescriberAgent",
      exports: [
        "answerPartDPrescriberQuestion",
        "answerPartDPrescriberAnalysisQuestion",
        "answerPrescriberQuestion",
      ],
      question: "Which states had the highest CMS Part D prescriber cost for Anoro Ellipta?",
      needsRowsOrSources: true,
    },
    {
      name: "open_payments_agent",
      modulePath: "../lib/agents/openPaymentsAgent",
      exports: [
        "answerOpenPaymentsQuestion",
        "answerOpenPaymentsAnalysisQuestion",
        "answerPaymentsQuestion",
      ],
      question: "Which companies made the highest Open Payments in 2024?",
      needsRowsOrSources: true,
    },
    {
      name: "pharma_sales_agent",
      modulePath: "../lib/agents/pharmaSalesAgent",
      exports: [
        "answerPharmaSalesQuestion",
        "answerPharmaSalesAnalysisQuestion",
        "answerSalesQuestion",
      ],
      question: "Which pharma sales categories had the highest quantity sold?",
      needsRowsOrSources: true,
    },
    {
      name: "openfda_label_agent",
      modulePath: "../lib/agents/fdaLabelAgent",
      exports: [
        "answerFdaLabelQuestion",
        "answerOpenFdaLabelQuestion",
        "answerFdaQuestion",
      ],
      question: "What is Anoro Ellipta used for?",
      needsRowsOrSources: true,
    },
  ];

  for (const test of tests) {
    try {
      const module = await import(test.modulePath);
      const record = module as Record<string, any>;

      const fn = test.exports
        .map((name) => record[name])
        .find((candidate) => typeof candidate === "function");

      if (!fn) {
        addResult(
          results,
          test.name,
          "export_exists",
          "FAIL",
          `Missing expected exports: ${test.exports.join(", ")}`
        );
        continue;
      }

      const startedAt = Date.now();
      const result = await fn(test.question);
      const latencyMs = Date.now() - startedAt;

      const answer = clean(result?.answer);
      const rowCount = Array.isArray(result?.rows) ? result.rows.length : 0;
      const sourceCount = Array.isArray(result?.sources) ? result.sources.length : 0;

      console.log(`\n${test.name}`);
      console.log({
        question: test.question,
        latencyMs,
        rowCount,
        sourceCount,
        route: result?.route,
        hasSqlQuery: Boolean(result?.sqlQuery),
        preview: answer.slice(0, 300),
      });

      const pass =
        Boolean(answer) &&
        (!test.needsRowsOrSources || rowCount > 0 || sourceCount > 0 || answer.includes("[LIMIT-1]"));

      addResult(
        results,
        test.name,
        "agent_smoke_test",
        pass ? "PASS" : "FAIL",
        `latency=${latencyMs}ms rowCount=${rowCount} sourceCount=${sourceCount}`
      );
    } catch (error) {
      console.log(`\n${test.name} failed`);
      console.error(error);

      addResult(
        results,
        test.name,
        "agent_smoke_test",
        "FAIL",
        error instanceof Error ? error.message : "Unknown agent error"
      );
    }
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is missing. Check .env.local.");
  }

  const { sql } = await import("../lib/db/client");

  console.log("PharmaRev Runtime Doctor");
  console.log({
    databaseUrl: maskDatabaseUrl(process.env.DATABASE_URL),
    shouldFix,
    embeddingProvider: process.env.EMBEDDING_PROVIDER,
    localEmbeddingModel: process.env.LOCAL_EMBEDDING_MODEL,
    vectorRetrieval: process.env.ENABLE_VECTOR_RETRIEVAL,
  });

  const results: AuditResult[] = [];

  if (shouldFix) {
    await fixKnowledgeBaseCompatibility(sql, results);
  }

  await auditCmsPartDSpending(sql, results);
  await auditCmsPartDPrescribers(sql, results);
  await auditOpenPayments(sql, results);
  await auditPharmaSales(sql, results);
  await auditDocumentsAndChunks(sql, results);
  await runRawSqlSmokeTests(sql, results);
  await runAgentSmokeTests(results);

  section("Final summary");

  console.table(results);

  const passed = results.filter((result) => result.status === "PASS");
  const warnings = results.filter((result) => result.status === "WARN");
  const failures = results.filter((result) => result.status === "FAIL");

  console.log({
    totalChecks: results.length,
    passed: passed.length,
    warnings: warnings.length,
    failures: failures.length,
  });

  if (warnings.length > 0) {
    console.log("\nWarnings:");
    console.table(warnings);
  }

  if (failures.length > 0) {
    console.log("\nFailures:");
    console.table(failures);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Runtime doctor failed:");
  console.error(error);
  process.exit(1);
});