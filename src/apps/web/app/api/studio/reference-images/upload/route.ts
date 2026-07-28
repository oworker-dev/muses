import {
  createReferenceImageUpload,
  referenceImageMaxBytes,
} from "@/lib/reference-image-storage"
import { requireStudioApiAccess } from "@/lib/studio-access"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const workspaceId = readString(body, "workspaceId")
  const access = await requireStudioApiAccess(workspaceId || undefined)
  if (!access.ok) return access.response
  const fileName = readString(body, "fileName")
  const contentType = readString(body, "contentType")
  const size = readNumber(body, "size")
  if (!workspaceId || !fileName || !contentType || size === null) {
    return Response.json(
      {
        error: "reference-image-upload-invalid",
        message: "workspaceId, fileName, contentType and size are required.",
      },
      { status: 400 }
    )
  }
  if (size > referenceImageMaxBytes) {
    return Response.json(
      {
        error: "reference-image-too-large",
        message: "Reference image must be 50 MB or smaller.",
      },
      { status: 400 }
    )
  }
  try {
    return Response.json(
      {
        upload: await createReferenceImageUpload({
          workspaceId,
          userId: access.user.id,
          fileName,
          contentType,
          size,
        }),
      },
      { status: 201 }
    )
  } catch (error) {
    return Response.json(
      {
        error: "reference-image-upload-unavailable",
        message:
          error instanceof Error
            ? error.message
            : "Reference image upload is unavailable.",
      },
      { status: 400 }
    )
  }
}

function readString(body: unknown, key: string) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return ""
  const value = (body as Record<string, unknown>)[key]
  return typeof value === "string" ? value.trim() : ""
}

function readNumber(body: unknown, key: string) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null
  const value = (body as Record<string, unknown>)[key]
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null
}
