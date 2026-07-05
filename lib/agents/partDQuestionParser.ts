export type YearRange = {
  startYear: number;
  endYear: number;
};

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