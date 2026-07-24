export const service = {
  id: "oworker.saas-starter",
  name: "OWorker SaaS Starter",
  canonicalServiceRoot: "/",
  programmableServiceBoundary: {
    type: "hono",
    localBaseUrl: "http://localhost:3001"
  }
};

export const discovery = {
  agentServiceGuide: "/agent-guide.md",
  manifest: "/.well-known/anss.json",
  llms: "/llms.txt",
  serviceMap: "/anss/saas.service-map.yaml",
  installIndex: "/anss/install/index.json"
};

export const adapters = {
  openapi: {
    sourcePath: "interfaces/openapi/saas.openapi.yaml",
    publicPath: "/anss/openapi/saas.openapi.yaml"
  },
  aclip: {
    sourcePath: "interfaces/aclip/saas.md"
  },
  mcp: {
    sourcePath: "interfaces/mcp/saas.md"
  },
  skills: {
    sourcePath: "interfaces/skills/"
  }
};

export const securityBoundary = {
  scope: "metadata-only",
  adapterCallsUseSameServiceBoundary: true,
  credentialModel: "service-defined",
  userAgentIsAuthorization: false,
  anssDoesNotImplement: [
    "authentication",
    "authorization",
    "confirmation-ui",
    "audit-log-storage",
    "agent-runtime",
    "third-party-registry"
  ],
  note:
    "ANSS declares safety metadata and adapter entrypoints. The product service remains responsible for authentication, authorization, confirmation, and audit behavior."
};

const emptyInputSchema = objectSchema({}, [], false);
const genericErrorSchema = objectSchema(
  {
    status: enumSchema(["error"]),
    detail: stringSchema("Human-readable error detail.")
  },
  ["status", "detail"],
  true
);
const integrationStatusSchema = objectSchema(
  {
    provider: stringSchema("Integration provider identifier."),
    status: enumSchema(["ok", "degraded", "error", "not_configured"]),
    detail: stringSchema("Operational status detail.")
  },
  ["provider", "status", "detail"],
  false
);
const integrationsSchema = objectSchema(
  {
    database: integrationStatusSchema,
    cache: integrationStatusSchema,
    queue: integrationStatusSchema,
    storage: integrationStatusSchema,
    email: integrationStatusSchema,
    billing: integrationStatusSchema,
    observability: integrationStatusSchema
  },
  ["database", "cache", "queue", "storage", "email", "billing", "observability"],
  false
);
const healthOutputSchema = objectSchema(
  {
    status: enumSchema(["ok", "degraded"]),
    service: stringSchema("Runtime service id."),
    runtime: stringSchema("Runtime implementation."),
    startedAt: stringSchema("Service start timestamp."),
    uptimeSeconds: integerSchema("Service uptime in seconds.")
  },
  ["status", "service", "runtime"],
  false
);
const accountSchema = objectSchema(
  {
    id: stringSchema("Account id."),
    label: stringSchema("Display label.")
  },
  ["id", "label"],
  true
);
const subscriptionSchema = objectSchema(
  {
    plan: stringSchema("Plan id."),
    status: stringSchema("Subscription status."),
    monthlyAmountCents: integerSchema("Monthly amount in cents."),
    stripeCustomerId: nullableStringSchema("Stripe customer id."),
    stripeSubscriptionId: nullableStringSchema("Stripe subscription id."),
    stripePriceId: nullableStringSchema("Stripe price id."),
    currentPeriodEnd: nullableStringSchema("Current period end timestamp.")
  },
  ["plan", "status"],
  true
);
const accountSummaryOutputSchema = objectSchema(
  {
    account: accountSchema,
    subscription: nullableObjectSchema(subscriptionSchema, "Current subscription, when present.")
  },
  ["account", "subscription"],
  false
);
const billingPlansOutputSchema = objectSchema(
  {
    plans: arraySchema(
      objectSchema(
        {
          id: stringSchema("Plan id."),
          name: stringSchema("Plan name."),
          monthlyAmountCents: integerSchema("Monthly amount in cents."),
          benefits: arraySchema(stringSchema("Replaceable benefit label."))
        },
        ["id", "name", "monthlyAmountCents", "benefits"],
        false
      )
    ),
    provider: stringSchema("Billing provider."),
    status: stringSchema("Billing provider configuration status.")
  },
  ["plans", "provider", "status"],
  false
);
const billingStateOutputSchema = objectSchema(
  {
    provider: stringSchema("Billing provider."),
    account: accountSchema,
    subscription: nullableObjectSchema(subscriptionSchema, "Current subscription, when present.")
  },
  ["provider", "account", "subscription"],
  false
);
const checkoutInputSchema = objectSchema(
  {
    accountId: stringSchema("Account id for checkout."),
    email: stringSchema("Optional customer email.")
  },
  [],
  false
);
const checkoutOutputSchema = objectSchema(
  {
    provider: stringSchema("Billing provider."),
    url: stringSchema("Checkout redirect URL, when created."),
    accountId: stringSchema("Account id associated with checkout."),
    status: stringSchema("Provider status when checkout could not be created."),
    detail: stringSchema("Provider error detail.")
  },
  ["provider"],
  true
);
const presignedUploadInputSchema = objectSchema(
  {
    fileName: stringSchema("Original file name."),
    contentType: stringSchema("Upload content type.")
  },
  ["fileName"],
  false
);
const presignedUploadOutputSchema = objectSchema(
  {
    provider: stringSchema("Storage provider."),
    bucket: stringSchema("Storage bucket."),
    key: stringSchema("Object key."),
    method: enumSchema(["PUT"]),
    url: stringSchema("Presigned upload URL."),
    headers: objectSchema(
      {
        "content-type": stringSchema("Required content type header.")
      },
      ["content-type"],
      false
    ),
    expiresInSeconds: integerSchema("URL expiration in seconds.")
  },
  ["provider", "bucket", "key", "method", "url", "headers", "expiresInSeconds"],
  false
);
const authStatusOutputSchema = objectSchema(
  {
    schema: enumSchema(["anss.auth-status/0.1"]),
    service: stringSchema("Service id."),
    authenticated: booleanSchema("Whether the supplied credential is accepted."),
    mode: stringSchema("Authentication check mode."),
    principal: nullableObjectSchema(
      objectSchema(
        {
          type: stringSchema("Principal type."),
          id: stringSchema("Principal id.")
        },
        ["type", "id"],
        true
      ),
      "Authenticated principal, when present."
    ),
    instructions: objectSchema({}, [], true)
  },
  ["schema", "service", "authenticated", "mode", "principal", "instructions"],
  false
);
const capabilitiesOutputSchema = objectSchema(
  {
    schema: enumSchema(["anss.capabilities/0.1"]),
    service: stringSchema("Service id."),
    programmableServiceBoundary: stringSchema("Programmable service boundary type."),
    capabilities: arraySchema(objectSchema({}, [], true))
  },
  ["schema", "service", "programmableServiceBoundary", "capabilities"],
  false
);

