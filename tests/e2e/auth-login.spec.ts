import { expect, test } from "@playwright/test"
import pg from "pg"

const { Client } = pg
const authEmail = "muses-auth-fallback-e2e@example.com"
const authPassword = "MusesAuthFallbackE2E123!"

test.describe.serial("email sign-in", () => {
  test.beforeAll(async ({ request }) => {
    await resetAuthUser()
    const signup = await request.post("/api/auth/sign-up/email", {
      headers: { "x-forwarded-for": "203.0.113.71" },
      data: {
        name: "Muses Auth Fallback E2E",
        email: authEmail,
        password: authPassword,
        callbackURL: "/studio",
      },
    })

    expect(signup.ok()).toBeTruthy()
    await verifyAuthUser()
  })

  test.afterAll(async () => {
    await resetAuthUser()
  })

  test("no-JavaScript failure never places credentials in the URL", async ({
    browser,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false })
    const page = await context.newPage()
    const submittedEmail = "url-leak-check@example.com"
    const submittedPassword = "NeverPlaceThisPasswordInAUrl123!"

    await page.goto("/login?callbackURL=/studio")
    await page.locator('input[name="email"]').fill(submittedEmail)
    await page.locator('input[name="password"]').fill(submittedPassword)
    await page.locator('button[type="submit"]').click()

    await expect(page).toHaveURL(/\/login\?.*authError=invalid-credentials/)
    expect(page.url()).not.toContain(encodeURIComponent(submittedEmail))
    expect(page.url()).not.toContain(encodeURIComponent(submittedPassword))
    expect(page.url()).not.toContain(submittedEmail)
    expect(page.url()).not.toContain(submittedPassword)
    await context.close()
  })

  test("no-JavaScript form sign-in creates a session and reaches Studio", async ({
    browser,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false })
    const page = await context.newPage()

    await page.goto("/login?callbackURL=/studio")
    await page.locator('input[name="email"]').fill(authEmail)
    await page.locator('input[name="password"]').fill(authPassword)
    await page.locator('button[type="submit"]').click()

    await expect(page).toHaveURL(/\/studio$/)
    const cookies = await context.cookies()
    expect(cookies.some(({ name }) => name.includes("session_token"))).toBeTruthy()
    expect(page.url()).not.toContain(authEmail)
    expect(page.url()).not.toContain(authPassword)
    await context.close()
  })

  test("hydrated email sign-in still reaches Studio", async ({ page }) => {
    await page.goto("/login?callbackURL=/studio")
    await page.locator('input[name="email"]').fill(authEmail)
    await page.locator('input[name="password"]').fill(authPassword)
    await page.locator('button[type="submit"]').click()

    await expect(page).toHaveURL(/\/studio$/)
    await expect(page.getByTestId("studio-agent-panel")).toBeVisible()
  })
})

async function verifyAuthUser() {
  const client = new Client({ connectionString: getDatabaseUrl() })
  await client.connect()

  try {
    await client.query(
      'update "user" set "emailVerified" = true, "updatedAt" = now() where lower(email) = lower($1)',
      [authEmail]
    )
  } finally {
    await client.end()
  }
}

async function resetAuthUser() {
  const client = new Client({ connectionString: getDatabaseUrl() })
  await client.connect()

  try {
    const user = await client.query<{ id: string }>(
      'select id from "user" where lower(email) = lower($1) limit 1',
      [authEmail]
    )
    const userId = user.rows[0]?.id

    if (!userId) {
      return
    }

    for (const table of ["session", "account"]) {
      await client.query(`delete from "${table}" where "userId" = $1`, [userId])
    }
    await client.query('delete from "user" where id = $1', [userId])
  } finally {
    await client.end()
  }
}

function getDatabaseUrl() {
  return (
    process.env.DATABASE_URL ||
    "postgresql://postgres:postgres@127.0.0.1:5432/saas"
  )
}
