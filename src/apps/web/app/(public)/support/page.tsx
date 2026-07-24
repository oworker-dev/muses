import { ContentSection, PublicContentShell } from "@/components/public-content-shell"

export default function SupportPage() {
  return (
    <PublicContentShell
      title="Support"
      description="A neutral support surface for account, billing, data, and service status questions. Replace the channel details with your production support process before launch."
    >
      <ContentSection title="Contact channels">
        <p>Use this section for your support email, help desk, chat, or ticketing entry. The starter does not assume a provider or response-time commitment.</p>
      </ContentSection>
      <ContentSection title="Account and billing">
        <p>Point users to sign-in, account settings, subscription records, invoices, and payment support. Keep operational account help separate from product-specific onboarding.</p>
      </ContentSection>
      <ContentSection title="Data requests">
        <p>Reserve a clear path for privacy, export, correction, and deletion requests. Final wording should match the production privacy policy and applicable legal review.</p>
      </ContentSection>
      <ContentSection title="Service status">
        <p>Link to a public status page or notice if your product publishes incident updates. Do not promise response times unless the runtime and operating model support them.</p>
      </ContentSection>
    </PublicContentShell>
  )
}
