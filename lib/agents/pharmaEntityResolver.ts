import type { SourceEvidence } from "@/types/evidence";

export type ResolvedDrug = {
  canonical: string;
  brandAliases: string[];
  genericAliases: string[];
  allAliases: string[];
  matchedAlias: string;
};

export type ResolvedDrugEntity = {
  canonical: string;
  aliases: string[];
  patterns: string[];
  detectedText: string;
  genericNames: string[];
  brandNames: string[];
};

export type ResolvedYear = {
  requestedYear: number | null;
  effectiveYear: number | null;
  availableYears: number[];
  unavailableYears: number[];
};

export type ResolvedYearRange = {
  requestedYear: number | null;
  startYear: number | null;
  endYear: number | null;
};

type DrugProfile = {
  canonical: string;
  brandNames: string[];
  genericNames: string[];
  aliases: string[];
};

const defaultTargetDrugs =
  "Anoro Ellipta,Adempas,Arexvy,Trelegy Ellipta,Breo Ellipta,Advair Diskus,Spiriva,Symbicort,Eliquis,Januvia,Ozempic,Trulicity,Humira,Stelara,Dupixent,Keytruda,Ibrance,Farxiga,Jardiance";

const knownDrugProfiles: DrugProfile[] = [
  {
    canonical: "Anoro Ellipta",
    brandNames: ["Anoro Ellipta", "Anoro"],
    genericNames: ["umeclidinium", "vilanterol", "umeclidinium vilanterol"],
    aliases: ["anoro", "anoro ellipta"],
  },
  {
    canonical: "Adempas",
    brandNames: ["Adempas"],
    genericNames: ["riociguat"],
    aliases: ["adempas", "riociguat"],
  },
  {
    canonical: "Arexvy",
    brandNames: ["Arexvy"],
    genericNames: ["respiratory syncytial virus vaccine", "rsv vaccine"],
    aliases: ["arexvy", "rsv vaccine"],
  },
  {
    canonical: "Trelegy Ellipta",
    brandNames: ["Trelegy Ellipta", "Trelegy"],
    genericNames: ["fluticasone", "umeclidinium", "vilanterol", "fluticasone umeclidinium vilanterol"],
    aliases: ["trelegy", "trelegy ellipta"],
  },
  {
    canonical: "Breo Ellipta",
    brandNames: ["Breo Ellipta", "Breo"],
    genericNames: ["fluticasone", "vilanterol", "fluticasone vilanterol"],
    aliases: ["breo", "breo ellipta"],
  },
  {
    canonical: "Advair Diskus",
    brandNames: ["Advair Diskus", "Advair"],
    genericNames: ["fluticasone", "salmeterol", "fluticasone salmeterol"],
    aliases: ["advair", "advair diskus"],
  },
  {
    canonical: "Spiriva",
    brandNames: ["Spiriva"],
    genericNames: ["tiotropium"],
    aliases: ["spiriva", "tiotropium"],
  },
  {
    canonical: "Symbicort",
    brandNames: ["Symbicort"],
    genericNames: ["budesonide", "formoterol", "budesonide formoterol"],
    aliases: ["symbicort", "budesonide formoterol"],
  },
  {
    canonical: "Eliquis",
    brandNames: ["Eliquis"],
    genericNames: ["apixaban"],
    aliases: ["eliquis", "apixaban"],
  },
  {
    canonical: "Januvia",
    brandNames: ["Januvia"],
    genericNames: ["sitagliptin"],
    aliases: ["januvia", "sitagliptin"],
  },
  {
    canonical: "Ozempic",
    brandNames: ["Ozempic"],
    genericNames: ["semaglutide"],
    aliases: ["ozempic", "semaglutide"],
  },
  {
    canonical: "Trulicity",
    brandNames: ["Trulicity"],
    genericNames: ["dulaglutide"],
    aliases: ["trulicity", "dulaglutide"],
  },
  {
    canonical: "Humira",
    brandNames: [
      "Humira",
      "Humira Pen",
      "Humira(Cf)",
      "Humira(Cf) Pen",
      "Humira CF",
      "Humira CF Pen",
      "Yusimry(Cf) Pen",
      "Adalimumab-Adaz(Cf)",
      "Amjevita",
      "Hadlima",
      "Hyrimoz",
      "Cyltezo",
    ],
    genericNames: ["adalimumab", "adalimumab-adaz"],
    aliases: [
      "humira",
      "humira cf",
      "humira cf pen",
      "humira(c) pen",
      "adalimumab",
      "adalimumab-adaz",
      "yusimry",
      "amjevita",
      "hadlima",
      "hyrimoz",
      "cyltezo",
    ],
  },
  {
    canonical: "Stelara",
    brandNames: ["Stelara"],
    genericNames: ["ustekinumab"],
    aliases: ["stelara", "ustekinumab"],
  },
  {
    canonical: "Dupixent",
    brandNames: ["Dupixent"],
    genericNames: ["dupilumab"],
    aliases: ["dupixent", "dupilumab"],
  },
  {
    canonical: "Keytruda",
    brandNames: ["Keytruda", "Keytruda Qlex", "Keytruda Qlex Injection"],
    genericNames: ["pembrolizumab", "pembrolizumab berahyaluronidase"],
    aliases: ["keytruda", "keytruda qlex", "pembrolizumab"],
  },
  {
    canonical: "Ibrance",
    brandNames: ["Ibrance"],
    genericNames: ["palbociclib"],
    aliases: ["ibrance", "palbociclib"],
  },
  {
    canonical: "Farxiga",
    brandNames: ["Farxiga"],
    genericNames: ["dapagliflozin"],
    aliases: ["farxiga", "dapagliflozin"],
  },
  {
    canonical: "Jardiance",
    brandNames: ["Jardiance"],
    genericNames: ["empagliflozin"],
    aliases: ["jardiance", "empagliflozin"],
  },
  {
    canonical: "Mounjaro",
    brandNames: ["Mounjaro"],
    genericNames: ["tirzepatide"],
    aliases: ["mounjaro", "tirzepatide"],
  },
  {
    canonical: "Xarelto",
    brandNames: ["Xarelto"],
    genericNames: ["rivaroxaban"],
    aliases: ["xarelto", "rivaroxaban"],
  },
  {
    canonical: "Revlimid",
    brandNames: ["Revlimid"],
    genericNames: ["lenalidomide"],
    aliases: ["revlimid", "lenalidomide"],
  },
];

