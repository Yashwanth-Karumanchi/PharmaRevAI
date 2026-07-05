import dotenv from "dotenv";
import fs from "fs";
import { spawn } from "child_process";

dotenv.config({ path: ".env.local" });

type Step = {
  name: string;
  script: string;
  required: boolean;
  skipWhen?: () => boolean;
};

const isWindows = process.platform === "win32";

const steps: Step[] = [
  {
    name: "Setup max schema",
    script: "setup:max-schema",
    required: true,
    skipWhen: () => process.env.REBUILD_SKIP_SETUP === "true",
  },
  {
    name: "Reset reloadable datasets",
    script: "reset:datasets",
    required: true,
    skipWhen: () => process.env.REBUILD_SKIP_RESET === "true",
  },
  {
    name: "Ingest CMS Part D Spending full CSV",
    script: "ingest:cms-spending",
    required: true,
  },
  {
    name: "Setup CMS Part D Prescribers schema",
    script: "setup:cms-prescribers",
    required: true,
  },
  {
    name: "Ingest CMS Part D Prescribers fast CSV",
    script: "ingest:cms-prescribers",
    required: true,
  },
  {
    name: "Setup Open Payments schema",
    script: "setup:open-payments",
    required: true,
  },
  {
    name: "Ingest Open Payments fast CSV",
    script: "ingest:open-payments",
    required: true,
  },
  {
    name: "Setup Pharma Sales schema",
    script: "setup:pharma-sales",
    required: true,
  },
  {
    name: "Ingest Pharma Sales",
    script: "ingest:pharma-sales",
    required: true,
  },
  {
    name: "Wide openFDA label ingestion",
    script: "ingest:openfda-wide-labels",
    required: true,
  },
  {
    name: "Setup RAG vector schema",
    script: "setup:rag-vectors",
    required: true,
  },
  {
    name: "Build local BGE embeddings",
    script: "embed:chunks",
    required: true,
  },
  {
    name: "Optimize loaded datasets",
    script: "optimize:datasets",
    required: true,
  },
  {
    name: "Check dataset counts",
    script: "check:dataset-counts",
    required: true,
  },
  {
    name: "Generate diverse 1000-question evaluation set",
    script: "generate:eval-questions",
    required: true,
  },
];

function getCleanEnv() {
  const cleanEnv: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (!key || key.includes("=")) {
      continue;
    }

    if (value === undefined || value === null) {
      continue;
    }

    cleanEnv[key] = String(value);
  }

  return cleanEnv;
}

function getPackageJson() {
  const raw = fs.readFileSync("package.json", "utf-8");
  return JSON.parse(raw) as { scripts?: Record<string, string> };
}

function hasScript(script: string) {
  const packageJson = getPackageJson();
  return Boolean(packageJson.scripts?.[script]);
}

function runScript(step: Step) {
  return new Promise<void>((resolve, reject) => {
    if (step.skipWhen?.()) {
      console.log("");
      console.log(`Skipping: ${step.name}`);
      resolve();
      return;
    }

    if (!hasScript(step.script)) {
      reject(new Error(`Missing package.json script: ${step.script}`));
      return;
    }

    console.log("");
    console.log("====================================================");
    console.log(`Starting: ${step.name}`);
    console.log(`npm run ${step.script}`);
    console.log("====================================================");

    const startedAt = Date.now();

    const child = isWindows
      ? spawn("cmd.exe", ["/d", "/s", "/c", `npm run ${step.script}`], {
          stdio: "inherit",
          env: getCleanEnv(),
          cwd: process.cwd(),
          windowsHide: false,
        })
      : spawn("npm", ["run", step.script], {
          stdio: "inherit",
          env: getCleanEnv(),
          cwd: process.cwd(),
        });

    child.on("error", reject);

    child.on("close", (code) => {
      const seconds = Math.round((Date.now() - startedAt) / 1000);

      if (code === 0) {
        console.log("");
        console.log(`Finished: ${step.name} in ${seconds}s`);
        resolve();
        return;
      }

      reject(new Error(`${step.name} failed with exit code ${code}`));
    });
  });
}

async function main() {
  console.log("Starting MAX PharmaRev dataset rebuild.");
  console.log({
    platform: process.platform,
    nodeVersion: process.version,
    REBUILD_SKIP_SETUP: process.env.REBUILD_SKIP_SETUP,
    REBUILD_SKIP_RESET: process.env.REBUILD_SKIP_RESET,
    CMS_PARTD_SPENDING_MAX_ROWS: process.env.CMS_PARTD_SPENDING_MAX_ROWS,
    CMS_PRESCRIBERS_MAX_DRUGS: process.env.CMS_PRESCRIBERS_MAX_DRUGS,
    CMS_PRESCRIBERS_MAX_ROWS_PER_DRUG:
      process.env.CMS_PRESCRIBERS_MAX_ROWS_PER_DRUG,
    CMS_PRESCRIBERS_MAX_TOTAL_ROWS: process.env.CMS_PRESCRIBERS_MAX_TOTAL_ROWS,
    OPEN_PAYMENTS_MAX_ROWS: process.env.OPEN_PAYMENTS_MAX_ROWS,
    OPEN_PAYMENTS_MAX_SCANNED_ROWS: process.env.OPEN_PAYMENTS_MAX_SCANNED_ROWS,
    OPENFDA_MAX_RECORDS: process.env.OPENFDA_MAX_RECORDS,
    EMBEDDING_PROVIDER: process.env.EMBEDDING_PROVIDER,
    EVAL_QUESTION_COUNT: process.env.EVAL_QUESTION_COUNT,
  });

  const salesPath = process.env.PHARMA_SALES_CSV_PATH || "data/pharma_sales.csv";

  if (!fs.existsSync(salesPath)) {
    throw new Error(
      `Missing pharma sales CSV at ${salesPath}. Download it manually and place it there before rebuild.`
    );
  }

  const startedAt = Date.now();

  for (const step of steps) {
    await runScript(step);
  }

  const minutes = Number(((Date.now() - startedAt) / 60000).toFixed(2));

  console.log("");
  console.log("MAX PharmaRev dataset rebuild complete.");
  console.log({ minutes });
  console.log("");
  console.log("Next:");
  console.log("npm run test:planner");
  console.log("npm run test:registry");
  console.log('npm run test:retrieval -- "What is Anoro Ellipta used for?"');
  console.log("npm run eval -- evaluation/questions.generated.1000.json");
}

main().catch((error) => {
  console.error("MAX dataset rebuild failed:", error);
  process.exit(1);
});