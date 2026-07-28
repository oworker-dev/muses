import { randomUUID } from "node:crypto"

import { getServerSession } from "@/lib/auth"
import { getPgPool } from "@/lib/database"

const ZERO = BigInt(0)
const DEFAULT_INITIAL_CREDIT_MICROS = BigInt(100_000_000)

export type StudioWorkspaceContext = {
  workspace: {
    id: string
    name: string
    kind: "personal" | "team"
    role: "owner" | "admin" | "member" | "viewer"
  }
  credits: {
    currency: "MUSES_CREDIT"
    postedMicros: bigint
    reservedMicros: bigint
    availableMicros: bigint
  }
}

type StudioUser = {
  id: string
  email: string
  name?: string | null
  emailVerified: boolean
}

export async function ensurePersonalStudioWorkspace(
  user: StudioUser
): Promise<StudioWorkspaceContext> {
  const client = await getPgPool().connect()
  try {
    await client.query("begin")
    await client.query(
      "select pg_advisory_xact_lock(hashtextextended($1, 1))",
      [user.id]
    )

    let workspace = (
      await client.query<{
        id: string
        name: string
        kind: "personal"
      }>(
        `
          select id, name, kind
          from muses_workspace
          where personal_owner_user_id = $1
          limit 1
        `,
        [user.id]
      )
    ).rows[0]

    if (!workspace) {
      const workspaceId = prefixedId("mws")
      const displayName =
        user.name?.trim() || user.email.split("@")[0] || "Muses"
      workspace = (
        await client.query<{
          id: string
          name: string
          kind: "personal"
        }>(
          `
            insert into muses_workspace (
              id,
              kind,
              name,
              personal_owner_user_id,
              created_by_user_id
            )
            values ($1, 'personal', $2, $3, $3)
            returning id, name, kind
          `,
          [workspaceId, `${displayName}'s workspace`, user.id]
        )
      ).rows[0]
    }

    await client.query(
      `
        insert into muses_workspace_member (
          workspace_id,
          user_id,
          role,
          status
        )
        values ($1, $2, 'owner', 'active')
        on conflict (workspace_id, user_id) do update
        set role = 'owner', status = 'active', updated_at = now()
      `,
      [workspace.id, user.id]
    )

    let account = (
      await client.query<CreditAccountRow>(
        `
          select
            id,
            currency,
            posted_balance_micros as "postedMicros",
            reserved_balance_micros as "reservedMicros"
          from credit_account
          where workspace_id = $1
          for update
        `,
        [workspace.id]
      )
    ).rows[0]

    if (!account) {
      account = (
        await client.query<CreditAccountRow>(
          `
            insert into credit_account (id, workspace_id)
            values ($1, $2)
            returning
              id,
              currency,
              posted_balance_micros as "postedMicros",
              reserved_balance_micros as "reservedMicros"
          `,
          [prefixedId("mca"), workspace.id]
        )
      ).rows[0]
    }

    const initialCreditMicros = getInitialCreditMicros()
    const grantKey = "workspace-initial-development-grant:v1"
    const granted = await client.query(
      `
        select 1
        from credit_ledger_entry
        where account_id = $1 and idempotency_key = $2
        limit 1
      `,
      [account.id, grantKey]
    )
    if (!granted.rowCount && initialCreditMicros > ZERO) {
      const nextPosted = BigInt(account.postedMicros) + initialCreditMicros
      await client.query(
        `
          insert into credit_ledger_entry (
            id,
            account_id,
            workspace_id,
            kind,
            balance_delta_micros,
            reserved_delta_micros,
            balance_after_micros,
            reserved_after_micros,
            idempotency_key,
            actor_user_id,
            reason,
            metadata
          )
          values ($1, $2, $3, 'grant', $4, 0, $5, $6, $7, $8, $9, $10)
        `,
        [
          prefixedId("mle"),
          account.id,
          workspace.id,
          initialCreditMicros.toString(),
          nextPosted.toString(),
          account.reservedMicros,
          grantKey,
          user.id,
          "Initial development credit grant",
          JSON.stringify({ policyVersion: "development-v1" }),
        ]
      )
      await client.query(
        `
          update credit_account
          set posted_balance_micros = $2, updated_at = now()
          where id = $1
        `,
        [account.id, nextPosted.toString()]
      )
      account = { ...account, postedMicros: nextPosted.toString() }
    }

    await client.query("commit")
    return studioContext(workspace, "owner", account)
  } catch (error) {
    await client.query("rollback").catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

export async function getAuthorizedStudioWorkspace(
  user: StudioUser,
  requestedWorkspaceId?: string
): Promise<StudioWorkspaceContext | null> {
  const personal = await ensurePersonalStudioWorkspace(user)
  if (!requestedWorkspaceId || requestedWorkspaceId === personal.workspace.id) {
    return personal
  }

  const result = await getPgPool().query<{
    id: string
    name: string
    kind: "personal" | "team"
    role: "owner" | "admin" | "member" | "viewer"
    currency: "MUSES_CREDIT"
    postedMicros: string
    reservedMicros: string
  }>(
    `
      select
        workspace.id,
        workspace.name,
        workspace.kind,
        member.role,
        account.currency,
        account.posted_balance_micros as "postedMicros",
        account.reserved_balance_micros as "reservedMicros"
      from muses_workspace workspace
      join muses_workspace_member member
        on member.workspace_id = workspace.id
       and member.user_id = $1
       and member.status = 'active'
      join credit_account account on account.workspace_id = workspace.id
      where workspace.id = $2
      limit 1
    `,
    [user.id, requestedWorkspaceId]
  )
  const row = result.rows[0]
  return row ? studioContext(row, row.role, row) : null
}

export async function requireStudioApiAccess(requestedWorkspaceId?: string) {
  const session = await getServerSession()
  if (!session) {
    return {
      ok: false as const,
      response: Response.json(
        {
          error: "authentication-required",
          message: "Sign in to use Muses Studio.",
        },
        { status: 401 }
      ),
    }
  }
  if (!session.user.emailVerified) {
    return {
      ok: false as const,
      response: Response.json(
        {
          error: "email-verification-required",
          message: "Verify your email before using Muses Studio.",
        },
        { status: 403 }
      ),
    }
  }
  const context = await getAuthorizedStudioWorkspace(
    session.user,
    requestedWorkspaceId
  )
  if (!context) {
    return {
      ok: false as const,
      response: Response.json(
        { error: "workspace-not-found", message: "Workspace was not found." },
        { status: 404 }
      ),
    }
  }
  return { ok: true as const, user: session.user, context }
}

export function serializeStudioContext(context: StudioWorkspaceContext) {
  return {
    workspace: context.workspace,
    credits: {
      currency: context.credits.currency,
      postedMicros: context.credits.postedMicros.toString(),
      reservedMicros: context.credits.reservedMicros.toString(),
      availableMicros: context.credits.availableMicros.toString(),
    },
  }
}

type CreditAccountRow = {
  id: string
  currency: string
  postedMicros: string
  reservedMicros: string
}

function studioContext(
  workspace: { id: string; name: string; kind: "personal" | "team" },
  role: StudioWorkspaceContext["workspace"]["role"],
  account: Pick<
    CreditAccountRow,
    "currency" | "postedMicros" | "reservedMicros"
  >
): StudioWorkspaceContext {
  const postedMicros = BigInt(account.postedMicros)
  const reservedMicros = BigInt(account.reservedMicros)
  return {
    workspace: { ...workspace, role },
    credits: {
      currency: "MUSES_CREDIT",
      postedMicros,
      reservedMicros,
      availableMicros: postedMicros - reservedMicros,
    },
  }
}

function getInitialCreditMicros() {
  const configured = process.env.MUSES_INITIAL_CREDIT_MICROS?.trim()
  if (!configured) return DEFAULT_INITIAL_CREDIT_MICROS
  if (!/^\d+$/.test(configured)) {
    throw new Error(
      "MUSES_INITIAL_CREDIT_MICROS must be a non-negative integer."
    )
  }
  return BigInt(configured)
}

export function prefixedId(prefix: string) {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`
}
