import {
  MODEL_CATALOG_SCHEMA_VERSION,
  isImageCapabilityProfileSpec,
  type ImageCapabilityProfileSpec,
  type ModelCatalogOffering,
  type ModelCatalogProjection,
} from "@muses/domain"

import { getPgPool } from "@/lib/database"

export class ModelCatalogError extends Error {
  constructor(
    readonly code:
      | "model-offering-unavailable"
      | "model-capability-invalid"
      | "model-price-unavailable",
    message: string
  ) {
    super(message)
    this.name = "ModelCatalogError"
  }
}

export type ResolvedImageModelOffering = ModelCatalogOffering & {
  readonly providerModelId: string
}

export type AdminModelOffering = ResolvedImageModelOffering & {
  readonly lifecycleStatus: "draft" | "published" | "deprecated" | "retired"
  readonly enabled: boolean
  readonly specificationVersion: string
  readonly updatedAt: string
}

export async function getStudioModelCatalog(
  _workspaceId: string
): Promise<ModelCatalogProjection> {
  const rows = await queryCatalogRows({ onlyAvailable: true })
  return {
    schemaVersion: MODEL_CATALOG_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    offerings: rows.map(toStudioOffering),
  }
}

export async function resolveImageModelOffering(
  modelRef: string
): Promise<ResolvedImageModelOffering> {
  const rows = await queryCatalogRows({ onlyAvailable: true, modelRef })
  const row = rows[0]
  if (!row) {
    throw new ModelCatalogError(
      "model-offering-unavailable",
      `Model offering "${modelRef}" is not published or enabled.`
    )
  }
  return toResolvedOffering(row)
}

export async function getAdminModelOfferings(): Promise<AdminModelOffering[]> {
  const rows = await queryCatalogRows({ onlyAvailable: false })
  return rows.map((row) => ({
    ...toResolvedOffering(row),
    lifecycleStatus: row.lifecycleStatus,
    enabled: row.enabled,
    specificationVersion: row.specificationVersion,
    updatedAt: new Date(row.updatedAt).toISOString(),
  }))
}

export async function setModelOfferingEnabled(input: {
  offeringId: string
  enabled: boolean
  actorUserId: string
  actorEmail: string
}) {
  const client = await getPgPool().connect()
  try {
    await client.query("begin")
    const updated = await client.query<{
      id: string
      modelRef: string
      enabled: boolean
    }>(
      `
        update model_offering
        set enabled = $2, updated_at = now()
        where id = $1 and lifecycle_status in ('published', 'deprecated')
        returning id, model_ref as "modelRef", enabled
      `,
      [input.offeringId, input.enabled]
    )
    const offering = updated.rows[0]
    if (!offering) {
      throw new ModelCatalogError(
        "model-offering-unavailable",
        "The model offering cannot be enabled or disabled."
      )
    }
    await client.query(
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
        values ($1, $2, $3, $4, 'model_offering', $5, $6)
      `,
      [
        `audit_${crypto.randomUUID().replaceAll("-", "")}`,
        input.actorUserId,
        input.actorEmail,
        input.enabled ? "model_offering.enabled" : "model_offering.disabled",
        offering.id,
        JSON.stringify({
          modelRef: offering.modelRef,
          enabled: offering.enabled,
        }),
      ]
    )
    await client.query("commit")
    return offering
  } catch (error) {
    await client.query("rollback").catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

type CatalogRow = {
  id: string
  modelRef: string
  providerModelId: string
  displayName: string
  providerId: string
  providerDisplayName: string
  lifecycleStatus: "draft" | "published" | "deprecated" | "retired"
  enabled: boolean
  specificationVersion: string
  updatedAt: Date | string
  profileId: string
  capabilityId: string
  profileVersion: string
  specification: unknown
  priceEntryId: string
  priceBookVersion: string
  billingUnit: string
  unitCreditMicros: string
}

async function queryCatalogRows(input: {
  onlyAvailable: boolean
  modelRef?: string
}) {
  const conditions = ["offering.capability_family = 'image'"]
  const values: string[] = []
  if (input.onlyAvailable) {
    conditions.push("provider.status = 'active'")
    conditions.push("offering.lifecycle_status = 'published'")
    conditions.push("offering.enabled = true")
  }
  if (input.modelRef) {
    values.push(input.modelRef)
    conditions.push(`offering.model_ref = $${values.length}`)
  }
  const result = await getPgPool().query<CatalogRow>(
    `
      select
        offering.id,
        offering.model_ref as "modelRef",
        offering.provider_model_id as "providerModelId",
        offering.display_name as "displayName",
        offering.lifecycle_status as "lifecycleStatus",
        offering.enabled,
        offering.specification_version as "specificationVersion",
        offering.updated_at as "updatedAt",
        provider.id as "providerId",
        provider.display_name as "providerDisplayName",
        profile.id as "profileId",
        profile.capability_id as "capabilityId",
        profile.profile_version as "profileVersion",
        profile.specification,
        price.id as "priceEntryId",
        price.price_book_version as "priceBookVersion",
        price.billing_unit as "billingUnit",
        price.unit_credit_micros as "unitCreditMicros"
      from model_offering offering
      join model_provider provider on provider.id = offering.provider_id
      join lateral (
        select *
        from capability_profile candidate
        where candidate.model_offering_id = offering.id
          and candidate.capability_id = 'image.generate.v1'
          and candidate.lifecycle_status = 'published'
        order by candidate.published_at desc nulls last, candidate.created_at desc
        limit 1
      ) profile on true
      join lateral (
        select *
        from price_book_entry candidate
        where candidate.model_offering_id = offering.id
          and candidate.billing_unit = 'image-output'
          and candidate.lifecycle_status = 'published'
          and candidate.effective_from <= now()
          and (candidate.effective_to is null or candidate.effective_to > now())
        order by candidate.effective_from desc, candidate.created_at desc
        limit 1
      ) price on true
      where ${conditions.join(" and ")}
      order by offering.sort_order, offering.display_name, offering.model_ref
    `,
    values
  )
  return result.rows
}

function toStudioOffering(row: CatalogRow): ModelCatalogOffering {
  return stripExecutionFields(toResolvedOffering(row))
}

function toResolvedOffering(row: CatalogRow): ResolvedImageModelOffering {
  if (!isImageCapabilityProfileSpec(row.specification)) {
    throw new ModelCatalogError(
      "model-capability-invalid",
      `Capability profile "${row.profileId}" is invalid.`
    )
  }
  if (row.billingUnit !== "image-output" || BigInt(row.unitCreditMicros) <= 0) {
    throw new ModelCatalogError(
      "model-price-unavailable",
      `Price book entry "${row.priceEntryId}" is invalid.`
    )
  }
  return {
    id: row.id,
    modelRef: row.modelRef,
    providerModelId: row.providerModelId,
    displayName: row.displayName,
    provider: {
      id: row.providerId,
      displayName: row.providerDisplayName,
    },
    capability: {
      id: row.capabilityId,
      profileId: row.profileId,
      profileVersion: row.profileVersion,
      specification: row.specification as ImageCapabilityProfileSpec,
    },
    price: {
      entryId: row.priceEntryId,
      priceBookVersion: row.priceBookVersion,
      billingUnit: "image-output",
      unitCreditMicros: row.unitCreditMicros,
    },
  }
}

function stripExecutionFields(
  offering: ResolvedImageModelOffering
): ModelCatalogOffering {
  const { providerModelId: _providerModelId, ...projection } = offering
  return projection
}
