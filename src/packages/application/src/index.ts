export type HealthSummary = {
  status: "ok";
  service: string;
  interfaces: string[];
};

export function readHealthSummary(service = "oworker.saas"): HealthSummary {
  return {
    status: "ok",
    service,
    interfaces: ["openapi", "mcp", "skills"]
  };
}
