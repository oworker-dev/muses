import { inspectWorkflowWorld } from "./lib/workflow-world-doctor.mjs";

const strict = process.argv.includes("--strict") || process.env.NODE_ENV === "production";
const inspectWorld = process.argv.includes("--inspect-workflow-world");
const defaultAuthSecret = "oworker-saas-starter-dev-secret-change-before-production";

const errors = [];
const warnings = [];

checkRequired("DATABASE_URL", "PostgreSQL connection string is required for persistent SaaS state.");
checkRequired("BETTER_AUTH_URL", "BETTER_AUTH_URL should point at the deployed web origin.");
checkRequired("APP_URL", "APP_URL should point at the public web origin.");
checkRequired("BETTER_AUTH_SECRET", "BETTER_AUTH_SECRET must be set to a private random value.");
checkRequired("S3_ENDPOINT", "S3-compatible storage endpoint is required for object storage.");
checkRequired("S3_PUBLIC_ENDPOINT", "S3_PUBLIC_ENDPOINT should be browser-reachable for presigned uploads.");
checkRequired("S3_BUCKET", "S3_BUCKET should name the production object storage bucket.");
checkRequired("S3_ACCESS_KEY_ID", "S3_ACCESS_KEY_ID is required for S3-compatible object storage.");
checkRequired("S3_SECRET_ACCESS_KEY", "S3_SECRET_ACCESS_KEY is required for S3-compatible object storage.");

if (process.env.BETTER_AUTH_SECRET === defaultAuthSecret) {
  report(
    "BETTER_AUTH_SECRET uses the starter development default. Generate a private production secret.",
    strict
  );
}

for (const name of ["BETTER_AUTH_URL", "APP_URL"]) {
  const value = process.env[name];
  if (value && isLocalOrigin(value)) {
    report(`${name} points at a local origin. Use the deployed HTTPS origin for production.`, strict);
  }
}

if (process.env.S3_PUBLIC_ENDPOINT && isLocalOrigin(process.env.S3_PUBLIC_ENDPOINT)) {
  report(
    "S3_PUBLIC_ENDPOINT points at a local or non-HTTPS origin. Use a browser-reachable HTTPS storage endpoint for production uploads.",
    strict
  );
}

if (!process.env.BETTER_AUTH_TRUSTED_ORIGINS) {
  report(
    "BETTER_AUTH_TRUSTED_ORIGINS is not set. Add any additional deployed origins that can initiate auth requests.",
    false
  );
}

if (!process.env.SITE_ADMIN_EMAILS) {
  report(
    "SITE_ADMIN_EMAILS is not set. Configure explicit site admins before production launch.",
    strict
  );
}

if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM) {
  report(
    "Resend credentials are not fully configured. Account emails will use local-test behavior.",
    strict
  );
}

if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PRICE_PRO) {
  report(
    "Stripe credentials are not fully configured. Billing checkout and portal routes will fail closed.",
    strict
  );
}

if (process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_WEBHOOK_SECRET) {
  report("STRIPE_WEBHOOK_SECRET is missing. Live webhook verification should be enabled.", strict);
}

if (!process.env.OPENAI_API_KEY && !process.env.OPENAI_IMAGE_API_KEY) {
  report(
    "No bootstrap image Provider credential is configured. Create an Admin-managed image Provider Connection before running image workflows.",
    false
  );
}

for (const name of [
  "MUSES_AGENT_SERVICE_URL",
  "MUSES_AGENT_PUBLIC_URL",
  "MUSES_AGENT_HOST_JWT_SECRET",
  "MUSES_AGENT_HOST_JWT_ISSUER",
  "MUSES_AGENT_HOST_JWT_AUDIENCE",
  "MUSES_AGENT_HOST_TOOLS_SECRET",
]) {
  if (!process.env[name]) {
    report(`${name} is missing. The standalone Agent Host integration is incomplete.`, strict);
  }
}

for (const name of ["MUSES_AGENT_SERVICE_URL", "MUSES_AGENT_PUBLIC_URL"]) {
  const value = process.env[name];
  if (value && isLocalOrigin(value)) {
    report(`${name} points at a local or non-HTTPS origin. Use the deployed HTTPS Agent origin.`, strict);
  }
}

for (const name of ["MUSES_AGENT_HOST_JWT_SECRET", "MUSES_AGENT_HOST_TOOLS_SECRET"]) {
  const value = process.env[name];
  if (value && Buffer.byteLength(value) < 32) {
    report(`${name} must contain at least 32 bytes.`, strict);
  }
}

