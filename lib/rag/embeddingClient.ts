import crypto from "crypto";

export type EmbeddingProvider = "gemini" | "local_bge";

export type EmbeddingInputType = "document" | "query" | "raw";

export type EmbeddingResult = {
  embedding: number[];
  provider: EmbeddingProvider;
  model: string;
  dimensions: number;
  textHash: string;
};

export type BatchEmbeddingInput = {
  text: string;
  inputType?: EmbeddingInputType;
  title?: string | null;
};

export class EmbeddingRateLimitError extends Error {
  statusCode: number;
  retryAfterMs: number | null;

  constructor(message: string, retryAfterMs: number | null = null) {
    super(message);
    this.name = "EmbeddingRateLimitError";
    this.statusCode = 429;
    this.retryAfterMs = retryAfterMs;
  }
}

type GeminiEmbeddingResponse = {
  embedding?: {
    values?: number[];
  };
  embeddings?: {
    values?: number[];
  }[];
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
};

type TensorLike = {
  data?: ArrayLike<number>;
  dims?: number[];
  tolist?: () => unknown;
};

let localExtractorPromise: Promise<unknown> | null = null;

const expectedDimensions = Number(process.env.EMBEDDING_DIMENSIONS || 768);

export function getEmbeddingProvider(): EmbeddingProvider {
  return process.env.EMBEDDING_PROVIDER === "local" ? "local_bge" : "gemini";
}

export function getTargetEmbeddingModel() {
  if (getEmbeddingProvider() === "local_bge") {
    return process.env.LOCAL_EMBEDDING_MODEL || "Xenova/bge-base-en-v1.5";
  }

  return normalizeModelId(
    process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-2"
  );
}

export function hashEmbeddingText(text: string) {
  return crypto
    .createHash("sha256")
    .update(normalizeEmbeddingText(text))
    .digest("hex");
}

export function normalizeEmbeddingText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

export function toPgVector(embedding: number[]) {
  return `[${embedding.map((value) => Number(value).toFixed(8)).join(",")}]`;
}

function normalizeModelId(model: string) {
  return model.replace(/^models\//, "").trim();
}

function parseRetryAfterMs(response: Response) {
  const retryAfter = response.headers.get("retry-after");

  if (!retryAfter) {
    return null;
  }

  const retryAfterSeconds = Number(retryAfter);

  if (Number.isFinite(retryAfterSeconds)) {
    return Math.max(0, retryAfterSeconds * 1000);
  }

  const retryAfterDate = new Date(retryAfter);
  const retryAfterMs = retryAfterDate.getTime() - Date.now();

  if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    return retryAfterMs;
  }

  return null;
}

function validateEmbeddingDimensions(embedding: number[]) {
  if (embedding.length !== expectedDimensions) {
    throw new Error(
      `Embedding dimension mismatch. Expected ${expectedDimensions}, got ${embedding.length}.`
    );
  }
}

function buildGeminiEmbeddingText({
  text,
  inputType,
  title,
}: {
  text: string;
  inputType: EmbeddingInputType;
  title?: string | null;
}) {
  const normalizedText = normalizeEmbeddingText(text);

  if (inputType === "query") {
    return `Represent this query for retrieving relevant documents:\n\n${normalizedText}`;
  }

  if (inputType === "document") {
    return `Represent this document for retrieval:\n\n${
      title ? `Title: ${title}\n\n` : ""
    }${normalizedText}`;
  }

  return normalizedText;
}

function buildBgeEmbeddingText({
  text,
  inputType,
}: {
  text: string;
  inputType: EmbeddingInputType;
}) {
  const normalizedText = normalizeEmbeddingText(text);

  if (inputType === "query") {
    return `Represent this sentence for searching relevant passages: ${normalizedText}`;
  }

  return normalizedText;
}

function extractSingleEmbeddingValues(data: GeminiEmbeddingResponse) {
  const singleEmbedding = data.embedding?.values;

  if (singleEmbedding && singleEmbedding.length > 0) {
    return singleEmbedding;
  }

  const firstEmbedding = data.embeddings?.[0]?.values;

  if (firstEmbedding && firstEmbedding.length > 0) {
    return firstEmbedding;
  }

  return null;
}

