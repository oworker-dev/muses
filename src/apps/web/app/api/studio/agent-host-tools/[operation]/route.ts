import {
  GET as listCapabilities,
  POST as invokeCapability,
} from "../route"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type RouteContext = {
  readonly params: Promise<{ readonly operation: string }>
}

export async function GET(request: Request, context: RouteContext) {
  if ((await context.params).operation !== "capabilities") {
    return Response.json(
      { error: "host-capability-route-not-found", message: "Host capability route not found." },
      { status: 404 },
    )
  }
  return listCapabilities(request)
}

export async function POST(request: Request, context: RouteContext) {
  if ((await context.params).operation !== "invoke") {
    return Response.json(
      { error: "host-capability-route-not-found", message: "Host capability route not found." },
      { status: 404 },
    )
  }
  return invokeCapability(request)
}
