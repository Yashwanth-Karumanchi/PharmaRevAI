import type { Message } from "@/types/chat";
import type { RagTrace, RagTraceEdge, RagTraceNode, RagNodeStatus } from "@/types/rag";

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function getArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function getRecord(value: unknown) {
  return isRecord(value) ? value : {};
}

function getSourceCounts(metadata: RecordValue) {
  const sources = getArray(metadata.sources).filter(isRecord);

  return {
    total: sources.length,
    sql: sources.filter((source) => source.citationType === "sql").length,
    kb: sources.filter((source) => source.citationType === "kb").length,
    limit: sources.filter((source) => source.citationType === "limit").length,
  };
}

function getVerificationStatus(value: unknown): RagNodeStatus {
  const verification = getRecord(value);
  const status = getString(verification.status).toLowerCase();

  if (status.includes("fail")) return "failed";
  if (status.includes("warn")) return "warning";
  if (status.includes("pass") || status.includes("complete")) return "complete";

  return Object.keys(verification).length > 0 ? "complete" : "warning";
}

function getComposerStatus(value: unknown): RagNodeStatus {
  const composer = getRecord(value);
  const status = getString(composer.status).toLowerCase();

  if (!Object.keys(composer).length) return "skipped";
  if (status.includes("fail")) return "failed";
  if (status.includes("reject")) return "warning";
  if (status.includes("skip")) return "skipped";
  if (status.includes("used") || composer.usedLlm === true) return "complete";

  return "warning";
}

function node(input: RagTraceNode): RagTraceNode {
  return input;
}

function edge(source: string, target: string, label?: string): RagTraceEdge {
  return {
    id: `${source}-${target}`,
    source,
    target,
    label,
  };
}

function getRouterReason(router: RecordValue) {
  const planner = getRecord(router.planner);

  return (
    getString(planner.reason) ||
    getString(router.reason) ||
    "The router selected the most appropriate supported analysis path."
  );
}

function getPlannerStatus(router: RecordValue) {
  const planner = getRecord(router.planner);
  return getString(planner.status, "router_decision");
}

function getAnswerMode(metadata: RecordValue) {
  const composer = getRecord(metadata.composer);

  if (composer.usedLlm === true || getString(composer.status).toLowerCase() === "used") {
    return "LLM-polished answer";
  }

  if (metadata.conversational === true) {
    return "Conversational response";
  }

  return "Deterministic evidence answer";
}

