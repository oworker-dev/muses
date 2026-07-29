import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { createHash } from "node:crypto"

import { recordGeneratedImageAsset } from "@/lib/generated-asset-store"

let bucketReady = false

export async function storeGeneratedImage(input: {
  workspaceId: string
  projectId: string
  runId: string
  nodeId: string
  stepId: string
  index: number
  bytes: Uint8Array
  mimeType: "image/png" | "image/jpeg" | "image/webp"
  width: number
  height: number
  prompt: string
  provider: string
  modelRef: string
  createdAt: string
}) {
  const config = getStorageConfig()
  await ensureBucket(config)

  const extension = mimeExtension(input.mimeType)
  const stableIdentity = [
    input.workspaceId,
    input.projectId,
    input.runId,
    input.nodeId,
    input.stepId,
    input.index,
  ].join(":")
  const assetId = `image_${createHash("sha256")
    .update(stableIdentity)
    .digest("hex")
    .slice(0, 24)}`
  const key = `generated/${input.workspaceId}/${input.runId}/${assetId}.${extension}`
  const internalClient = createS3Client(config.endpoint, config)

  await internalClient.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: input.bytes,
      ContentType: input.mimeType,
      CacheControl: "private, max-age=31536000, immutable",
      Metadata: {
        workspace: input.workspaceId,
        project: input.projectId,
        run: input.runId,
        node: input.nodeId,
        asset: assetId,
      },
    })
  )

  await recordGeneratedImageAsset({
    id: assetId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    workflowRunId: input.runId,
    nodeId: input.nodeId,
    stepId: input.stepId,
    assetIndex: input.index,
    objectKey: key,
    mimeType: input.mimeType,
    byteSize: input.bytes.byteLength.toString(),
    width: input.width,
    height: input.height,
    prompt: input.prompt,
    provider: input.provider,
    modelRef: input.modelRef,
    createdAt: input.createdAt,
  })

  const publicClient = createS3Client(config.publicEndpoint, config)
  const url = await getSignedUrl(
    publicClient,
    new GetObjectCommand({ Bucket: config.bucket, Key: key }),
    { expiresIn: 7 * 24 * 60 * 60 }
  )

  return { assetId, key, url }
}

export async function readGeneratedImage(input: {
  objectKey: string
  mimeType: "image/png" | "image/jpeg" | "image/webp"
}) {
  const config = getStorageConfig()
  const object = await createS3Client(config.endpoint, config).send(
    new GetObjectCommand({ Bucket: config.bucket, Key: input.objectKey })
  )
  if (!object.Body) {
    throw new Error("Generated image object has no body.")
  }
  return {
    bytes: await object.Body.transformToByteArray(),
    contentType: object.ContentType || input.mimeType,
  }
}

function getStorageConfig() {
  const endpoint = process.env.S3_ENDPOINT
  const publicEndpoint = process.env.S3_PUBLIC_ENDPOINT || endpoint
  const accessKeyId = process.env.S3_ACCESS_KEY_ID
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY
  if (!endpoint || !publicEndpoint || !accessKeyId || !secretAccessKey) {
    throw new Error("Generated image storage is not configured.")
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

async function ensureBucket(config: ReturnType<typeof getStorageConfig>) {
  if (bucketReady) return
  const client = createS3Client(config.endpoint, config)
  try {
    await client.send(new HeadBucketCommand({ Bucket: config.bucket }))
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: config.bucket }))
  }
  bucketReady = true
}

function createS3Client(
  endpoint: string,
  config: ReturnType<typeof getStorageConfig>
) {
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

function mimeExtension(mimeType: "image/png" | "image/jpeg" | "image/webp") {
  if (mimeType === "image/jpeg") return "jpg"
  if (mimeType === "image/webp") return "webp"
  return "png"
}
