import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { randomUUID } from "node:crypto"
import sharp, { type Metadata } from "sharp"

import { getPgPool } from "@/lib/database"

export type ReferenceImageMimeType =
  | "image/png"
  | "image/jpeg"
  | "image/webp"

export type ReferenceImageAsset = {
  id: string
  workspaceId: string
  fileName: string
  mimeType: ReferenceImageMimeType
  byteSize: number
  width: number
  height: number
  createdAt: string
  url: string
}

export const referenceImageMaxBytes = 50 * 1024 * 1024

export class ReferenceImageRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ReferenceImageRequestError"
  }
}

export class ReferenceImageValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ReferenceImageValidationError"
  }
}

const assetIdPattern = /^refimg_[a-f0-9]{32}$/
const allowedImageTypes = new Map<ReferenceImageMimeType, string>([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
])

let bucketReady = false

export async function createReferenceImageUpload(input: {
  workspaceId: string
  userId: string
  fileName: string
  contentType: string
  size: number
}) {
  const mimeType = normalizeMimeType(input.contentType)
  const extension = allowedImageTypes.get(mimeType)
  if (!extension) throw new Error("Unsupported reference image type.")
  if (!Number.isSafeInteger(input.size) || input.size <= 0) {
    throw new Error("Reference image size is required.")
  }
  if (input.size > referenceImageMaxBytes) {
    throw new Error("Reference image must be 50 MB or smaller.")
  }

  const config = getStorageConfig()
  await ensureBucket(config)
  const assetId = `refimg_${randomUUID().replaceAll("-", "")}`
  const fileName = safeFileName(input.fileName, extension)
  const key = `reference-images/${input.workspaceId}/${assetId}.${extension}`
  const expiresInSeconds = 15 * 60
  const publicClient = createS3Client(config.publicEndpoint, config)
  const url = await getSignedUrl(
    publicClient,
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      ContentType: mimeType,
      Metadata: {
        workspace: input.workspaceId,
        asset: assetId,
      },
    }),
    { expiresIn: expiresInSeconds }
  )

  await getPgPool().query(
    `
      insert into muses_reference_image (
        id,
        workspace_id,
        object_key,
        file_name,
        declared_mime_type,
        created_by_user_id
      )
      values ($1, $2, $3, $4, $5, $6)
    `,
    [assetId, input.workspaceId, key, fileName, mimeType, input.userId]
  )

  return {
    assetId,
    provider: "s3-compatible" as const,
    method: "PUT" as const,
    url,
    headers: { "content-type": mimeType },
    maxBytes: referenceImageMaxBytes,
    expiresInSeconds,
  }
}

export async function confirmReferenceImage(input: {
  workspaceId: string
  assetId: string
}) {
  assertReferenceImageAssetId(input.assetId)
  const row = await getReferenceImageRow(input)
  if (!row) throw new ReferenceImageRequestError("Reference image was not found.")
  if (row.status === "ready") return toAsset(row)
  if (row.status !== "uploading") {
    throw new ReferenceImageRequestError(
      "Reference image upload was rejected."
    )
  }

  try {
    const object = await getObject(row.objectKey)
    if (!object.Body) throw new Error("Reference image object is empty.")
    const bytes = await object.Body.transformToByteArray()
    if (bytes.byteLength === 0 || bytes.byteLength > referenceImageMaxBytes) {
      throw new ReferenceImageValidationError(
        "Reference image size is invalid."
      )
    }
    let metadata: Metadata
    try {
      metadata = await sharp(Buffer.from(bytes)).metadata()
    } catch {
      throw new ReferenceImageValidationError(
        "Reference image content could not be read."
      )
    }
    const mimeType = imageFormatToMimeType(metadata.format)
    if (!mimeType || mimeType !== row.declaredMimeType) {
      throw new ReferenceImageValidationError(
        "Reference image content does not match its file type."
      )
    }
    if (!metadata.width || !metadata.height) {
      throw new ReferenceImageValidationError(
        "Reference image dimensions could not be read."
      )
    }
    const result = await getPgPool().query<ReferenceImageRow>(
      `
        update muses_reference_image
        set status = 'ready',
            mime_type = $3,
            byte_size = $4,
            width = $5,
            height = $6,
            confirmed_at = now()
        where id = $1 and workspace_id = $2 and status = 'uploading'
        returning
          id,
          workspace_id as "workspaceId",
          object_key as "objectKey",
          file_name as "fileName",
          declared_mime_type as "declaredMimeType",
          mime_type as "mimeType",
          byte_size as "byteSize",
          width,
          height,
          status,
          created_at as "createdAt"
      `,
      [
        input.assetId,
        input.workspaceId,
        mimeType,
        bytes.byteLength,
        metadata.width,
        metadata.height,
      ]
    )
    const confirmed = result.rows[0]
    if (!confirmed) throw new Error("Reference image could not be confirmed.")
    return toAsset(confirmed)
  } catch (error) {
    if (error instanceof ReferenceImageValidationError) {
      await getPgPool()
        .query(
          `
            update muses_reference_image
            set status = 'rejected'
            where id = $1 and workspace_id = $2 and status = 'uploading'
          `,
          [input.assetId, input.workspaceId]
        )
        .catch(() => undefined)
    }
    throw error
  }
}