function extractBatchEmbeddingValues(data: GeminiEmbeddingResponse) {
  const embeddings = data.embeddings ?? [];

  return embeddings
    .map((embedding) => embedding.values)
    .filter((values): values is number[] => Array.isArray(values));
}

function buildGeminiBatchRequestBody({
  model,
  inputs,
}: {
  model: string;
  inputs: BatchEmbeddingInput[];
}) {
  return {
    requests: inputs.map((input) => {
      const inputType = input.inputType || "document";
      const embeddingText = buildGeminiEmbeddingText({
        text: input.text,
        inputType,
        title: input.title,
      });

      return {
        model: `models/${model}`,
        content: {
          parts: [
            {
              text: embeddingText,
            },
          ],
        },
        outputDimensionality: expectedDimensions,
      };
    }),
  };
}

async function getLocalExtractor() {
  if (!localExtractorPromise) {
    localExtractorPromise = import("@huggingface/transformers").then(
      async ({ pipeline }) => {
        const model = getTargetEmbeddingModel();

        console.log(`Loading local embedding model: ${model}`);
        console.log("First run can take time because the model downloads locally.");

        return pipeline("feature-extraction", model);
      }
    );
  }

  return localExtractorPromise;
}

function tensorToVectors(output: unknown, expectedCount: number) {
  const tensor = output as TensorLike;

  if (typeof tensor.tolist === "function") {
    const list = tensor.tolist();

    if (Array.isArray(list) && Array.isArray(list[0])) {
      return (list as number[][]).map((vector) => vector.map(Number));
    }

    if (Array.isArray(list) && expectedCount === 1) {
      return [(list as number[]).map(Number)];
    }
  }

  const data = tensor.data ? Array.from(tensor.data).map(Number) : [];
  const dims = tensor.dims ?? [];

  if (data.length === 0) {
    throw new Error("Local embedding tensor did not include numeric data.");
  }

  if (dims.length === 1) {
    return [data];
  }

  const rows = dims[0] || expectedCount;
  const columns = dims[dims.length - 1] || expectedDimensions;

  if (rows !== expectedCount) {
    throw new Error(
      `Local embedding row count mismatch. Expected ${expectedCount}, got ${rows}.`
    );
  }

  const vectors: number[][] = [];

  for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
    const start = rowIndex * columns;
    const end = start + columns;
    vectors.push(data.slice(start, end));
  }

  return vectors;
}

async function embedTextsLocalBatch(
  inputs: BatchEmbeddingInput[]
): Promise<EmbeddingResult[]> {
  const extractor = (await getLocalExtractor()) as (
    texts: string[],
    options: { pooling: string; normalize: boolean }
  ) => Promise<unknown>;

  const cleanedInputs = inputs.map((input) => ({
    ...input,
    text: normalizeEmbeddingText(input.text),
    inputType: input.inputType || "document",
  }));

  const texts = cleanedInputs.map((input) =>
    buildBgeEmbeddingText({
      text: input.text,
      inputType: input.inputType || "document",
    })
  );

  const output = await extractor(texts, {
    pooling: "mean",
    normalize: true,
  });

  const vectors = tensorToVectors(output, cleanedInputs.length);

  if (vectors.length !== cleanedInputs.length) {
    throw new Error(
      `Local embedding response count mismatch. Expected ${cleanedInputs.length}, got ${vectors.length}.`
    );
  }

  const model = getTargetEmbeddingModel();

  return vectors.map((embedding, index) => {
    validateEmbeddingDimensions(embedding);

    return {
      embedding,
      provider: "local_bge" as const,
      model,
      dimensions: embedding.length,
      textHash: hashEmbeddingText(cleanedInputs[index].text),
    };
  });
}

