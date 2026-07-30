import { createHash, randomUUID } from "node:crypto"

import { getPgPool } from "@/lib/database"

export type AuditActor = {
  userId?: string | null
  email?: string | null
}

export async function recordAuditLog(input: {
  actor?: AuditActor | null
  action: string
  targetType: string
  targetId?: string | null
  metadata?: Record<string, unknown>
  idempotencyKey?: string
}) {
  await getPgPool().query(
    `
      insert into audit_log (
        id,
        actor_user_id,
        actor_email,
        action,
        target_type,
        target_id,
        metadata
      )
      values ($1, $2, $3, $4, $5, $6, $7::jsonb)
      on conflict (id) do nothing
    `,
    [
      input.idempotencyKey
        ? `audit_${createHash("sha256")
            .update(
              `${input.action}:${input.targetType}:${input.targetId || ""}:${input.idempotencyKey}`
            )
            .digest("hex")
            .slice(0, 32)}`
        : randomUUID(),
      input.actor?.userId || null,
      input.actor?.email || null,
      input.action,
      input.targetType,
      input.targetId || null,
      JSON.stringify(input.metadata || {}),
    ]
  )
}
