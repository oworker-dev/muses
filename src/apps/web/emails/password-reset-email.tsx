export function PasswordResetEmail({
  userName,
  url,
}: {
  userName?: string | null
  url: string
}) {
  const greeting = userName ? `Hi ${userName},` : "Hi,"

  return (
    <html>
      <body style={body}>
        <div style={preview}>Reset your password to continue.</div>
        <main style={container}>
          <h1 style={heading}>Reset your password</h1>
          <p style={paragraph}>{greeting}</p>
          <p style={paragraph}>
            Use this secure link to set a new password for your SaaS account.
          </p>
          <div style={action}>
            <a href={url} style={button}>
              Reset password
            </a>
          </div>
          <p style={muted}>
            If you did not request a password reset, you can ignore this email.
          </p>
        </main>
      </body>
    </html>
  )
}

export function getPasswordResetEmailText({
  userName,
  url,
}: {
  userName?: string | null
  url: string
}) {
  const greeting = userName ? `Hi ${userName},` : "Hi,"

  return [
    greeting,
    "",
    "Use this secure link to set a new password for your SaaS account.",
    "",
    url,
    "",
    "If you did not request a password reset, you can ignore this email.",
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
