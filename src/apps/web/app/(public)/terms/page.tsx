import { ContentSection, PublicContentShell } from "@/components/public-content-shell"

export default function TermsPage() {
  return (
    <PublicContentShell
      title="Terms"
      description="A neutral terms template for the account, subscription, acceptable-use, and service-boundary sections most SaaS products need before accepting real users."
    >
      <ContentSection title="Account responsibility">
        <p>Define who may create an account, how credentials must be protected, and what happens when account information changes.</p>
      </ContentSection>
      <ContentSection title="Subscriptions and payments">
        <p>Describe plans, renewals, billing portal access, failed payment handling, cancellation, refunds, and tax treatment only when those policies are final.</p>
      </ContentSection>
      <ContentSection title="Acceptable use">
        <p>State the behavior your service does not allow, including abuse, unlawful content, security probing, spam, and activity that disrupts other users.</p>
      </ContentSection>
      <ContentSection title="Availability and changes">
        <p>Explain how the service may change, pause, or terminate. Avoid operational promises that are not backed by the operating model.</p>
      </ContentSection>
      <ContentSection title="Legal review">
        <p>Add governing law, dispute process, warranty limits, and liability language only after product-specific legal review.</p>
      </ContentSection>
    </PublicContentShell>
  )
}
