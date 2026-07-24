import { randomUUID } from "node:crypto"

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
    `,
    [
      randomUUID(),
      input.actor?.userId || null,
      input.actor?.email || null,
      input.action,
      input.targetType,
      input.targetId || null,
      JSON.stringify(input.metadata || {}),
    ]
  )
}