export async function getReadyReferenceImages(input: {
  workspaceId: string
  assetIds: readonly string[]
}) {
  const assetIds = [...new Set(input.assetIds)]
  if (assetIds.length === 0) return []
  assetIds.forEach(assertReferenceImageAssetId)
  const result = await getPgPool().query<ReferenceImageRow>(
    `
      select
        id,
        workspace_id as "workspaceId",
        object_key as "objectKey",
        file_name as "fileName",
        declared_mime_type as "declaredMimeType",
        mime_type as "mimeType",
        byte_size as "byteSize",
        width,
        height,
        status,
        created_at as "createdAt"
      from muses_reference_image
      where workspace_id = $1 and id = any($2::text[]) and status = 'ready'
    `,
    [input.workspaceId, assetIds]
  )
  const byId = new Map(result.rows.map((row) => [row.id, row]))
  if (byId.size !== assetIds.length) {
    throw new Error("One or more reference images are unavailable.")
  }
  return assetIds.map((assetId) => toAsset(byId.get(assetId)!))
}

export async function readReadyReferenceImageBytes(input: {
  workspaceId: string
  assetIds: readonly string[]
}) {
  const assets = await getReadyReferenceImages(input)
  return Promise.all(
    assets.map(async (asset) => {
      const row = await getReferenceImageRow({
        workspaceId: input.workspaceId,
        assetId: asset.id,
      })
      if (!row) throw new Error("Reference image was not found.")
      const object = await getObject(row.objectKey)
      if (!object.Body) throw new Error("Reference image object is empty.")
      return {
        asset,
        bytes: await object.Body.transformToByteArray(),
      }
    })
  )
}

export async function readReferenceImageObject(input: {
  workspaceId: string
  assetId: string
}) {
  const row = await getReferenceImageRow(input)
  if (!row || row.status !== "ready" || !row.mimeType) {
    throw new Error("Reference image was not found.")
  }
  const object = await getObject(row.objectKey)
  if (!object.Body) throw new Error("Reference image object is empty.")
  return {
    body: object.Body.transformToWebStream(),
    contentType: row.mimeType,
  }
}

export function assertReferenceImageAssetId(assetId: string) {
  if (!assetIdPattern.test(assetId)) {
    throw new ReferenceImageRequestError(
      "Reference image asset id is invalid."
    )
  }
}

function toAsset(row: ReferenceImageRow): ReferenceImageAsset {
  if (
    row.status !== "ready" ||
    !row.mimeType ||
    !row.byteSize ||
    !row.width ||
    !row.height
  ) {
    throw new Error("Reference image metadata is incomplete.")
  }
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    fileName: row.fileName,
    mimeType: row.mimeType,
    byteSize: Number(row.byteSize),
    width: row.width,
    height: row.height,
    createdAt: new Date(row.createdAt).toISOString(),
    url: `/api/studio/reference-images/${row.id}?workspaceId=${encodeURIComponent(row.workspaceId)}`,
  }
}

async function getReferenceImageRow(input: {
  workspaceId: string
  assetId: string
}) {
  const result = await getPgPool().query<ReferenceImageRow>(
    `
      select
        id,
        workspace_id as "workspaceId",
        object_key as "objectKey",
        file_name as "fileName",
        declared_mime_type as "declaredMimeType",
        mime_type as "mimeType",
        byte_size as "byteSize",
        width,
        height,
        status,
        created_at as "createdAt"
      from muses_reference_image
      where workspace_id = $1 and id = $2
      limit 1
    `,
    [input.workspaceId, input.assetId]
  )
  return result.rows[0]
}

async function getObject(key: string) {
  const config = getStorageConfig()
  return createS3Client(config.endpoint, config).send(
    new GetObjectCommand({ Bucket: config.bucket, Key: key })
  )
}

function imageFormatToMimeType(
  format: string | undefined
): ReferenceImageMimeType | null {
  if (format === "png") return "image/png"
  if (format === "jpeg") return "image/jpeg"
  if (format === "webp") return "image/webp"
  return null
}

function normalizeMimeType(value: string) {
  return value.split(";")[0].trim().toLowerCase() as ReferenceImageMimeType
}

function safeFileName(fileName: string, extension: string) {
  const base =
    fileName
      .trim()
      .toLowerCase()
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "reference"
  return `${base}.${extension}`
}

async function ensureBucket(config: StorageConfig) {
  if (bucketReady) return
  const client = createS3Client(config.endpoint, config)
  try {
    await client.send(new HeadBucketCommand({ Bucket: config.bucket }))
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: config.bucket }))
  }
  bucketReady = true
}

function getStorageConfig(): StorageConfig {
  const endpoint = process.env.S3_ENDPOINT
  const publicEndpoint = process.env.S3_PUBLIC_ENDPOINT || endpoint
  const accessKeyId = process.env.S3_ACCESS_KEY_ID
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY
  if (!endpoint || !publicEndpoint || !accessKeyId || !secretAccessKey) {
    throw new Error("Reference image storage is not configured.")
  }
  return {
    endpoint,
    publicEndpoint,
    bucket: process.env.S3_BUCKET || "oworker-saas",
    region: process.env.S3_REGION || "us-east-1",
    accessKeyId,
    secretAccessKey,
  }
}

function createS3Client(endpoint: string, config: StorageConfig) {
  return new S3Client({
    region: config.region,
    endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
}

type ReferenceImageRow = {
  id: string
  workspaceId: string
  objectKey: string
  fileName: string
  declaredMimeType: ReferenceImageMimeType
  mimeType: ReferenceImageMimeType | null
  byteSize: string | null
  width: number | null
  height: number | null
  status: "uploading" | "ready" | "rejected"
  createdAt: Date | string
}

type StorageConfig = {
  endpoint: string
  publicEndpoint: string
  bucket: string
  region: string
  accessKeyId: string
  secretAccessKey: string
}
