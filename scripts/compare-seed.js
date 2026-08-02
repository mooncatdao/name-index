import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  buildSeedComparison,
  serializeSeedComparison,
  writeSeedComparison
} from "../src/seed-comparison.js";

const DEFAULTS = {
  currentNames: "data/current-names.json",
  seed: "data/seed/current-names.json",
  report: "reports/seed-comparison.json"
};

function parseArguments(argv) {
  const values = { check: false };
  const flags = new Set(["--current-names", "--seed", "--report"]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--check") {
      if (values.check) {
        throw new Error("--check may be provided only once");
      }
      values.check = true;
      continue;
    }
    if (!flags.has(flag) || index + 1 >= argv.length) {
      throw new Error(`unknown or incomplete argument: ${flag}`);
    }
    const name = flag.slice(2).replaceAll("-", "");
    if (Object.hasOwn(values, name)) {
      throw new Error(`duplicate argument: ${flag}`);
    }
    values[name] = argv[++index];
    if (values[name] === "") {
      throw new Error(`${flag} path must not be empty`);
    }
  }
  return {
    check: values.check,
    currentNamesPath: path.resolve(process.cwd(), values.currentnames ?? DEFAULTS.currentNames),
    seedPath: path.resolve(process.cwd(), values.seed ?? DEFAULTS.seed),
    reportPath: path.resolve(process.cwd(), values.report ?? DEFAULTS.report),
    currentNamesSource: values.currentnames ?? DEFAULTS.currentNames,
    seedSource: values.seed ?? DEFAULTS.seed
  };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function buildReport(args) {
  const canonical = await readJson(args.currentNamesPath);
  const seed = await readJson(args.seedPath);
  return buildSeedComparison(canonical, seed, {
    canonicalSource: args.currentNamesSource,
    seedSource: args.seedSource
  });
}

async function checkReport(args) {
  const expected = serializeSeedComparison(await buildReport(args));
  const actual = await readFile(args.reportPath, "utf8");
  if (actual !== expected) {
    throw new Error(`seed comparison report is out of date: ${args.reportPath}`);
  }
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.check) {
    await checkReport(args);
    process.stdout.write("Validated seed comparison report.\n");
    return;
  }
  await writeSeedComparison(args.reportPath, await buildReport(args));
  process.stdout.write("Generated seed comparison report.\n");
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    error: error instanceof Error ? error.message : String(error)
  })}\n`);
  process.exitCode = 1;
}
