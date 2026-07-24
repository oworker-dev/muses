import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { z } from "zod/v4"

import serviceMap from "../../../../../interfaces/service-map/saas.service-map.json"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type Capability = (typeof serviceMap.capabilities)[number]
type JsonSchema = {
  type?: string | readonly string[]
  enum?: readonly unknown[]
  properties?: Record<string, JsonSchema>
  required?: readonly string[]
  items?: JsonSchema
  additionalProperties?: boolean | JsonSchema
  description?: string
}

const rpcError = (code: number, message: string, status: number) =>
  Response.json(
    {
      jsonrpc: "2.0",
      error: { code, message },
      id: null,
    },
    { status, headers: corsHeaders() },
  )

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() })
}

export async function GET(request: Request) {
  return handleMcp(request)
}

export async function POST(request: Request) {
  return handleMcp(request)
}

export async function DELETE(request: Request) {
  return handleMcp(request)
}

async function handleMcp(request: Request) {
  const originError = validateOrigin(request)
  if (originError) {
    return originError
  }

  const server = createMcpServer(request)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })

  try {
    await server.connect(transport)
    const response = await transport.handleRequest(request)
    return withCors(response)
  } catch (error) {
    return rpcError(-32603, error instanceof Error ? error.message : "Internal MCP server error.", 500)
  } finally {
    await transport.close().catch(() => undefined)
    await server.close().catch(() => undefined)
  }
}

function createMcpServer(request: Request) {
  const server = new McpServer(
    {
      name: "oworker-saas-starter",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {
          listChanged: false,
        },
      },
      instructions:
        "Tools are generated from the ANSS service-map and forward to the same Hono service boundary used by API and CLI clients.",
    },
  )

  for (const capability of serviceMap.capabilities.filter((item) => item.mcp?.tool)) {
    server.registerTool(
      capability.mcp.tool,
      {
        title: capability.id,
        description: buildToolDescription(capability),
        inputSchema: jsonSchemaToZod(capability.inputSchema),
        outputSchema: jsonSchemaToZod(capability.outputSchema),
        annotations: {
          readOnlyHint: !capability.safety.writes,
          destructiveHint: capability.safety.writes,
          idempotentHint: capability.http.method === "GET",
          openWorldHint: false,
        },
        _meta: {
          "anss/capabilityId": capability.id,
          "anss/http": capability.http,
          "anss/human": capability.human,
          "anss/safety": capability.safety,
        },
      },
      async (args) => {
        const result = await callCapability(capability, args, request.headers.get("authorization"))
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
          structuredContent: normalizeStructuredContent(result),
        }
      },
    )
  }

  return server
}

async function callCapability(capability: Capability, args: unknown, authorization: string | null) {
  const apiBaseUrl = (
    process.env.SAAS_API_BASE_URL ||
    process.env.API_BASE_URL ||
    process.env.API_PUBLIC_URL ||
    "http://localhost:3001"
  ).replace(/\/+$/, "")
  const headers: Record<string, string> = {
    accept: "application/json",
    "user-agent": "oworker-saas-remote-mcp/0.1",
  }
  if (authorization) {
    headers.authorization = authorization
  } else if (process.env.SAAS_API_TOKEN) {
    headers.authorization = `Bearer ${process.env.SAAS_API_TOKEN}`
  }

  const init: RequestInit = {
    method: capability.http.method,
    headers,
  }
  if (capability.http.method !== "GET") {
    headers["content-type"] = "application/json"
    init.body = JSON.stringify(isRecord(args) ? args : {})
  }

  const response = await fetch(`${apiBaseUrl}${capability.http.path}`, init)
  const text = await response.text()
  if (!response.ok) {
    throw new Error(text || `Capability ${capability.id} returned ${response.status}.`)
  }
  return text ? JSON.parse(text) : {}
}

function buildToolDescription(capability: Capability) {
  return [
    capability.summary,
    `Capability: ${capability.id}.`,
    `HTTP: ${capability.http.method} ${capability.http.path}.`,
    `Access: ${capability.safety.access}.`,
    capability.safety.requiresUserConfirmation
      ? "Requires user confirmation before execution."
      : "Does not require user confirmation.",
  ].join(" ")
}

function validateOrigin(request: Request) {
  const origin = request.headers.get("origin")
  if (!origin) {
    return null
  }
  const allowed = new Set(
    [
      new URL(request.url).origin,
      process.env.APP_URL,
      process.env.BETTER_AUTH_URL,
      ...(process.env.BETTER_AUTH_TRUSTED_ORIGINS || "").split(","),
    ]
      .map((value) => value?.trim())
      .filter(Boolean),
  )

  return allowed.has(origin) ? null : rpcError(-32000, "MCP origin is not allowed.", 403)
}

function withCors(response: Response) {
  const headers = new Headers(response.headers)
  for (const [key, value] of corsHeaders()) {
    headers.set(key, value)
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function corsHeaders() {
  return new Headers({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization, mcp-protocol-version, mcp-session-id",
    "Access-Control-Expose-Headers": "mcp-session-id",
  })
}

function normalizeStructuredContent(value: unknown) {
  if (isRecord(value)) {
    return value
  }
  return { result: value }
}

function jsonSchemaToZod(schemaValue?: unknown): z.ZodTypeAny {
  const schema = schemaValue as JsonSchema | undefined
  if (!schema) {
    return z.unknown()
  }
  const types = Array.isArray(schema.type) ? schema.type : [schema.type]
  const nullable = types.includes("null")
  const primaryType = types.find((type) => type && type !== "null")

  let result: z.ZodTypeAny
  if (schema.enum && schema.enum.length > 0 && schema.enum.every((item) => typeof item === "string")) {
    result = z.enum(schema.enum as [string, ...string[]])
  } else if (primaryType === "object") {
    const required = new Set(schema.required || [])
    const shape: Record<string, z.ZodTypeAny> = {}
    for (const [key, propertySchema] of Object.entries(schema.properties || {})) {
      const value = jsonSchemaToZod(propertySchema)
      shape[key] = required.has(key) ? value : value.optional()
    }
    const object = z.object(shape)
    result = schema.additionalProperties === false ? object : object.passthrough()
  } else if (primaryType === "array") {
    result = z.array(jsonSchemaToZod(schema.items))
  } else if (primaryType === "integer") {
    result = z.number().int()
  } else if (primaryType === "number") {
    result = z.number()
  } else if (primaryType === "boolean") {
    result = z.boolean()
  } else if (primaryType === "string") {
    result = z.string()
  } else {
    result = z.unknown()
  }

  return nullable ? result.nullable() : result
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
