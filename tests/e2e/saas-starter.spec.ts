import { expect, test } from "@playwright/test"
import { createHmac, randomBytes } from "node:crypto"
import pg from "pg"

const apiUrl = process.env.OWORKER_API_URL || "http://127.0.0.1:3001"
const webUrl = process.env.OWORKER_WEB_URL || "http://127.0.0.1:3000"
const { Client } = pg
const configuredAdminEmail =
  firstConfiguredEmail(process.env.E2E_SITE_ADMIN_EMAILS) ||
  firstConfiguredEmail(process.env.SITE_ADMIN_EMAILS)

test("SaaS starter release path is reachable", async ({ page, request }) => {
  test.setTimeout(180_000)

  const rateLimitIp = `203.0.113.${(Date.now() % 200) + 20}`
  const health = await request.get(`${apiUrl}/health`)
  expect(health.ok()).toBeTruthy()
  await expect(health).toBeOK()
  await expect(await health.json()).toMatchObject({ status: "ok" })

  const integrations = await request.get(`${apiUrl}/integrations/health`)
  await expect(integrations).toBeOK()
  const integrationsPayload = await integrations.json()
  expect(integrationsPayload.status).toBe("ok")
  for (const key of ["database", "cache", "queue", "storage"]) {
    expect(integrationsPayload.integrations?.[key]?.status).toBe("ok")
  }

  const home = await request.get("/")
  await expect(home).toBeOK()
  expect(home.headers()["x-content-type-options"]).toBe("nosniff")
  expect(home.headers()["x-frame-options"]).toBe("DENY")
  expect(home.headers()["referrer-policy"]).toBe("strict-origin-when-cross-origin")
  expect(home.headers()["permissions-policy"]).toContain("camera=()")

  await expect(
    await request.post(`${webUrl}/api/auth/request-password-reset`, {
      headers: createAuthRequestHeaders(rateLimitIp),
      data: { email: `limit-${Date.now()}@example.com`, redirectTo: "/reset-password" },
    })
  ).toBeOK()
  await expect(
    await request.post(`${webUrl}/api/auth/request-password-reset`, {
      headers: createAuthRequestHeaders(rateLimitIp),
      data: { email: `limit-${Date.now()}@example.com`, redirectTo: "/reset-password" },
    })
  ).toBeOK()
  await expect(
    await request.post(`${webUrl}/api/auth/request-password-reset`, {
      headers: createAuthRequestHeaders(rateLimitIp),
      data: { email: `limit-${Date.now()}@example.com`, redirectTo: "/reset-password" },
    })
  ).toBeOK()
  const limited = await request.post(`${webUrl}/api/auth/request-password-reset`, {
    headers: createAuthRequestHeaders(rateLimitIp),
    data: { email: `limit-${Date.now()}@example.com`, redirectTo: "/reset-password" },
  })
  expect(limited.status()).toBe(429)

  await page.goto("/")
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    /Agent 友好|Agent-friendly/i
  )
  await expect(page.getByText("oworker starter create saas")).toBeVisible()
  await page
    .getByRole("button", { name: /Change language|App language|应用语言/i })
    .click()
  await page.getByRole("menuitemradio", { name: "中文" }).click()
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/Agent 友好/i)
  await page
    .getByRole("button", { name: /Change language|App language|应用语言/i })
    .click()
  await page.getByRole("menuitemradio", { name: "English" }).click()
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/Agent-friendly/i)

  await page.goto("/account")
  await expect(page).toHaveURL(/\/login/)

  const email = configuredAdminEmail || `release-${Date.now()}@example.com`
  await resetReleaseUser(email)
  await page.goto("/register")
  await page.getByLabel("Name").fill("Release Gate")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill("ReleaseGate123!")
  await page.getByRole("button", { name: /Create account/i }).click()

  await expect(page).toHaveURL(/\/verify-email/)
  await expect(page.getByRole("heading", { name: /Verify your email/i })).toBeVisible()
  await expect(page.getByText(/Check your inbox for the verification link/i)).toBeVisible()

  const verificationToken = createEmailVerificationToken(email)
  await page.goto(
    `/api/auth/verify-email?token=${verificationToken}&callbackURL=${encodeURIComponent("/account")}`
  )
  await expect(page).toHaveURL(/\/account/)
  await expect(page.getByRole("heading", { name: /Welcome Release Gate!/i })).toBeVisible()
  await expect(page.getByText(email, { exact: true }).first()).toBeVisible()
  await expect(page.getByText("Verified", { exact: true }).first()).toBeVisible()
  await expect(page.getByLabel("Avatar image")).toBeAttached()
  await expect(page.getByText("Password set").first()).toBeVisible()
  await page.getByRole("button", { name: /^Edit$/i }).click()
  await page.getByLabel("Avatar image").setInputFiles({
    name: "avatar.png",
    mimeType: "image/png",
    buffer: tinyPng(),
  })
  await expect(page.getByText(/Avatar updated/i)).toBeVisible()
  await expect(page.locator('img[src*="/api/account/avatar/image"]').first()).toBeVisible()

  await replaceCredentialWithOAuthOnly(email, "github")
  await page.reload()
  await expect(page.getByText("OAuth only", { exact: true }).first()).toBeVisible()
  await expect(page.getByText("Connected", { exact: true }).first()).toBeVisible()
  await page.getByRole("button", { name: /^Set password$/i }).click()
  await expect(page.getByRole("heading", { name: /Set a local password/i })).toBeVisible()
  const setPasswordForm = page.locator("form").filter({
    has: page.getByLabel("Confirm new password", { exact: true }),
  })
  await setPasswordForm.getByLabel("New password", { exact: true }).fill("ReleaseGate123!")
  await setPasswordForm.getByLabel("Confirm new password", { exact: true }).fill("ReleaseGate123!")
  await setPasswordForm.getByRole("button", { name: /^Set password$/i }).click()
  await expect(page.getByText(/Password set/i).first()).toBeVisible()
  await page.getByRole("button", { name: /^Disconnect$/i }).click()
  await expect(page.getByText(/GitHub disconnected|Connect GitHub/i)).toBeVisible()

  await page.goto("/account/billing")
  await expect(page.getByRole("heading", { name: "Billing", exact: true })).toBeVisible()
  await makeBootstrapSiteAdmin(email)
  await page.goto("/admin")
  await expect(page.getByRole("heading", { name: /Admin Console/i })).toBeVisible()
  await expect(page.getByText(/Visitors today/i)).toBeVisible()
  await page.goto("/admin/users")
  await expect(page.getByText(email, { exact: true }).first()).toBeVisible()
  await expect(page.getByText(/Last seen/i)).toBeVisible()
  await expect.poll(() => readAccountActivity(email)).toBeTruthy()
  await page.goto("/account")

  await page.getByRole("button", { name: /^Change password$/i }).first().click()
  const passwordForm = page.locator("form").filter({
    has: page.getByLabel("Current password", { exact: true }),
  })
  await passwordForm.getByLabel("Current password", { exact: true }).fill("ReleaseGate123!")
  await passwordForm.getByLabel("New password", { exact: true }).fill("ReleaseGate124!")
  await passwordForm.getByLabel("Confirm new password", { exact: true }).fill("ReleaseGate124!")
  await passwordForm.getByRole("button", { name: /^Change password$/i }).click()
  await expect(page.getByText(/Password changed/i)).toBeVisible()

  const changedEmail = `changed-${Date.now()}@example.com`
  await page.getByRole("tab", { name: /^Email$/i }).click()
  await page.getByRole("button", { name: /^Change email$/i }).click()
  const emailForm = page.locator("form").filter({
    has: page.getByLabel("New email"),
  })
  await emailForm.getByLabel("New email").fill(changedEmail)
  await emailForm.getByRole("button", { name: /Send confirmation/i }).click()
  await expect(page.getByText(new RegExp(`Confirmation sent for ${escapeRegExp(changedEmail)}`))).toBeVisible()
  await expect(page.getByText(new RegExp(`Pending change: ${escapeRegExp(email)} -> ${escapeRegExp(changedEmail)}`))).toBeVisible()

  const confirmationToken = createEmailChangeToken(email, changedEmail, "change-email-confirmation")
  await page.goto(
    `/api/auth/verify-email?token=${confirmationToken}&callbackURL=${encodeURIComponent("/account")}`
  )
  await expect(page).toHaveURL(/\/account/)
  await expect(page.getByText(email, { exact: true }).first()).toBeVisible()

  const newEmailVerificationToken = createEmailChangeToken(email, changedEmail, "change-email-verification")
  await page.goto(
    `/api/auth/verify-email?token=${newEmailVerificationToken}&callbackURL=${encodeURIComponent("/account")}`
  )
  await expect(page).toHaveURL(/\/account/)
  await expect(page.getByText(changedEmail, { exact: true }).first()).toBeVisible()

  await page.getByRole("button", { name: /Open user menu/i }).click()
  await page.getByRole("menuitem", { name: /Sign out/i }).click()
  await expect(page).toHaveURL(/\/login/)

  await page.goto("/forgot-password")
  await page.getByLabel("Email").fill(changedEmail)
  await page.getByRole("button", { name: /Send reset link/i }).click()
  await expect(page.getByText(/reset link has been sent/i)).toBeVisible()

  const resetToken = await createPasswordResetToken(changedEmail)
  await page.goto(
    `/api/auth/reset-password/${resetToken}?callbackURL=${encodeURIComponent("/reset-password")}`
  )
  await expect(page).toHaveURL(/\/reset-password\?token=/)
  await page.getByLabel("New password", { exact: true }).fill("ReleaseGate125!")
  await page.getByLabel("Confirm new password", { exact: true }).fill("ReleaseGate125!")
  await page.getByRole("button", { name: /Reset password/i }).click()
  await expect(page.getByText(/Password reset/i)).toBeVisible()

  await page.goto("/login")
  await page.getByLabel("Email").fill(changedEmail)
  await page.getByLabel("Password").fill("ReleaseGate125!")
  await page.getByRole("button", { name: /^Sign in$/i }).click()
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(webUrl)}/?$`))
})

test("theme and mobile auth surfaces are stable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ colorScheme: "light" })

  await page.goto("/")
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    /Agent 友好|Agent-friendly/i
  )
  await page
    .getByRole("button", { name: /Change color theme|Theme/i })
    .click()
  await page.getByRole("menuitemradio", { name: /Dark/i }).click()
  await expect(page.locator("html")).toHaveClass(/dark/)

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  )
  expect(hasHorizontalOverflow).toBeFalsy()

  await page.goto("/login")
  await expect(page.getByRole("heading", { name: /Sign in to your account/i })).toBeVisible()
  await expect(page.getByRole("button", { name: /Sign in/i })).toBeVisible()

  await page.goto("/register")
  await expect(page.getByRole("heading", { name: /Create your first account/i })).toBeVisible()
  await expect(page.getByRole("button", { name: /Create account/i })).toBeVisible()
})

function createEmailVerificationToken(email: string) {
  const now = Math.floor(Date.now() / 1000)
  const header = encodeJwtPart({ alg: "HS256" })
  const payload = encodeJwtPart({
    email,
    iat: now,
    exp: now + 60 * 60,
  })
  const secret =
    process.env.BETTER_AUTH_SECRET || "oworker-saas-starter-dev-secret-change-before-production"
  const signature = createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64url")

  return `${header}.${payload}.${signature}`
}

function encodeJwtPart(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url")
}

function createAuthRequestHeaders(ip: string) {
  return {
    origin: webUrl,
    "x-forwarded-for": ip,
  }
}

async function replaceCredentialWithOAuthOnly(email: string, provider: "github" | "google") {
  const client = new Client({ connectionString: getDatabaseUrl() })
  await client.connect()

  try {
    const user = await client.query<{ id: string }>(
      'select id from "user" where lower(email) = lower($1) limit 1',
      [email]
    )
    expect(user.rowCount).toBe(1)
    const userId = user.rows[0].id
    const now = new Date()

    await client.query('delete from account where "userId" = $1', [userId])
    await client.query(
      'insert into account (id, "accountId", "providerId", "userId", "createdAt", "updatedAt") values ($1, $2, $3, $4, $5, $6)',
      [
        randomBytes(16).toString("hex"),
        `${provider}-${userId}`,
        provider,
        userId,
        now,
        now,
      ]
    )
  } finally {
    await client.end()
  }
}

async function makeBootstrapSiteAdmin(email: string) {
  const client = new Client({ connectionString: getDatabaseUrl() })
  await client.connect()

  try {
    await client.query(
      `
        update "user"
        set "createdAt" = (
          select coalesce(min("createdAt"), now()) - interval '1 second'
          from "user"
        )
        where lower(email) = lower($1)
      `,
      [email]
    )
  } finally {
    await client.end()
  }
}

async function resetReleaseUser(email: string) {
  const client = new Client({ connectionString: getDatabaseUrl() })
  await client.connect()

  try {
    const user = await client.query<{ id: string }>(
      'select id from "user" where lower(email) = lower($1) limit 1',
      [email]
    )
    const userId = user.rows[0]?.id

    if (!userId) {
      return
    }

    await deleteIfTableExists(client, "session", '"userId" = $1', [userId])
    await deleteIfTableExists(client, "account", '"userId" = $1', [userId])
    await deleteIfTableExists(client, "verification", "identifier like $1", [`%${email}%`])
    await deleteIfTableExists(client, "account_activity_summary", "user_id = $1", [userId])
    await deleteIfTableExists(client, "audit_log", "actor_user_id = $1", [userId])
    await deleteIfTableExists(client, "payment_record", "account_id = $1", [userId])
    await deleteIfTableExists(client, "billing_subscription", "account_id = $1", [userId])
    await client.query('delete from "user" where id = $1', [userId])
  } finally {
    await client.end()
  }
}

async function deleteIfTableExists(
  client: InstanceType<typeof Client>,
  tableName: string,
  whereSql: string,
  params: unknown[]
) {
  const table = await client.query<{ exists: boolean }>(
    `
      select exists (
        select 1
        from information_schema.tables
        where table_schema = 'public'
          and table_name = $1
      ) as exists
    `,
    [tableName]
  )

  if (!table.rows[0]?.exists) {
    return
  }

  await client.query(`delete from "${tableName}" where ${whereSql}`, params)
}

async function readAccountActivity(email: string) {
  const client = new Client({ connectionString: getDatabaseUrl() })
  await client.connect()

  try {
    const result = await client.query<{ lastPath: string }>(
      `
        select activity.last_path as "lastPath"
        from account_activity_summary activity
        join "user" u on u.id = activity.user_id
        where lower(u.email) = lower($1)
        limit 1
      `,
      [email]
    )
    return Boolean(result.rows[0]?.lastPath)
  } finally {
    await client.end()
  }
}

function createEmailChangeToken(
  email: string,
  updateTo: string,
  requestType: "change-email-confirmation" | "change-email-verification"
) {
  const now = Math.floor(Date.now() / 1000)
  const header = encodeJwtPart({ alg: "HS256" })
  const payload = encodeJwtPart({
    email,
    updateTo,
    requestType,
    iat: now,
    exp: now + 60 * 60,
  })
  const secret =
    process.env.BETTER_AUTH_SECRET || "oworker-saas-starter-dev-secret-change-before-production"
  const signature = createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64url")

  return `${header}.${payload}.${signature}`
}

async function createPasswordResetToken(email: string) {
  const client = new Client({ connectionString: getDatabaseUrl() })
  await client.connect()

  try {
    const user = await client.query<{ id: string }>(
      'select id from "user" where lower(email) = lower($1) limit 1',
      [email]
    )
    expect(user.rowCount).toBe(1)

    const token = randomBytes(18).toString("base64url")
    const now = new Date()
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000)

    await client.query(
      'insert into verification (id, identifier, value, "expiresAt", "createdAt", "updatedAt") values ($1, $2, $3, $4, $5, $6)',
      [
        randomBytes(16).toString("hex"),
        `reset-password:${token}`,
        user.rows[0].id,
        expiresAt,
        now,
        now,
      ]
    )

    return token
  } finally {
    await client.end()
  }
}

function getDatabaseUrl() {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL
  }

  const port = process.env.OWORKER_DB_PORT || "5432"
  return `postgresql://oworker:oworker@127.0.0.1:${port}/oworker_saas`
}

function firstConfiguredEmail(value?: string) {
  return (
    value
      ?.split(",")
      .map((item) => item.trim().toLowerCase())
      .find(Boolean) || null
  )
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function tinyPng() {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/at8S9sAAAAASUVORK5CYII=",
    "base64"
  )
}
