"use server"

import { revalidatePath } from "next/cache"

import { requireSiteAdmin } from "@/lib/admin"
import {
  ProviderConnectionError,
  checkProviderConnectionHealth,
  createProviderConnection,
  rotateProviderCredential,
  setProviderConnectionOfferings,
  setProviderConnectionStatus,
} from "@/lib/provider-connections"

export type ProviderActionState = {
  status: "idle" | "success" | "error"
  code?: string
}

export const INITIAL_PROVIDER_ACTION_STATE: ProviderActionState = {
  status: "idle",
}

export async function createProviderConnectionAction(
  _previous: ProviderActionState,
  formData: FormData
): Promise<ProviderActionState> {
  const session = await requireSiteAdmin()
  try {
    await createProviderConnection({
      providerId: requiredString(formData, "providerId"),
      name: requiredString(formData, "name"),
      baseUrl: optionalString(formData, "baseUrl"),
      credential: requiredString(formData, "credential"),
      capabilities: strings(formData, "capabilities"),
      modelAllowlist: [optionalString(formData, "modelAllowlist") || ""],
      offeringIds: strings(formData, "offeringIds"),
      actorUserId: session.user.id,
      actorEmail: session.user.email,
    })
    revalidateControlPlane()
    return { status: "success", code: "created" }
  } catch (error) {
    return actionFailure(error)
  }
}

export async function rotateProviderCredentialAction(
  _previous: ProviderActionState,
  formData: FormData
): Promise<ProviderActionState> {
  const session = await requireSiteAdmin()
  try {
    await rotateProviderCredential({
      connectionId: requiredString(formData, "connectionId"),
      credential: requiredString(formData, "credential"),
      actorUserId: session.user.id,
      actorEmail: session.user.email,
    })
    revalidateControlPlane()
    return { status: "success", code: "rotated" }
  } catch (error) {
    return actionFailure(error)
  }
}

export async function updateProviderConnectionStatusAction(
  _previous: ProviderActionState,
  formData: FormData
): Promise<ProviderActionState> {
  const session = await requireSiteAdmin()
  try {
    const status = requiredString(formData, "status")
    if (status !== "active" && status !== "disabled") {
      return { status: "error", code: "invalid-input" }
    }
    await setProviderConnectionStatus({
      connectionId: requiredString(formData, "connectionId"),
      status,
      actorUserId: session.user.id,
      actorEmail: session.user.email,
    })
    revalidateControlPlane()
    return { status: "success", code: "status-updated" }
  } catch (error) {
    return actionFailure(error)
  }
}

export async function updateProviderConnectionOfferingsAction(
  _previous: ProviderActionState,
  formData: FormData
): Promise<ProviderActionState> {
  const session = await requireSiteAdmin()
  try {
    await setProviderConnectionOfferings({
      connectionId: requiredString(formData, "connectionId"),
      offeringIds: strings(formData, "offeringIds"),
      actorUserId: session.user.id,
      actorEmail: session.user.email,
    })
    revalidateControlPlane()
    return { status: "success", code: "bindings-updated" }
  } catch (error) {
    return actionFailure(error)
  }
}

export async function checkProviderConnectionHealthAction(
  _previous: ProviderActionState,
  formData: FormData
): Promise<ProviderActionState> {
  const session = await requireSiteAdmin()
  try {
    await checkProviderConnectionHealth({
      connectionId: requiredString(formData, "connectionId"),
      actorUserId: session.user.id,
      actorEmail: session.user.email,
    })
    revalidateControlPlane()
    return { status: "success", code: "health-checked" }
  } catch (error) {
    return actionFailure(error)
  }
}

function requiredString(formData: FormData, name: string) {
  const value = optionalString(formData, name)
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

function optionalString(formData: FormData, name: string) {
  const value = formData.get(name)
  return typeof value === "string" ? value.trim() : undefined
}

function strings(formData: FormData, name: string) {
  return formData
    .getAll(name)
    .filter((value): value is string => typeof value === "string")
}

function actionFailure(error: unknown): ProviderActionState {
  if (error instanceof ProviderConnectionError) {
    return { status: "error", code: error.code }
  }
  if (
    error instanceof Error &&
    /MUSES_CREDENTIAL_MASTER_KEY/.test(error.message)
  ) {
    return { status: "error", code: "vault-not-configured" }
  }
  return { status: "error", code: "operation-failed" }
}

function revalidateControlPlane() {
  revalidatePath("/admin/providers")
  revalidatePath("/admin/models")
  revalidatePath("/studio")
}
