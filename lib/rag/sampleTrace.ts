import type { RagTrace } from "@/types/rag";

export const sampleRagTrace: RagTrace = {
  question:
    "Which drugs had the biggest Medicare Part D spending increase, and what public evidence explains it?",
  resolvedQuestion:
    "Which drugs had the biggest Medicare Part D spending increase, and what public evidence explains it?",
  route: "HYBRID_SQL_RAG",
  confidence: "High",
  toolName: "part_d_spending_increase_agent",
  answerMode: "hybrid_sql_rag",
  nodes: [
    {
      id: "question",
      type: "question",
      label: "User Question",
      description:
        "The user asked for a spending trend and supporting public evidence.",
      status: "complete",
      details: [
        "Original question: Which drugs had the biggest Medicare Part D spending increase?",
        "The answer needs structured data plus cited public evidence.",
      ],
    },
    {
      id: "context",
      type: "context",
      label: "Conversation Context",
      description:
        "Checked whether the question depends on previous chat context.",
      status: "complete",
      details: [
        "No private context is required.",
        "The question can be answered from loaded public datasets.",
      ],
    },
    {
      id: "router",
      type: "router",
      label: "Router",
      description: "Classified the request and selected the answer path.",
      status: "complete",
      details: [
        "Detected a public pharma analytics question.",
        "Selected a hybrid structured-data and evidence-retrieval route.",
      ],
    },
    {
      id: "intent",
      type: "intent",
      label: "Intent",
      description: "Identified the user intent.",
      status: "complete",
      details: [
        "Intent: compare drug spending movement.",
        "Needs exact numeric claims from database rows.",
        "Needs cited context for public evidence and limitations.",
      ],
    },
    {
      id: "tool",
      type: "tool",
      label: "Selected Tool",
      description: "Selected the registered public-data analysis tool.",
      status: "complete",
      details: [
        "Tool: part_d_spending_increase_agent.",
        "The tool is restricted to supported public datasets.",
      ],
    },
    {
      id: "database",
      type: "database",
      label: "Structured Database",
      description: "Queried structured public data for numeric claims.",
      status: "used",
      score: 0.96,
      details: [
        "Dataset: CMS Medicare Part D Spending by Drug.",
        "Numeric claims should come from database rows.",
        "The answer should not invent spending values.",
      ],
    },
    {
      id: "result",
      type: "result",
      label: "Structured Result",
      description: "Returned structured rows used by the answer.",
      status: "used",
      score: 0.94,
      details: [
        "The result supports rankings and spending values.",
        "The result is used as the source for exact numbers.",
      ],
    },
    {
      id: "retriever",
      type: "retriever",
      label: "Evidence Retriever",
      description: "Retrieved supporting public evidence.",
      status: "complete",
      details: [
        "Searched available FDA label and public evidence chunks.",
        "Matched evidence to the user question.",
        "Rejected unsupported private-business claims.",
      ],
    },
    {
      id: "sources",
      type: "sources",
      label: "Public Sources",
      description: "Collected citation-ready supporting evidence.",
      status: "used",
      score: 0.88,
      details: [
        "Sources can support public label, indication, warning, or dataset-context claims.",
        "Sources do not prove private revenue, rebates, discounts, or sales-rep performance.",
      ],
    },
    {
      id: "limitation",
      type: "limitation",
      label: "Public Data Limitation",
      description: "Explains what the loaded public datasets cannot answer.",
      status: "used",
      score: 0.9,
      details: [
        "No internal CRM data is loaded.",
        "No sales-rep deal-loss data is loaded.",
        "No rebate-adjusted net revenue data is loaded.",
      ],
    },
    {
      id: "composer",
      type: "composer",
      label: "Answer Composer",
      description:
        "Composed the final response while preserving evidence boundaries.",
      status: "complete",
      details: [
        "Structured data supports numeric claims.",
        "Retrieved sources support context claims.",
        "Unsupported private-data claims are limited or refused.",
      ],
    },
    {
      id: "verifier",
      type: "verifier",
      label: "Verifier",
      description: "Checked whether the answer was supported.",
      status: "complete",
      details: [
        "Numeric claims require structured evidence.",
        "Label/context claims require retrieved public evidence.",
        "Private-data claims must be refused or qualified.",
      ],
    },
    {
      id: "answer",
      type: "answer",
      label: "Final Answer",
      description: "Generated the final cited response.",
      status: "complete",
      details: [
        "Direct answer included.",
        "Citations included.",
        "Public-data limitation included where needed.",
      ],
    },
  ],
  edges: [
    {
      id: "e-question-context",
      source: "question",
      target: "context",
      label: "check context",
    },
    {
      id: "e-context-router",
      source: "context",
      target: "router",
      label: "route question",
    },
    {
      id: "e-router-intent",
      source: "router",
      target: "intent",
      label: "classify intent",
    },
    {
      id: "e-intent-tool",
      source: "intent",
      target: "tool",
      label: "select tool",
    },
    {
      id: "e-tool-database",
      source: "tool",
      target: "database",
      label: "query data",
    },
    {
      id: "e-database-result",
      source: "database",
      target: "result",
      label: "return rows",
    },
    {
      id: "e-tool-retriever",
      source: "tool",
      target: "retriever",
      label: "retrieve evidence",
    },
    {
      id: "e-retriever-sources",
      source: "retriever",
      target: "sources",
      label: "collect sources",
    },
    {
      id: "e-retriever-limitation",
      source: "retriever",
      target: "limitation",
      label: "bound claims",
    },
    {
      id: "e-result-composer",
      source: "result",
      target: "composer",
      label: "numeric evidence",
    },
    {
      id: "e-sources-composer",
      source: "sources",
      target: "composer",
      label: "source evidence",
    },
    {
      id: "e-limitation-composer",
      source: "limitation",
      target: "composer",
      label: "limitations",
    },
    {
      id: "e-composer-verifier",
      source: "composer",
      target: "verifier",
      label: "verify",
    },
    {
      id: "e-verifier-answer",
      source: "verifier",
      target: "answer",
      label: "approved",
    },
  ],
};