const categoryPollution = new Set([
  "year",
  "month",
  "hour",
  "weekday",
  "day",
  "date",
  "time",
  "nan",
  "null",
  "unknown",
]);

export function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function normalizeText(value: unknown) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const normalizePharmaText = normalizeText;

export function includesAny(text: string, terms: string[]) {
  const normalized = normalizeText(text);
  return terms.some((term) => normalized.includes(normalizeText(term)));
}

export const containsAnyNormalized = includesAny;

function unique(values: string[]) {
  return Array.from(new Set(values.map(clean).filter(Boolean)));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildProfiles() {
  const envTargets = (process.env.OPENFDA_TARGET_DRUGS || defaultTargetDrugs)
    .split(",")
    .map((drug) => drug.trim())
    .filter(Boolean);

  const profiles = [...knownDrugProfiles];

  for (const drug of envTargets) {
    const exists = profiles.some(
      (profile) => normalizeText(profile.canonical) === normalizeText(drug)
    );

    if (!exists) {
      const first = normalizeText(drug).split(" ")[0];

      profiles.push({
        canonical: drug,
        brandNames: [drug],
        genericNames: [],
        aliases: unique([drug, first.length >= 4 ? first : ""]),
      });
    }
  }

  return profiles;
}

const profiles = buildProfiles();

export function getKnownDrugProfiles() {
  return profiles;
}

export function resolveDrugEntity(questionInput: unknown): ResolvedDrugEntity | null {
  const question = clean(questionInput);
  const text = normalizeText(question);

  if (!text) return null;

  const sortedProfiles = [...profiles].sort((a, b) => {
    const longestA = Math.max(
      ...unique([a.canonical, ...a.brandNames, ...a.genericNames, ...a.aliases]).map(
        (alias) => normalizeText(alias).length
      )
    );
    const longestB = Math.max(
      ...unique([b.canonical, ...b.brandNames, ...b.genericNames, ...b.aliases]).map(
        (alias) => normalizeText(alias).length
      )
    );
    return longestB - longestA;
  });

  for (const profile of sortedProfiles) {
    const allAliases = unique([
      profile.canonical,
      ...profile.brandNames,
      ...profile.genericNames,
      ...profile.aliases,
    ]);

    const matchedAlias = allAliases.find((alias) => {
      const normalizedAlias = normalizeText(alias);
      if (!normalizedAlias) return false;
      return new RegExp(`(^|\\s)${escapeRegExp(normalizedAlias)}($|\\s)`).test(text);
    });

    if (matchedAlias) {
      const values = unique([
        profile.canonical,
        ...profile.brandNames,
        ...profile.genericNames,
        ...profile.aliases,
      ]);

      return {
        canonical: profile.canonical,
        aliases: values,
        patterns: values.map((value) => `%${value}%`),
        detectedText: matchedAlias,
        genericNames: unique(profile.genericNames),
        brandNames: unique(profile.brandNames),
      };
    }
  }

  return null;
}

export function resolveKnownDrug(question: string): ResolvedDrug | null {
  const entity = resolveDrugEntity(question);

  if (!entity) return null;

  return {
    canonical: entity.canonical,
    brandAliases: entity.brandNames.map(normalizeText).filter(Boolean),
    genericAliases: entity.genericNames.map(normalizeText).filter(Boolean),
    allAliases: entity.aliases.map(normalizeText).filter(Boolean),
    matchedAlias: normalizeText(entity.detectedText),
  };
}

export function getDrugPatterns(drug: ResolvedDrug | ResolvedDrugEntity | null, fallbackText?: string) {
  const values = new Set<string>();

  if (drug) {
    values.add(drug.canonical);

    if ("allAliases" in drug) {
      for (const alias of drug.allAliases) values.add(alias);
      for (const alias of drug.brandAliases) values.add(alias);
      for (const alias of drug.genericAliases) values.add(alias);
    } else {
      for (const alias of drug.aliases) values.add(alias);
      for (const alias of drug.brandNames) values.add(alias);
      for (const alias of drug.genericNames) values.add(alias);
    }
  }

  const fallback = clean(fallbackText);
  if (fallback) {
    values.add(fallback);
    const first = normalizeText(fallback).split(" ")[0];
    if (first.length >= 4) values.add(first);
  }

  return Array.from(values)
    .map(clean)
    .filter((item) => item.length >= 3)
    .map((item) => `%${item}%`);
}

export function looksDrugSpecific(question: string) {
  const normalized = normalizeText(question);

  if (resolveDrugEntity(question)) return true;

  return (
    /\b(for|about|on)\s+[a-z0-9][a-z0-9\s\-()]{2,60}\b/i.test(question) &&
    !includesAny(normalized, ["drug", "drugs", "company", "companies", "state", "states"])
  );
}

export function extractYears(question: string) {
  return Array.from(new Set(question.match(/\b20\d{2}\b/g) || []))
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
}

export function extractRequestedYears(questionInput: unknown): ResolvedYearRange {
  const years = extractYears(clean(questionInput));

  if (years.length === 0) {
    return {
      requestedYear: null,
      startYear: null,
      endYear: null,
    };
  }

  if (years.length === 1) {
    return {
      requestedYear: years[0],
      startYear: years[0],
      endYear: years[0],
    };
  }

  return {
    requestedYear: null,
    startYear: years[0],
    endYear: years[years.length - 1],
  };
}

export function resolveYear(question: string, availableYears: number[]): ResolvedYear {
  const years = extractYears(question);
  const availableSet = new Set(availableYears);
  const matching = years.filter((year) => availableSet.has(year));
  const unavailableYears = years.filter((year) => !availableSet.has(year));

  return {
    requestedYear: matching.length > 0 ? matching[matching.length - 1] : null,
    effectiveYear: matching.length > 0 ? matching[matching.length - 1] : availableYears[0] || null,
    availableYears,
    unavailableYears,
  };
}

export function formatCurrency(value: number) {
  if (!Number.isFinite(value)) return "not available";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatNumber(value: number) {
  if (!Number.isFinite(value)) return "not available";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatPercent(value: number) {
  if (!Number.isFinite(value)) return "not available";
  return `${value.toFixed(1)}%`;
}

export function markdownTable(headers: string[], rows: Array<Array<string | number>>) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map((cell) => clean(cell)).join(" | ")} |`),
  ].join("\n");
}

export function isPollutedCategory(value: unknown) {
  const normalized = normalizeText(value);
  return !normalized || categoryPollution.has(normalized);
}

export function commonLimitSource({
  id = "public-data-limitation",
  title = "Public data limitation",
  dataset = "System limitation",
  excerpt,
}: {
  id?: string;
  title?: string;
  dataset?: string;
  excerpt: string;
}): SourceEvidence {
  return {
    id,
    title,
    dataset,
    score: 1,
    status: "used",
    citationLabel: "LIMIT-1",
    citationType: "limit",
    excerpt,
    metadata: [
      "Citation: [LIMIT-1]",
      "Loaded public data only",
      "No private CRM, rebate, contract, margin, or sales-rep performance data",
    ],
  };
}
