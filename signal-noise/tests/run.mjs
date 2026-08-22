// Compiles the TypeScript core with esbuild, then runs the unit + engine suites.
import { execSync } from "node:child_process";
import { mkdtempSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fn = join(here, "..", "supabase", "functions", "signal-noise-ingest");
const tmp = mkdtempSync(join(tmpdir(), "signal-noise-"));
const run = (c) => execSync(c, { stdio: "inherit", cwd: here });

copyFileSync(join(fn, "lib.ts"), join(tmp, "lib.ts"));
writeFileSync(join(tmp, "t.ts"), readFileSync(join(here, "lib.test.ts"), "utf8").replace('"./lib.ts"', '"./lib"'));
writeFileSync(join(tmp, "idx.ts"),
  readFileSync(join(fn, "index.ts"), "utf8").replace('import "jsr:@supabase/functions-js/edge-runtime.d.ts";', ""));

run(`npx --yes esbuild ${join(tmp, "t.ts")} --bundle --format=cjs --target=node20 --outfile=${join(tmp, "t.cjs")} --log-level=error`);
run(`node ${join(tmp, "t.cjs")}`);
run(`npx --yes esbuild ${join(tmp, "idx.ts")} --bundle --format=esm --target=node20 --outfile=/tmp/engine.mjs --log-level=error`);
run(`node ${join(here, "engine.test.mjs")}`);
console.log("\nAll suites passed.");
