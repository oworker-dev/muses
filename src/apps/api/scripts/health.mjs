import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const requiredDependencies = [
  "@aws-sdk/client-s3",
  "@aws-sdk/s3-request-presigner",
  "@hono/node-server",
  "hono",
  "ioredis",
  "pg",
  "zod"
];

const missing = requiredDependencies.filter((name) => !pkg.dependencies?.[name]);

if (missing.length > 0) {
  console.error("API app is missing runtime dependencies:");
  for (const name of missing) {
    console.error(`- ${name}`);
  }
  process.exitCode = 1;
} else {
  console.log("OWorker SaaS API app health check passed.");
}