export const capabilities = [
  defineCapability({
    id: "saas.health.read",
    summary: "Read service health.",
    safety: {
      access: "public-read",
      writes: false,
      requiresUserConfirmation: false
    },
    human: {
      path: "/admin/health",
      note: "Site-admin health UI requires site-admin access."
    },
    http: {
      method: "GET",
      path: "/health"
    },
    inputSchema: emptyInputSchema,
    outputSchema: healthOutputSchema,
    errorSchema: genericErrorSchema,
    aclip: {
      command: "saas health read --json",
      aliases: ["health"]
    },
    mcp: {
      tool: "saas.health.read"
    }
  }),
  defineCapability({
    id: "saas.integrations.read",
    summary: "Read configured integration defaults.",
    safety: {
      access: "public-read",
      writes: false,
      requiresUserConfirmation: false
    },
    human: {
      path: "/admin/diagnostics",
      note: "Site-admin diagnostics UI requires site-admin access."
    },
    http: {
      method: "GET",
      path: "/integrations/health"
    },
    inputSchema: emptyInputSchema,
    outputSchema: objectSchema(
      {
        status: enumSchema(["ok", "degraded"]),
        service: stringSchema("Runtime service id."),
        integrations: integrationsSchema
      },
      ["status", "service", "integrations"],
      false
    ),
    errorSchema: genericErrorSchema,
    aclip: {
      command: "saas integrations read --json",
      aliases: ["integrations"]
    },
    mcp: {
      tool: "saas.integrations.read"
    }
  }),
  defineCapability({
    id: "saas.auth.status.read",
    summary: "Read CLI/API authentication status.",
    safety: {
      access: "public-read",
      writes: false,
      requiresUserConfirmation: false
    },
    human: {
      path: "/login",
      note: "Human sign-in remains handled by the Web app."
    },
    http: {
      method: "GET",
      path: "/auth/status"
    },
    inputSchema: emptyInputSchema,
    outputSchema: authStatusOutputSchema,
    errorSchema: genericErrorSchema,
    aclip: {
      command: "saas auth status --json",
      aliases: ["auth status"]
    },
    mcp: {
      tool: "saas.auth.status.read"
    }
  }),
  defineCapability({
    id: "saas.account.summary.read",
    summary: "Read neutral account and subscription summary.",
    safety: {
      access: "demo-read",
      writes: false,
      requiresUserConfirmation: false
    },
    human: {
      path: "/account",
      note: "Account UI requires a signed-in user."
    },
    http: {
      method: "GET",
      path: "/account/summary"
    },
    inputSchema: emptyInputSchema,
    outputSchema: accountSummaryOutputSchema,
    errorSchema: genericErrorSchema,
    aclip: {
      command: "saas account summary read --json",
      aliases: ["account summary"]
    },
    mcp: {
      tool: "saas.account.summary.read"
    }
  }),
  defineCapability({
    id: "saas.billing.plans.read",
    summary: "Read billing plan metadata.",
    safety: {
      access: "public-read",
      writes: false,
      requiresUserConfirmation: false
    },
    human: {
      path: "/account/billing",
      note: "Account billing UI requires a signed-in user."
    },
    http: {
      method: "GET",
      path: "/billing/plans"
    },
    inputSchema: emptyInputSchema,
    outputSchema: billingPlansOutputSchema,
    errorSchema: genericErrorSchema,
    aclip: {
      command: "saas billing plans read --json",
      aliases: ["billing plans"]
    },
    mcp: {
      tool: "saas.billing.plans.read"
    }
  }),
  defineCapability({
    id: "saas.billing.state.read",
    summary: "Read current account billing state.",
    safety: {
      access: "demo-read",
      writes: false,
      requiresUserConfirmation: false
    },
    human: {
      path: "/account/billing",
      note: "Account billing UI requires a signed-in user."
    },
    http: {
      method: "GET",
      path: "/billing/state"
    },
    inputSchema: emptyInputSchema,
    outputSchema: billingStateOutputSchema,
    errorSchema: genericErrorSchema,
    aclip: {
      command: "saas billing state read --json",
      aliases: ["billing state"]
    },
    mcp: {
      tool: "saas.billing.state.read"
    }
  }),
  defineCapability({
    id: "saas.billing.checkout.create",
    summary: "Create a billing checkout redirect contract.",
    safety: {
      access: "authenticated-write",
      writes: true,
      requiresUserConfirmation: true
    },
    human: {
      path: "/pricing",
      note: "Human checkout starts from the Pricing UI."
    },
    http: {
      method: "POST",
      path: "/billing/checkout"
    },
    inputSchema: checkoutInputSchema,
    outputSchema: checkoutOutputSchema,
    errorSchema: genericErrorSchema,
    aclip: {
      command: "saas billing checkout create --body <json> --json",
      aliases: ["billing checkout"]
    },
    mcp: {
      tool: "saas.billing.checkout.create"
    }
  }),
  defineCapability({
    id: "saas.storage.presigned-upload.create",
    summary: "Create an S3-compatible presigned upload contract.",
    safety: {
      access: "authenticated-write",
      writes: true,
      requiresUserConfirmation: true
    },
    human: {
      path: "/account",
      note: "Avatar uploads start from the account UI."
    },
    http: {
      method: "POST",
      path: "/storage/presigned-upload"
    },
    inputSchema: presignedUploadInputSchema,
    outputSchema: presignedUploadOutputSchema,
    errorSchema: genericErrorSchema,
    aclip: {
      command: "saas storage presigned-upload create --body <json> --json",
      aliases: ["storage presigned-upload"]
    },
    mcp: {
      tool: "saas.storage.presignedUpload.create"
    }
  }),
  defineCapability({
    id: "saas.anss.capabilities.read",
    summary: "Read the Agent-readable service capability list.",
    safety: {
      access: "public-read",
      writes: false,
      requiresUserConfirmation: false
    },
    human: {
      path: "/agent-guide.md"
    },
    http: {
      method: "GET",
      path: "/anss/capabilities"
    },
    inputSchema: emptyInputSchema,
    outputSchema: capabilitiesOutputSchema,
    errorSchema: genericErrorSchema,
    aclip: {
      command: "saas anss capabilities read --json",
      aliases: ["capabilities", "anss capabilities"]
    },
    mcp: {
      tool: "saas.anss.capabilities.read"
    }
  })
];

export const serviceMap = {
  schema: "anss.service-map/0.1",
  generatedFrom: "src/apps/api/src/capabilities.mjs",
  service,
  discovery,
  adapters,
  securityBoundary,
  capabilities
};

export function defineCapability(capability) {
  return Object.freeze(capability);
}

function objectSchema(properties = {}, required = Object.keys(properties), additionalProperties = false) {
  return {
    type: "object",
    additionalProperties,
    required,
    properties
  };
}

function nullableObjectSchema(schema, description) {
  return {
    ...schema,
    type: ["object", "null"],
    description
  };
}

function stringSchema(description) {
  return {
    type: "string",
    description
  };
}

function nullableStringSchema(description) {
  return {
    type: ["string", "null"],
    description
  };
}

function integerSchema(description) {
  return {
    type: "integer",
    description
  };
}

function booleanSchema(description) {
  return {
    type: "boolean",
    description
  };
}

function enumSchema(values) {
  return {
    type: "string",
    enum: values
  };
}

function arraySchema(items) {
  return {
    type: "array",
    items
  };
}
