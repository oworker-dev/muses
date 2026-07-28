import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { withWorkflow } from "workflow/next"

const appDir = dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  transpilePackages: ["@muses/domain"],
  turbopack: {
    root: join(appDir, "../../.."),
  },
  async headers() {
    return [
      {
        source: "/",
        headers: [
          {
            key: "Link",
            value:
              '</agent-guide.md>; rel="agent-service-guide"; type="text/markdown", </.well-known/anss.json>; rel="service-manifest"; type="application/json", </anss/saas.service-map.yaml>; rel="service-map"; type="text/yaml", </anss/install/index.json>; rel="adapter-install"; type="application/json", </mcp>; rel="mcp"; type="application/json", </llms.txt>; rel="llms"; type="text/plain"',
          },
        ],
      },
      {
        source: "/:path*",
        headers: [
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
        ],
      },
    ]
  },
  async rewrites() {
    return [
      {
        source: "/.well-known/anss.json",
        destination: "/api/anss/manifest",
      },
    ]
  },
}

export default withWorkflow(nextConfig)
