import { ContentSection, PublicContentShell } from "@/components/public-content-shell"

export default function PrivacyPage() {
  return (
    <PublicContentShell
      title="Privacy"
      description="A production project should replace this template with reviewed privacy text that matches its data collection, retention, vendors, and user-rights process."
    >
      <ContentSection title="Data categories">
        <p>Describe account data, authentication data, billing records, support messages, analytics events, and any uploaded files your product actually collects.</p>
      </ContentSection>
      <ContentSection title="Use of data">
        <p>Explain how data supports account access, security, payments, support, service operation, abuse prevention, and product analytics.</p>
      </ContentSection>
      <ContentSection title="Cookies and analytics">
        <p>Document session cookies, authentication cookies, and any analytics or telemetry behavior. Keep this aligned with the providers enabled in the deployed project.</p>
      </ContentSection>
      <ContentSection title="Retention and rights">
        <p>Define retention periods, deletion paths, export requests, correction requests, and contact channels. Add jurisdiction-specific language only after review.</p>
      </ContentSection>
      <ContentSection title="Last updated">
        <p>Replace this template date before launch and keep updates traceable as the production service changes.</p>
      </ContentSection>
    </PublicContentShell>
  )
}