async function embedTextsGeminiBatch(
  inputs: BatchEmbeddingInput[]
): Promise<EmbeddingResult[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = getTargetEmbeddingModel();

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required to build Gemini embeddings.");
  }

  const cleanedInputs = inputs.map((input) => ({
    ...input,
    text: normalizeEmbeddingText(input.text),
  }));

  if (cleanedInputs.length === 0) {
    return [];
  }

  for (const input of cleanedInputs) {
    if (!input.text) {
      throw new Error("Cannot embed empty text.");
    }
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(
        buildGeminiBatchRequestBody({
          model,
          inputs: cleanedInputs,
        })
      ),
    }
  );

  if (!response.ok) {
    const retryAfterMs = parseRetryAfterMs(response);
    const errorText = await response.text();

    if (response.status === 429) {
      throw new EmbeddingRateLimitError(
        `Gemini batch embedding request failed with HTTP 429: ${errorText}`,
        retryAfterMs
      );
    }

    throw new Error(
      `Gemini batch embedding request failed with HTTP ${response.status}: ${errorText}`
    );
  }

  const data = (await response.json()) as GeminiEmbeddingResponse;
  const embeddings = extractBatchEmbeddingValues(data);

  if (embeddings.length !== cleanedInputs.length) {
    throw new Error(
      `Gemini batch embedding response count mismatch. Expected ${cleanedInputs.length}, got ${embeddings.length}.`
    );
  }

  return embeddings.map((embedding, index) => {
    validateEmbeddingDimensions(embedding);

    return {
      embedding,
      provider: "gemini" as const,
      model,
      dimensions: embedding.length,
      textHash: hashEmbeddingText(cleanedInputs[index].text),
    };
  });
}

export async function embedTextsBatch(
  inputs: BatchEmbeddingInput[]
): Promise<EmbeddingResult[]> {
  const cleanedInputs = inputs
    .map((input) => ({
      ...input,
      text: normalizeEmbeddingText(input.text),
    }))
    .filter((input) => input.text.length > 0);

  if (cleanedInputs.length === 0) {
    return [];
  }

  if (getEmbeddingProvider() === "local_bge") {
    return embedTextsLocalBatch(cleanedInputs);
  }

  return embedTextsGeminiBatch(cleanedInputs);
}

export async function embedText(
  text: string,
  options: {
    inputType?: EmbeddingInputType;
    title?: string | null;
  } = {}
): Promise<EmbeddingResult> {
  if (getEmbeddingProvider() === "local_bge") {
    const results = await embedTextsLocalBatch([
      {
        text,
        inputType: options.inputType || "document",
        title: options.title,
      },
    ]);

    return results[0];
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const model = getTargetEmbeddingModel();

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required to build Gemini embeddings.");
  }

  const inputType = options.inputType || "document";
  const normalizedText = normalizeEmbeddingText(text);

  if (!normalizedText) {
    throw new Error("Cannot embed empty text.");
  }

  const embeddingText = buildGeminiEmbeddingText({
    text: normalizedText,
    inputType,
    title: options.title,
  });

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        model: `models/${model}`,
        content: {
          parts: [
            {
              text: embeddingText,
            },
          ],
        },
        outputDimensionality: expectedDimensions,
      }),
    }
  );

  if (!response.ok) {
    const retryAfterMs = parseRetryAfterMs(response);
    const errorText = await response.text();

    if (response.status === 429) {
      throw new EmbeddingRateLimitError(
        `Gemini embedding request failed with HTTP 429: ${errorText}`,
        retryAfterMs
      );
    }

    throw new Error(
      `Gemini embedding request failed with HTTP ${response.status}: ${errorText}`
    );
  }

  const data = (await response.json()) as GeminiEmbeddingResponse;
  const embedding = extractSingleEmbeddingValues(data);

  if (!embedding) {
    throw new Error(
      data.error?.message || "Gemini embedding response did not include values."
    );
  }

  validateEmbeddingDimensions(embedding);

  return {
    embedding,
    provider: "gemini",
    model,
    dimensions: embedding.length,
    textHash: hashEmbeddingText(normalizedText),
  };
}