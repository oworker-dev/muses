export type OAuthProvider = "github" | "google"

export function getEnabledOAuthProviders(): OAuthProvider[] {
  const providers: OAuthProvider[] = []

  if (
    process.env.GITHUB_AUTH_ENABLED === "true" &&
    process.env.GITHUB_CLIENT_ID &&
    process.env.GITHUB_CLIENT_SECRET
  ) {
    providers.push("github")
  }

  if (
    process.env.GOOGLE_AUTH_ENABLED === "true" &&
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET
  ) {
    providers.push("google")
  }

  return providers
}
