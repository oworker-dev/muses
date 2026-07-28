"use server"

import { revalidatePath } from "next/cache"

import { requireSiteAdmin } from "@/lib/admin"
import { setModelOfferingEnabled } from "@/lib/model-catalog"

export async function updateModelOfferingAvailability(formData: FormData) {
  const offeringId = formData.get("offeringId")
  const enabled = formData.get("enabled")
  if (typeof offeringId !== "string" || !offeringId) {
    throw new Error("A model offering id is required.")
  }
  if (enabled !== "true" && enabled !== "false") {
    throw new Error("A model offering availability state is required.")
  }
  const session = await requireSiteAdmin()
  await setModelOfferingEnabled({
    offeringId,
    enabled: enabled === "true",
    actorUserId: session.user.id,
    actorEmail: session.user.email,
  })
  revalidatePath("/admin/models")
  revalidatePath("/studio")
}
