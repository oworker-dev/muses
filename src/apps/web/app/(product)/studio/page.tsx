import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { MusesStudio } from "@/components/studio/muses-studio"
import { getServerSession } from "@/lib/auth"
import {
  ensurePersonalStudioWorkspace,
  serializeStudioContext,
} from "@/lib/studio-access"
import { getStudioModelCatalog } from "@/lib/model-catalog"

export const metadata: Metadata = {
  title: "Muses Studio Alpha",
  description:
    "Workflow-native AI creation space for Muses Platform Core Alpha.",
}

export const dynamic = "force-dynamic"

export default async function StudioPage() {
  const session = await getServerSession()
  if (!session) {
    redirect("/login?callbackURL=/studio")
  }
  if (!session.user.emailVerified) {
    redirect(
      `/verify-email?email=${encodeURIComponent(session.user.email)}&callbackURL=/studio`
    )
  }

  const context = serializeStudioContext(
    await ensurePersonalStudioWorkspace(session.user)
  )
  const modelCatalog = await getStudioModelCatalog(context.workspace.id)
  return (
    <MusesStudio
      initialContext={context}
      initialModelCatalog={modelCatalog}
      user={{ name: session.user.name, email: session.user.email }}
    />
  )
}
