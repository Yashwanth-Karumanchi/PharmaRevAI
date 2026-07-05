import dotenv from "dotenv";
import postgres from "postgres";

dotenv.config({ path: ".env.local" });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("Missing DATABASE_URL in .env.local");
}

const sql = postgres(databaseUrl, {
  ssl: "require",
});

type KnowledgeBaseDocument = {
  sourceName: string;
  sourceType: string;
  datasetName: string;
  title: string;
  url: string;
  chunks: string[];
};

const documents: KnowledgeBaseDocument[] = [
  {
    sourceName: "CMS",
    sourceType: "methodology",
    datasetName: "CMS Medicare Part D Spending by Drug",
    title: "What CMS Part D spending means",
    url: "https://data.cms.gov/",
    chunks: [
      "CMS Medicare Part D Spending by Drug is a public dataset used to analyze spending for drugs prescribed to Medicare beneficiaries enrolled in Part D. In PharmaRev AI, this source is used for public drug spending analysis, not private company revenue analysis.",
      "Part D spending values should not be interpreted as private pharmaceutical profit, internal sales revenue, margin leakage, contract performance, or sales-rep performance. The data supports public spending trends only.",
      "When PharmaRev AI answers spending questions from CMS Part D data, the answer should clearly state that the results are based on public Medicare spending and not rebate-adjusted net revenue or private deal data.",
    ],
  },
  {
    sourceName: "PharmaRev AI",
    sourceType: "data_limit_policy",
    datasetName: "Project Grounding Rules",
    title: "Private deal-loss limitation policy",
    url: "local://pharmarev/policies/private-deal-limits",
    chunks: [
      "The system must not claim to know which private pharma deal was lost unless internal CRM, invoice, contract, rebate, sales-rep, or opportunity data is loaded and queried.",
      "If a user asks about private deal loss, private margin leakage, sales-rep performance, discount leakage, or contract-specific profitability, the system should explain that the current public datasets do not contain that information.",
      "For unsupported private business questions, the system should offer alternative public-data analysis such as Medicare spending trends, drug prescribing patterns, Open Payments activity, FDA product context, or public sales-volume trends.",
    ],
  },
  {
    sourceName: "PharmaRev AI",
    sourceType: "answer_policy",
    datasetName: "Project Grounding Rules",
    title: "SQL and RAG answer policy",
    url: "local://pharmarev/policies/sql-rag-answer-policy",
    chunks: [
      "Numeric claims in PharmaRev AI should come from SQL results, not from free-form language model generation. The assistant should not invent rankings, totals, growth rates, or spending values.",
      "RAG sources should support explanations, definitions, methodology notes, and limitations. SQL should support exact numeric analysis.",
      "If SQL results and retrieved source context do not support a claim, the assistant should remove that claim or explicitly say that the available data is insufficient.",
    ],
  },
  {
    sourceName: "Neon Postgres",
    sourceType: "database_source",
    datasetName: "PharmaRev AI Neon Database",
    title: "Current structured data tables",
    url: "local://pharmarev/database/schema",
    chunks: [
      "The current Neon database includes cms_part_d_spending, chat_sessions, chat_messages, documents, document_chunks, rag_traces, rag_trace_nodes, and rag_trace_edges.",
      "The cms_part_d_spending table stores imported CMS Medicare Part D spending rows with fields such as year, brand_name, generic_name, manufacturer, total_spending, total_claims, total_beneficiaries, and avg_spending_per_dosage_unit.",
      "The document_chunks table stores knowledge base chunks. Embeddings are not required for initial seeding, but later each chunk can receive an embedding vector for semantic RAG retrieval.",
    ],
  },
];

async function main() {
  console.log("Clearing old seeded knowledge base documents...");

  await sql`
    delete from documents
    where source_name in ('CMS', 'PharmaRev AI', 'Neon Postgres')
  `;

  let documentCount = 0;
  let chunkCount = 0;

  for (const document of documents) {
    const insertedDocuments = await sql`
      insert into documents (
        source_name,
        source_type,
        dataset_name,
        title,
        url,
        metadata
      )
      values (
        ${document.sourceName},
        ${document.sourceType},
        ${document.datasetName},
        ${document.title},
        ${document.url},
        ${sql.json({
          seededBy: "scripts/seedKnowledgeBase.ts",
          embeddingStatus: "not_embedded_yet",
        })}
      )
      returning id
    `;

    const documentId = insertedDocuments[0].id;
    documentCount += 1;

    for (let index = 0; index < document.chunks.length; index += 1) {
      await sql`
        insert into document_chunks (
          document_id,
          chunk_text,
          chunk_index,
          source_type,
          metadata
        )
        values (
          ${documentId},
          ${document.chunks[index]},
          ${index},
          ${document.sourceType},
          ${sql.json({
            title: document.title,
            datasetName: document.datasetName,
            sourceName: document.sourceName,
            seededBy: "scripts/seedKnowledgeBase.ts",
          })}
        )
      `;

      chunkCount += 1;
    }
  }

  console.log(`Seeded ${documentCount} documents.`);
  console.log(`Seeded ${chunkCount} chunks.`);
  console.log("Knowledge base seed complete.");

  await sql.end();
}

main().catch(async (error) => {
  console.error(error);
  await sql.end();
  process.exit(1);
});