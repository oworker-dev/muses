import { redirect } from "next/navigation"
import { createTranslator } from "next-intl"

import { AuthCard } from "@/components/auth-card"
import { AuthForm } from "@/components/auth-form"
import { getMessages } from "@/i18n/messages"
import { getRequestLocale } from "@/i18n/server"
import { getServerSession } from "@/lib/auth"
import { getEnabledOAuthProviders } from "@/lib/oauth"
import { normalizeInternalPath } from "@/lib/urls"

export const dynamic = "force-dynamic"

export default async function RegisterPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const [session, locale] = await Promise.all([
    getServerSession(),
    getRequestLocale(),
  ])
  const oauthProviders = getEnabledOAuthProviders()
  const params = await searchParams
  const callbackURL = normalizeInternalPath(
    typeof params?.callbackURL === "string" ? params.callbackURL : null,
    "/"
  )

  if (session) {
    redirect(callbackURL)
  }

  const t = createTranslator({
    locale,
    messages: getMessages(locale),
    namespace: "Auth",
  })

  return (
    <AuthCard title={t("registerTitle")} description={t("registerDescription")}>
      <AuthForm
        mode="register"
        oauthProviders={oauthProviders}
        callbackURL={callbackURL}
        copy={{
          nameLabel: t("nameLabel"),
          emailLabel: t("emailLabel"),
          passwordLabel: t("passwordLabel"),
          forgotPassword: t("forgotPassword"),
          createAccount: t("createAccount"),
          signIn: t("signIn"),
          alreadyHaveAccount: t("alreadyHaveAccount"),
          needAccount: t("needAccount"),
          register: t("register"),
          authFailed: t("authFailed"),
          couldNotSendVerification: t("couldNotSendVerification"),
          verificationNotSent: t("verificationNotSent"),
          accountCreatedBut: t("accountCreatedBut"),
          oauthGithub: t("oauthGithub"),
          oauthGoogle: t("oauthGoogle"),
          oauthDivider: t("oauthDivider"),
        }}
      />
    </AuthCard>
  )
}
