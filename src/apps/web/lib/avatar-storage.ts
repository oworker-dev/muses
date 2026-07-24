import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { randomUUID } from "node:crypto"

const allowedImageTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
])

export const avatarMaxBytes = 2 * 1024 * 1024

let bucketReady = false

export type AvatarUpload = {
  provider: "s3-compatible"
  bucket: string
  key: string
  method: "PUT"
  url: string
  headers: Record<string, string>
  maxBytes: number
  expiresInSeconds: number
}

export async function createAvatarUpload(input: {
  userId: string
  fileName: string
  contentType: string
  size?: number
}): Promise<AvatarUpload> {
  const contentType = normalizeContentType(input.contentType)
  const extension = allowedImageTypes.get(contentType)

  if (!extension) {
    throw new Error("Unsupported avatar image type.")
  }

  if (typeof input.size === "number" && input.size > avatarMaxBytes) {
    throw new Error("Avatar image is too large.")
  }

  const config = getStorageConfig()
  await ensureBucket(config)

  const key = `avatars/${input.userId}/${randomUUID()}-${safeFileName(input.fileName, extension)}`
  const client = createS3Client({
    ...config,
    endpoint: config.publicEndpoint,
  })
  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    ContentType: contentType,
  })
  const expiresInSeconds = 15 * 60

  return {
    provider: "s3-compatible",
    bucket: config.bucket,
    key,
    method: "PUT",
    url: await getSignedUrl(client, command, { expiresIn: expiresInSeconds }),
    headers: {
      "content-type": contentType,
    },
    maxBytes: avatarMaxBytes,
    expiresInSeconds,
  }
}

export async function readAvatarObject(key: string) {
  const config = getStorageConfig()
  const client = createS3Client(config)
  const result = await client.send(
    new GetObjectCommand({
      Bucket: config.bucket,
      Key: key,
    })
  )

  if (!result.Body) {
    throw new Error("Avatar object is empty.")
  }

  return {
    body: result.Body.transformToWebStream(),
    contentType: result.ContentType || "application/octet-stream",
  }
}

export async function ensureAvatarObjectExists(key: string) {
  const config = getStorageConfig()
  const client = createS3Client(config)
  await client.send(
    new HeadObjectCommand({
      Bucket: config.bucket,
      Key: key,
    })
  )
}

export function assertAvatarKeyForUser(key: string, userId: string) {
  if (!key.startsWith(`avatars/${userId}/`)) {
    throw new Error("Avatar key does not belong to this account.")
  }
}

export function getAvatarImagePath(key: string) {
  return `/api/account/avatar/image?key=${encodeURIComponent(key)}`
}

async function ensureBucket(config: StorageConfig) {
  if (bucketReady) {
    return
  }

  const client = createS3Client(config)

  try {
    await client.send(new HeadBucketCommand({ Bucket: config.bucket }))
    bucketReady = true
    return
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: config.bucket }))
    bucketReady = true
  }
}

function getStorageConfig(): StorageConfig {
  const endpoint = process.env.S3_ENDPOINT
  const publicEndpoint = process.env.S3_PUBLIC_ENDPOINT || endpoint
  const bucket = process.env.S3_BUCKET || "oworker-saas"
  const accessKeyId = process.env.S3_ACCESS_KEY_ID
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY

  if (!endpoint || !publicEndpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "S3_ENDPOINT, S3_PUBLIC_ENDPOINT, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY are required for avatar uploads."
    )
  }

  return {
    endpoint,
    publicEndpoint,
    bucket,
    accessKeyId,
    secretAccessKey,
    region: process.env.S3_REGION || "us-east-1",
  }
}

function createS3Client(config: StorageConfig) {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
}

function safeFileName(fileName: string, extension: string) {
  const base =
    fileName
      .trim()
      .toLowerCase()
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "avatar"

  return `${base}.${extension}`
}

function normalizeContentType(value: string) {
  return value.split(";")[0].trim().toLowerCase()
}

type StorageConfig = {
  endpoint: string
  publicEndpoint: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  region: string
}
