export type YearRange = {
  startYear: number;
  endYear: number;
};

export type RequestedLimitOptions = {
  defaultLimit?: number;
  maxLimit?: number;
  minLimit?: number;
};

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

function clampLimit({
  value,
  defaultLimit,
  minLimit,
  maxLimit,
}: {
  value: number;
  defaultLimit: number;
  minLimit: number;
  maxLimit: number;
}) {
  if (!Number.isFinite(value)) {
    return defaultLimit;
  }

  const integerValue = Math.floor(value);

  if (integerValue < minLimit) {
    return defaultLimit;
  }

  return Math.min(integerValue, maxLimit);
}

function isYearLikeNumber(value: number) {
  return value >= 1900 && value <= 2099;
}

function isBlockedUnit(token: string | undefined) {
  if (!token) {
    return false;
  }

  return [
    "mg",
    "mcg",
    "g",
    "gram",
    "grams",
    "ml",
    "dose",
    "doses",
    "day",
    "days",
    "week",
    "weeks",
    "month",
    "months",
    "year",
    "years",
    "percent",
    "percentage",
  ].includes(token);
}

function hasLimitContext({
  previousToken,
  previousTwoTokens,
  nextToken,
  nextTwoTokens,
}: {
  previousToken?: string;
  previousTwoTokens?: string;
  nextToken?: string;
  nextTwoTokens?: string;
}) {
  const previousContextTerms = new Set([
    "top",
    "first",
    "only",
    "limit",
    "last",
    "show",
    "list",
    "display",
    "return",
  ]);

  const nextResultTerms = new Set([
    "drug",
    "drugs",
    "provider",
    "providers",
    "prescriber",
    "prescribers",
    "company",
    "companies",
    "manufacturer",
    "manufacturers",
    "payment",
    "payments",
    "record",
    "records",
    "row",
    "rows",
    "result",
    "results",
    "state",
    "states",
    "category",
    "categories",
    "source",
    "sources",
    "citation",
    "citations",
    "warning",
    "warnings",
    "label",
    "labels",
    "item",
    "items",
  ]);

  const rankingTerms = new Set([
    "highest",
    "lowest",
    "biggest",
    "largest",
    "smallest",
    "most",
    "least",
    "costliest",
    "expensive",
  ]);

  if (previousToken && previousContextTerms.has(previousToken)) {
    return true;
  }

  if (nextToken && nextResultTerms.has(nextToken)) {
    return true;
  }

  if (nextToken && rankingTerms.has(nextToken)) {
    return true;
  }

  if (
    previousTwoTokens &&
    ["show me", "give me", "list me"].includes(previousTwoTokens)
  ) {
    return true;
  }

  if (
    nextTwoTokens &&
    Array.from(nextResultTerms).some((term) => nextTwoTokens.includes(term))
  ) {
    return true;
  }

  return false;
}

function extractExplicitRequestedLimit(
  question: unknown,
  options: RequestedLimitOptions = {}
) {
  const defaultLimit = options.defaultLimit ?? 10;
  const maxLimit = options.maxLimit ?? 25;
  const minLimit = options.minLimit ?? 1;

  const text = normalize(question);

  if (!text) {
    return null;
  }

  const tokens = text.split(/\s+/).filter(Boolean);

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (!/^\d{1,4}$/.test(token)) {
      continue;
    }

    const parsed = Number(token);

    if (!Number.isFinite(parsed)) {
      continue;
    }

    if (isYearLikeNumber(parsed)) {
      continue;
    }

    const previousToken = tokens[index - 1];
    const previousTwoTokens = [tokens[index - 2], tokens[index - 1]]
      .filter(Boolean)
      .join(" ");

    const nextToken = tokens[index + 1];
    const nextTwoTokens = [tokens[index + 1], tokens[index + 2]]
      .filter(Boolean)
      .join(" ");

    if (isBlockedUnit(nextToken)) {
      continue;
    }

    const hasContext = hasLimitContext({
      previousToken,
      previousTwoTokens,
      nextToken,
      nextTwoTokens,
    });

    if (!hasContext) {
      continue;
    }

    return clampLimit({
      value: parsed,
      defaultLimit,
      minLimit,
      maxLimit,
    });
  }

  return null;
}

export function extractRequestedLimit(
  question: unknown,
  options: RequestedLimitOptions = {}
) {
  const defaultLimit = options.defaultLimit ?? 10;

  return extractExplicitRequestedLimit(question, options) ?? defaultLimit;
}

export function extractRequestedLimitFromQuestions({
  originalQuestion,
  resolvedQuestion,
  defaultLimit = 10,
  maxLimit = 25,
  minLimit = 1,
}: {
  originalQuestion?: unknown;
  resolvedQuestion?: unknown;
  defaultLimit?: number;
  maxLimit?: number;
  minLimit?: number;
}) {
  const options = {
    defaultLimit,
    maxLimit,
    minLimit,
  };

  const originalLimit = extractExplicitRequestedLimit(
    originalQuestion,
    options
  );

  if (originalLimit !== null) {
    return originalLimit;
  }

  const resolvedLimit = extractExplicitRequestedLimit(
    resolvedQuestion,
    options
  );

  if (resolvedLimit !== null) {
    return resolvedLimit;
  }

  return defaultLimit;
}

export function extractYearsFromQuestion(question: string) {
  const matches = question.match(/\b20\d{2}\b/g) ?? [];

  return Array.from(new Set(matches.map((year) => Number(year))))
    .filter((year) => Number.isFinite(year))
    .sort((a, b) => a - b);
}

export function extractRequestedYear(
  question: string,
  availableYears: number[]
) {
  const requestedYears = extractYearsFromQuestion(question);
  const availableYearSet = new Set(availableYears);

  const matchingYears = requestedYears.filter((year) =>
    availableYearSet.has(year)
  );

  if (matchingYears.length === 0) {
    return null;
  }

  return matchingYears[matchingYears.length - 1];
}

export function extractRequestedYearRange(
  question: string,
  availableYears: number[]
): YearRange | null {
  const requestedYears = extractYearsFromQuestion(question);
  const availableYearSet = new Set(availableYears);

  const matchingYears = requestedYears.filter((year) =>
    availableYearSet.has(year)
  );

  if (matchingYears.length < 2) {
    return null;
  }

  return {
    startYear: Math.min(...matchingYears),
    endYear: Math.max(...matchingYears),
  };
}

export function getUnavailableRequestedYears(
  question: string,
  availableYears: number[]
) {
  const requestedYears = extractYearsFromQuestion(question);
  const availableYearSet = new Set(availableYears);

  return requestedYears.filter((year) => !availableYearSet.has(year));
}

export function formatAvailableYears(availableYears: number[]) {
  if (availableYears.length === 0) {
    return "none";
  }

  return [...availableYears].sort((a, b) => a - b).join(", ");
}