export function buildTraceFromMessage(message: Message | null): RagTrace {
  const metadata = getRecord(message?.metadata);
  const router = getRecord(metadata.router);
  const registry = getRecord(metadata.registry);
  const followUp = getRecord(metadata.followUpResolution);
  const composer = getRecord(metadata.composer);
  const verification = getRecord(metadata.verification);
  const sourceCounts = getSourceCounts(metadata);
  const rows = getArray(metadata.rows);

  const question =
    getString(metadata.originalQuestion) ||
    getString(message?.content, "No question available");
  const resolvedQuestion = getString(metadata.resolvedQuestion, question);
  const route = getString(metadata.route) || getString(router.route, "Unknown route");
  const confidence = getString(router.confidence, "Not stored");
  const toolName =
    getString(metadata.toolName) ||
    getString(router.toolName) ||
    getString(metadata.agent, "Not stored");
  const intent = getString(metadata.intent) || getString(router.intent, "Intent not stored");

  if (metadata.conversational === true) {
    return {
      question,
      resolvedQuestion,
      route: "CONVERSATIONAL",
      confidence: "High",
      toolName: "conversational_assistant",
      answerMode: "Conversational response",
      nodes: [
        node({
          id: "question",
          label: "User message",
          description: question,
          type: "question",
          status: "complete",
          details: [question],
        }),
        node({
          id: "answer",
          label: "Assistant response",
          description: "A conversational help or greeting response was returned without querying public datasets.",
          type: "answer",
          status: "complete",
          details: ["No evidence query was needed for this conversational message."],
        }),
      ],
      edges: [edge("question", "answer")],
    };
  }

  const hasFollowUpRewrite =
    getString(followUp.method) ||
    getString(followUp.reason) ||
    resolvedQuestion !== question;
  const hasSql = Boolean(getString(metadata.sqlQuery) || rows.length > 0 || sourceCounts.sql > 0);
  const hasKb = sourceCounts.kb > 0 || route === "RAG_ONLY" || route === "HYBRID_SQL_RAG";
  const hasLimit = sourceCounts.limit > 0;
  const composerStatus = getComposerStatus(composer);
  const verificationStatus = getVerificationStatus(verification);

  const nodes: RagTraceNode[] = [
    node({
      id: "question",
      label: "Original question",
      description: question,
      type: "question",
      status: "complete",
      details: [`Original question: ${question}`],
    }),
  ];

  if (hasFollowUpRewrite) {
    nodes.push(
      node({
        id: "context",
        label: "Conversation context",
        description: "The question was checked against recent chat history before routing.",
        type: "context",
        status: "complete",
        details: [
          `Resolved question: ${resolvedQuestion}`,
          getString(followUp.reason, "Conversation context was applied when available."),
          getString(followUp.method) ? `Method: ${getString(followUp.method)}` : "Method was not stored.",
        ],
      })
    );
  }

  nodes.push(
    node({
      id: "router",
      label: "Router decision",
      description: `${route} · ${intent}`,
      type: "router",
      status: "complete",
      details: [
        `Route: ${route}`,
        `Intent: ${intent}`,
        `Confidence: ${confidence}`,
        `Planner status: ${getPlannerStatus(router)}`,
        getRouterReason(router),
      ],
    }),
    node({
      id: "tool",
      label: "Selected agent",
      description: toolName,
      type: "tool",
      status: toolName && toolName !== "Not stored" ? "complete" : "warning",
      details: [
        `Tool: ${toolName}`,
        getString(registry.agentName) ? `Registry agent: ${getString(registry.agentName)}` : "Registry agent was not stored.",
        getString(registry.status) ? `Registry status: ${getString(registry.status)}` : "Registry status was not stored.",
      ],
    })
  );

  if (hasSql) {
    nodes.push(
      node({
        id: "database",
        label: "Structured data query",
        description: "Public database rows were used for numeric claims.",
        type: "database",
        status: rows.length > 0 || sourceCounts.sql > 0 ? "complete" : "warning",
        details: [
          `Attached rows: ${rows.length}`,
          getString(metadata.sqlQuery) || "SQL query summary was not stored.",
        ],
      }),
      node({
        id: "sql-result",
        label: "SQL evidence",
        description: `${rows.length} result rows attached to the answer.`,
        type: "result",
        status: rows.length > 0 ? "used" : "warning",
        details: [
          `Result rows: ${rows.length}`,
          `SQL citations: ${sourceCounts.sql}`,
        ],
      })
    );
  }

  if (hasKb) {
    nodes.push(
      node({
        id: "retriever",
        label: "FDA label retrieval",
        description: "Relevant FDA label evidence was attached when the question needed label context.",
        type: "retriever",
        status: sourceCounts.kb > 0 ? "complete" : "warning",
        details: [
          `FDA label evidence citations: ${sourceCounts.kb}`,
          "Evidence comes from available openFDA label records.",
        ],
      }),
      node({
        id: "sources",
        label: "Cited evidence",
        description: `${sourceCounts.total} total evidence cards attached.`,
        type: "sources",
        status: sourceCounts.total > 0 ? "used" : "warning",
        details: [
          `SQL evidence: ${sourceCounts.sql}`,
          `FDA label evidence: ${sourceCounts.kb}`,
          `Limit notes: ${sourceCounts.limit}`,
        ],
      })
    );
  }

  nodes.push(
    node({
      id: "composer",
      label: "Answer composer",
      description:
        composerStatus === "complete"
          ? "The supported draft was polished while preserving citations."
          : "A deterministic evidence answer was used.",
      type: "composer",
      status: composerStatus,
      details: [
        `Enabled: ${composer.enabled === true ? "yes" : "no"}`,
        `Used LLM: ${composer.usedLlm === true ? "yes" : "no"}`,
        `Provider: ${getString(composer.provider, "not stored")}`,
        `Model: ${getString(composer.model, "not stored")}`,
        `Status: ${getString(composer.status, "not stored")}`,
        getString(composer.reason, "No composer reason was stored."),
      ],
    })
  );

  if (hasLimit) {
    nodes.push(
      node({
        id: "limitation",
        label: "Scope limits",
        description: "A limitation citation was attached to keep the answer inside public evidence boundaries.",
        type: "limitation",
        status: "complete",
        details: [
          `Limit citations: ${sourceCounts.limit}`,
          getString(metadata.limitation, "The answer is limited to available public evidence."),
        ],
      })
    );
  }

  nodes.push(
    node({
      id: "verifier",
      label: "Answer verifier",
      description: "Checked citations, limits, and answer grounding metadata.",
      type: "verifier",
      status: verificationStatus,
      score: Number.isFinite(Number(verification.score)) ? Number(verification.score) : undefined,
      details: [
        `Status: ${getString(verification.status, "not stored")}`,
        getString(verification.reason, "No verifier reason was stored."),
        getArray(verification.warnings).length > 0
          ? `Warnings: ${getArray(verification.warnings).join("; ")}`
          : "Warnings: none stored",
      ],
    }),
    node({
      id: "answer",
      label: "Final answer",
      description: getAnswerMode(metadata),
      type: "answer",
      status: "complete",
      details: [
        `Answer mode: ${getAnswerMode(metadata)}`,
        `Route: ${route}`,
        `Evidence cards: ${sourceCounts.total}`,
      ],
    })
  );

  const edges: RagTraceEdge[] = [];
  edges.push(edge("question", hasFollowUpRewrite ? "context" : "router"));
  if (hasFollowUpRewrite) edges.push(edge("context", "router"));
  edges.push(edge("router", "tool"));
  if (hasSql) {
    edges.push(edge("tool", "database"), edge("database", "sql-result"));
  }
  if (hasKb) {
    edges.push(edge("tool", "retriever"), edge("retriever", "sources"));
  }
  if (hasSql && hasKb) {
    edges.push(edge("sql-result", "composer"), edge("sources", "composer"));
  } else if (hasSql) {
    edges.push(edge("sql-result", "composer"));
  } else if (hasKb) {
    edges.push(edge("sources", "composer"));
  } else {
    edges.push(edge("tool", "composer"));
  }
  if (hasLimit) edges.push(edge("limitation", "verifier"));
  edges.push(edge("composer", "verifier"), edge("verifier", "answer"));

  return {
    question,
    resolvedQuestion,
    route,
    confidence,
    toolName,
    answerMode: getAnswerMode(metadata),
    nodes,
    edges,
  };
}
