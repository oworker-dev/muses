import { handleAgentProviderResponsesRequest } from "@/lib/agent-provider-broker"
import { resolveProviderRuntimeConnection } from "@/lib/provider-connections"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(request: Request) {
  return handleAgentProviderResponsesRequest(request, {
    resolveConnection: resolveProviderRuntimeConnection,
  })
}
