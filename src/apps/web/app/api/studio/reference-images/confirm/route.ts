import {
  confirmReferenceImage,
  ReferenceImageRequestError,
  ReferenceImageValidationError,
} from "@/lib/reference-image-storage"
import { requireStudioApiAccess } from "@/lib/studio-access"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const workspaceId = readString(body, "workspaceId")
  const assetId = readString(body, "assetId")
  const access = await requireStudioApiAccess(workspaceId || undefined)
  if (!access.ok) return access.response
  if (!workspaceId || !assetId) {
    return Response.json(
      {
        error: "reference-image-confirm-invalid",
        message: "workspaceId and assetId are required.",
      },
      { status: 400 }
    )
  }
  try {
    return Response.json({
      asset: await confirmReferenceImage({ workspaceId, assetId }),
    })
  } catch (error) {
    const requestError = error instanceof ReferenceImageRequestError
    const validationError = error instanceof ReferenceImageValidationError
    const retryable = !requestError && !validationError
    return Response.json(
      {
        error: retryable
          ? "reference-image-confirm-retryable"
          : "reference-image-confirm-failed",
        message: retryable
          ? "Reference image confirmation is temporarily unavailable. Retry confirmation."
          : error instanceof Error
            ? error.message
            : "Reference image could not be confirmed.",
        retryable,
      },
      {
        status: retryable ? 503 : validationError ? 422 : 400,
        headers: retryable ? { "retry-after": "2" } : undefined,
      }
    )
  }
}

function readString(body: unknown, key: string) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return ""
  const value = (body as Record<string, unknown>)[key]
  return typeof value === "string" ? value.trim() : ""
}
