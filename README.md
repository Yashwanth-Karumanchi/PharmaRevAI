# PharmaRev AI

[Live Demo](https://pharma-rev-ai.vercel.app/) · [GitHub](https://github.com/Yashwanth-Karumanchi/PharmaRevAI)

PharmaRev AI is an agentic RAG platform for public pharma intelligence. It answers natural-language questions across Medicare Part D spending, prescriber costs, Open Payments, public sales trends, and FDA label evidence using a router-driven multi-agent workflow, safe SQL execution, retrieval-augmented generation, citation grounding, and answer-flow visualization.

Instead of sending every question directly to an LLM, PharmaRev AI decides which agentic path is needed: deterministic SQL, FDA-label RAG, hybrid SQL + RAG, ambiguity handling, unrelated-topic firewalling, or private-data refusal.

---

## Tech Stack

![Next.js](https://img.shields.io/badge/Next.js-16-black?style=for-the-badge&logo=nextdotjs)
![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-Strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-Runtime-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-Styling-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)
![Neon](https://img.shields.io/badge/Neon-PostgreSQL-00E599?style=for-the-badge&logo=postgresql&logoColor=white)
![pgvector](https://img.shields.io/badge/pgvector-Embeddings-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)
![Gemini](https://img.shields.io/badge/Google_Gemini-LLM-4285F4?style=for-the-badge&logo=google&logoColor=white)
![RAG](https://img.shields.io/badge/Agentic_RAG-Evidence_Grounded-purple?style=for-the-badge)
![Vector Search](https://img.shields.io/badge/Vector_Search-Local_Embeddings-green?style=for-the-badge)
![Vercel](https://img.shields.io/badge/Vercel-Deployed-black?style=for-the-badge&logo=vercel)

---

## What It Does

PharmaRev AI is built as an agentic public-data analysis system. Each user question is classified, routed, executed, verified, and explained through a structured workflow.

It supports:

- SQL agents for exact rankings, counts, spending values, and prescriber-cost analysis
- RAG agents for FDA label indications, warnings, and public evidence snippets
- Hybrid SQL + RAG agents for answers that require both numbers and narrative evidence
- Context resolver agents for follow-ups like "what about Humira?"
- Guardrail agents for private, unsupported, or unrelated questions
- Grounding verifier agents to check whether claims are supported, limited, or should be refused

The final answer includes citations, query details, process trace, and answer-flow visualization so users can inspect how the system reached its answer.

---

## Agentic RAG Workflow

<img src="docs/architecture.png" alt="Architecture diagram" height="600" width="400"/>

### Core Agents

**Router Agent**
Classifies questions into SQL-only, RAG-only, hybrid SQL/RAG, ambiguous, unrelated, private-unanswerable, or unsupported routes.

**Context Resolver Agent**
Rewrites short follow-ups into full questions using prior conversation state. For example, "what about Humira?" becomes a complete drug-specific query based on the previous intent.

**SQL Agents**
Run safe read-only queries over Neon/Postgres tables for deterministic numeric answers. These agents handle Medicare Part D rankings, prescriber cost concentration, Open Payments summaries, and public sales trend queries.

**RAG Retrieval Agent**
Retrieves FDA label and public evidence chunks using local embeddings and vector search. Retrieved chunks are passed forward as citation-ready evidence.

**Hybrid Agent**
Combines structured SQL results with retrieved FDA/public evidence for questions that need both exact numbers and explanation.

**Answer Composer**
Improves final wording while preserving evidence boundaries. SQL-only numeric answers stay deterministic, while FDA/hybrid answers can be composed into clearer responses.

**Grounding Verifier**
Checks whether claims are supported by SQL rows, retrieved evidence, or limitation rules. Unsupported private-data claims are refused instead of hallucinated.

---

## Interacting with Evidence, Queries, and Visuals

PharmaRev AI is designed to make the agent workflow visible.

**Citation chips**
FDA label and public-evidence claims include clickable citations that open the exact retrieved snippet.

**Query drawer**
SQL-backed answers expose the generated query, filters, aggregations, and result preview.

**Process drawer**
Shows the selected route, executed tool, resolved follow-up question, composer status, and verifier output.

**Answer-flow graph**
Visualizes how the question moved through router, context resolver, tool registry, SQL/RAG agents, verifier, and final answer.

**Data coverage page**
Shows live Neon/Postgres row counts, table previews, and available data coverage.

**Charts and rankings**
Ranking and trend answers are rendered as tables/charts instead of only plain text.

---

## Example Questions

### Medicare Part D Spending

- Which drugs had the highest Medicare Part D spending in 2024?
- What is the spending picture for Eliquis?
- Show the top Medicare Part D drugs by total spending.

### Prescriber Cost Analysis

- For Humira, where were prescriber costs highest?
- Where were Eliquis prescriber costs concentrated?
- Which states had the highest prescriber cost concentration for Trulicity?

### FDA Label RAG

- What is Eliquis used for according to the FDA label?
- What warnings are listed for Keytruda?
- Summarize the FDA label context for Ozempic.

### Hybrid SQL + RAG

- For Keytruda, show spending trend and FDA warnings.
- Compare Eliquis spending with its FDA label indication.
- Give me public spending context and label evidence for Humira.

### Open Payments

- Show Open Payments records related to Eliquis.
- Which companies appear most often in Open Payments data?

### Public Sales Trends

- Show public pharma sales trend data by category.
- Which public sales categories had the strongest movement?

### Unsupported / Private Data Guardrails

These are intentionally refused or qualified:

- Which sales rep lost the most private pharma deals?
- What was the rebate-adjusted net revenue for this drug?
- Which CRM opportunity had the worst margin?

That information is not present in the loaded public datasets, so the assistant explains the limitation instead of inventing an answer.

---

## Loaded Public Data

Configured as a 2024 public-data demo.

| Dataset                     |   Rows |
| --------------------------- | -----: |
| Medicare Part D Spending    | 14,536 |
| Medicare Part D Prescribers | 14,274 |
| Open Payments               | 84,889 |
| Public Pharma Sales         | 16,848 |
| FDA Label Documents         |  1,247 |
| FDA Label Evidence Chunks   |  6,058 |

Total loaded records/chunks: 137K+

Row counts and previews are read live from Neon/Postgres, so the data coverage page updates as the database changes.

---

## Evaluation Results

PharmaRev AI was evaluated on 1,000 questions across SQL-only, RAG-only, hybrid SQL/RAG, ambiguous, private-unanswerable, and unrelated-firewall categories.

| Metric                     |    Result |
| --------------------------- | --------: |
| Overall Pass Rate          |     88.3% |
| Tool Accuracy              |     94.5% |
| Route Accuracy             |     95.8% |
| Citation Support           |     96.3% |
| SQL Success                |       97% |
| Private Refusal Accuracy   |      100% |
| Evidence Recall@5          |       95% |
| Average Evidence MRR       |    0.8692 |
| Verifier Pass/Warning Rate |      100% |
| Average Latency            | 174.86 ms |
| P50 Latency                |    164 ms |
| P95 Latency                |    408 ms |
| Max Latency                |  1,401 ms |

### Category Breakdown

| Category             | Pass Rate |
| --------------------- | --------: |
| SQL Only             |       72% |
| RAG Only             |       92% |
| Hybrid SQL + RAG     |     92.5% |
| Private Unanswerable |      100% |
| Ambiguous            |       80% |
| Unrelated Firewall   |      100% |

---

## Optimizations

- Router-first execution to avoid unnecessary LLM calls
- Deterministic SQL path for numeric claims
- Agentic SQL/RAG/hybrid modes instead of one generic chatbot path
- Local embeddings and vector retrieval for FDA label evidence
- Compact Neon storage strategy for public-data deployment
- 2024-only CMS Part D mode to stay within storage limits
- Live data coverage page with table counts and previews
- LLM composer used only where wording improvement is helpful
- Grounding verifier for supported, limited, and refused answers
- Public-data guardrails for private revenue, rebate, CRM, margin, and sales-rep questions
- Evidence drawer, query drawer, process drawer, and answer-flow graph
- Vercel deployment with ingestion/evaluation scripts excluded from production

---

## Limitations

PharmaRev AI only answers from loaded public datasets. It cannot infer:

- private pharma revenue
- rebate-adjusted net revenue
- discounts or contract terms
- CRM opportunities
- sales-rep performance
- internal margin
- private deal loss
- unsupported year-over-year trends beyond the loaded 2024 demo data

When a question needs unavailable data, the assistant says so clearly.

---

## Local Development

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
```

Start production build locally:

```bash
npm run start
```

Environment variables are configured in `.env.local` locally and in Vercel Project Settings for deployment.

---

## Deployment

Deployed on Vercel:

[https://pharma-rev-ai.vercel.app/](https://pharma-rev-ai.vercel.app/)

Runtime data is served from Neon/Postgres. Local ingestion, evaluation, and maintenance scripts are excluded from deployment.