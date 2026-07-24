export function EmailChangeConfirmationEmail({
  userName,
  newEmail,
  url,
}: {
  userName?: string | null
  newEmail: string
  url: string
}) {
  const greeting = userName ? `Hi ${userName},` : "Hi,"

  return (
    <html>
      <body style={body}>
        <div style={preview}>Confirm your email change.</div>
        <main style={container}>
          <h1 style={heading}>Confirm email change</h1>
          <p style={paragraph}>{greeting}</p>
          <p style={paragraph}>
            Confirm that you want to change your SaaS account email address to{" "}
            <strong>{newEmail}</strong>.
          </p>
          <div style={action}>
            <a href={url} style={button}>
              Confirm change
            </a>
          </div>
          <p style={muted}>
            If you did not request this change, keep your current password private and ignore this
            email.
          </p>
        </main>
      </body>
    </html>
  )
}

export function getEmailChangeConfirmationText({
  userName,
  newEmail,
  url,
}: {
  userName?: string | null
  newEmail: string
  url: string
}) {
  const greeting = userName ? `Hi ${userName},` : "Hi,"

  return [
    greeting,
    "",
    `Confirm that you want to change your SaaS account email address to ${newEmail}.`,
    "",
    url,
    "",
    "If you did not request this change, keep your current password private and ignore this email.",
  ].join("\n")
}

const body = {
  margin: 0,
  backgroundColor: "#f6f7f9",
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif',
}

const preview = {
  display: "none",
  overflow: "hidden",
  lineHeight: "1px",
  opacity: 0,
  maxHeight: 0,
  maxWidth: 0,
}

const container = {
  margin: "0 auto",
  padding: "32px 24px",
  maxWidth: "560px",
  backgroundColor: "#ffffff",
  color: "#111827",
}

const heading = {
  margin: "0 0 20px",
  fontSize: "24px",
  lineHeight: "32px",
  fontWeight: 600,
}

const paragraph = {
  margin: "0 0 16px",
  fontSize: "15px",
  lineHeight: "24px",
}

const action = {
  margin: "24px 0",
}

const button = {
  borderRadius: "6px",
  backgroundColor: "#111827",
  color: "#ffffff",
  fontSize: "14px",
  fontWeight: 600,
  padding: "10px 14px",
  textDecoration: "none",
}

const muted = {
  margin: "24px 0 0",
  color: "#6b7280",
  fontSize: "13px",
  lineHeight: "20px",
}