if (process.env.MUSES_AGENT_HOST_JWT_TTL_SECONDS) {
  const ttl = Number(process.env.MUSES_AGENT_HOST_JWT_TTL_SECONDS);
  if (!Number.isInteger(ttl) || ttl < 60 || ttl > 900) {
    report("MUSES_AGENT_HOST_JWT_TTL_SECONDS must be an integer from 60 to 900.", strict);
  }
}

if (
  !process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT &&
  !process.env.OTEL_EXPORTER_OTLP_ENDPOINT &&
  !process.env.VERCEL_OTEL_ENDPOINTS
) {
  report(
    "No OpenTelemetry exporter is configured. Agent, Workflow, Provider and Host traces cannot be joined.",
    strict
  );
}

if (!process.env.MUSES_CREDENTIAL_MASTER_KEY) {
  report(
    "MUSES_CREDENTIAL_MASTER_KEY is missing. Provider Connection credentials cannot be created or decrypted.",
    strict
  );
} else {
  const encodedKey = process.env.MUSES_CREDENTIAL_MASTER_KEY.trim();
  const validBase64 = /^[A-Za-z0-9+/]*={0,2}$/.test(encodedKey) && encodedKey.length % 4 === 0;
  const keyBytes = validBase64 ? Buffer.from(encodedKey, "base64") : Buffer.alloc(0);
  if (keyBytes.length !== 32) {
    report(
      "MUSES_CREDENTIAL_MASTER_KEY must be a base64-encoded 32-byte key.",
      strict
    );
  }
}

if (
  process.env.MUSES_CREDENTIAL_MASTER_KEY_ID &&
  !/^[a-zA-Z0-9._-]{1,80}$/.test(process.env.MUSES_CREDENTIAL_MASTER_KEY_ID)
) {
  report("MUSES_CREDENTIAL_MASTER_KEY_ID is invalid.", strict);
}

if (process.env.MUSES_ALLOW_INSECURE_PROVIDER_URLS === "true") {
  report(
    "MUSES_ALLOW_INSECURE_PROVIDER_URLS is enabled. Disable plaintext Provider endpoints in production.",
    strict
  );
}

if (!process.env.MUSES_PROVIDER_ALLOWED_HOSTS) {
  report(
    "MUSES_PROVIDER_ALLOWED_HOSTS is not set. Only the built-in api.openai.com host will be accepted for Admin-managed production Provider URLs.",
    false
  );
}

if (process.env.OPENAI_BASE_URL && !process.env.OPENAI_API_KEY) {
  report("OPENAI_BASE_URL is set without its compatibility OPENAI_API_KEY.", strict);
}

if (process.env.OPENAI_IMAGE_BASE_URL && !process.env.OPENAI_IMAGE_API_KEY) {
  report(
    "OPENAI_IMAGE_BASE_URL requires OPENAI_IMAGE_API_KEY so shared credentials are not forwarded across providers.",
    strict
  );
}

if (!process.env.OPENAI_IMAGE_API_KEY && process.env.OPENAI_API_KEY) {
  report(
    "Image generation is using the shared compatibility Provider. Configure OPENAI_IMAGE_API_KEY and optionally OPENAI_IMAGE_BASE_URL when image and text credentials differ.",
    false
  );
}

if (inspectWorld) {
  try {
    const diagnostics = await inspectWorkflowWorld({
      connectionString: process.env.WORKFLOW_POSTGRES_URL,
      jobPrefix: process.env.WORKFLOW_POSTGRES_JOB_PREFIX,
    });
    for (const diagnostic of diagnostics) {
      const message = `[${diagnostic.code}] ${diagnostic.message}`;
      if (diagnostic.level === "error") errors.push(message);
      else warnings.push(message);
    }
  } catch (error) {
    errors.push(
      `[workflow-world-inspection] ${error instanceof Error ? error.message : "Workflow World inspection failed."}`
    );
  }
}

if (errors.length > 0) {
  printResult("fail", errors, warnings);
  process.exit(1);
}

printResult("pass", errors, warnings);

function checkRequired(name, detail) {
  if (!process.env[name]) {
    report(`${name} is missing. ${detail}`, strict);
  }
}

function report(message, failInStrictMode) {
  if (failInStrictMode) {
    errors.push(message);
    return;
  }

  warnings.push(message);
}

function isLocalOrigin(value) {
  try {
    const url = new URL(value);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.protocol !== "https:";
  } catch {
    report(`${value} is not a valid URL.`, strict);
    return false;
  }
}

function printResult(status, errorList, warningList) {
  console.log(`OWorker SaaS production doctor ${status}.`);

  if (warningList.length > 0) {
    console.log("\nWarnings:");
    for (const warning of warningList) {
      console.log(`- ${warning}`);
    }
  }

  if (errorList.length > 0) {
    console.log("\nErrors:");
    for (const error of errorList) {
      console.log(`- ${error}`);
    }
  }
}
