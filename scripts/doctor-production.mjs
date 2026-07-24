const strict = process.argv.includes("--strict") || process.env.NODE_ENV === "production";
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
