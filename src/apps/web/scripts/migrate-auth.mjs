import { getMigrations } from "better-auth/db/migration";
import nextEnv from "@next/env";
import { PostgresDialect } from "kysely";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { loadEnvConfig } = nextEnv;
const projectDir = join(dirname(fileURLToPath(import.meta.url)), "..");
loadEnvConfig(projectDir, process.env.NODE_ENV !== "production");

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("DATABASE_URL is required to run auth migrations.");
  process.exit(1);
}

const pool = new Pool({ connectionString });
const database = new PostgresDialect({ pool });

const rateLimit = {
  enabled: true,
  storage: "database",
  window: 60,
  max: 120,
  customRules: {
    "/sign-in/email": { window: 60, max: 10 },
    "/sign-up/email": { window: 60, max: 5 },
    "/send-verification-email": { window: 60, max: 3 },
    "/request-password-reset": { window: 60, max: 3 },
    "/reset-password": { window: 60, max: 5 },
    "/change-password": { window: 60, max: 5 },
    "/change-email": { window: 60, max: 5 },
  },
};

const authConfig = {
  database,
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    resetPasswordTokenExpiresIn: 60 * 60,
    revokeSessionsOnPasswordReset: true,
    async sendResetPassword() {},
  },
  emailVerification: {
    sendOnSignUp: false,
    sendOnSignIn: false,
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60,
    async sendVerificationEmail() {},
  },
  user: {
    changeEmail: {
      enabled: true,
      updateEmailWithoutVerification: false,
      async sendChangeEmailConfirmation() {},
    },
  },
  secret:
    process.env.BETTER_AUTH_SECRET ||
    "oworker-saas-starter-dev-secret-change-before-production",
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
  rateLimit,
};

try {
  const migrations = await getMigrations(authConfig);
  await migrations.runMigrations();
  console.log("Better Auth migrations applied.");
} finally {
  await pool.end();
}
