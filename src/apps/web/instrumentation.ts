export async function register() {
  if (process.env.NEXT_RUNTIME !== "edge") {
    const { registerOTel } = await import("@vercel/otel")
    registerOTel({
      serviceName: "muses-web",
      instrumentationConfig: {
        fetch: {
          propagateContextUrls: agentOrigins(),
        },
      },
    })
    const { getWorld } = await import("workflow/runtime")
    await getWorld().start?.()
  }
}

function agentOrigins() {
  return [...new Set([
    process.env.MUSES_AGENT_SERVICE_URL,
    process.env.MUSES_AGENT_PUBLIC_URL,
  ].flatMap((value) => {
    if (!value?.trim()) return []
    try {
      return [new URL(value).origin]
    } catch {
      return []
    }
  }))]
}
