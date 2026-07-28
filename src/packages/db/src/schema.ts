import {
  bigint,
  boolean,
  date,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const musesWorkspace = pgTable(
  "muses_workspace",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull().default("personal"),
    name: text("name").notNull(),
    personalOwnerUserId: text("personal_owner_user_id"),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("muses_workspace_personal_owner_idx").on(
      table.personalOwnerUserId,
    ),
  ],
);

export const musesWorkspaceMember = pgTable(
  "muses_workspace_member",
  {
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    role: text("role").notNull().default("member"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.userId] })],
);

export const musesProject = pgTable(
  "muses_project",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    name: text("name").notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("muses_project_workspace_name_idx").on(
      table.workspaceId,
      table.name,
    ),
  ],
);

export const musesCreativeCanvas = pgTable(
  "muses_creative_canvas",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    projectId: text("project_id").notNull(),
    schemaVersion: text("schema_version").notNull(),
    revision: integer("revision").notNull().default(0),
    document: jsonb("document").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("muses_creative_canvas_project_idx").on(
      table.workspaceId,
      table.projectId,
    ),
  ],
);

export const musesProfessionalWorkspace = pgTable(
  "muses_professional_workspace",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    projectId: text("project_id").notNull(),
    schemaVersion: text("schema_version").notNull(),
    revision: integer("revision").notNull().default(0),
    document: jsonb("document").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("muses_professional_workspace_project_idx").on(
      table.workspaceId,
      table.projectId,
    ),
  ],
);

export const musesWorkflowDefinitionDraft = pgTable(
  "muses_workflow_definition_draft",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    projectId: text("project_id").notNull(),
    professionalWorkspaceId: text("professional_workspace_id").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    schemaVersion: text("schema_version").notNull(),
    revision: integer("revision").notNull().default(0),
    lifecycleStatus: text("lifecycle_status").notNull().default("draft"),
    document: jsonb("document").notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export const musesWorkflowDefinitionVersion = pgTable(
  "muses_workflow_definition_version",
  {
    definitionId: text("definition_id").notNull(),
    version: integer("version").notNull(),
    workspaceId: text("workspace_id").notNull(),
    schemaVersion: text("schema_version").notNull(),
    definition: jsonb("definition").notNull(),
    inputSchema: jsonb("input_schema").notNull().default({}),
    outputSchema: jsonb("output_schema").notNull().default({}),
    publishedByUserId: text("published_by_user_id").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.definitionId, table.version] }),
  ],
);

export const musesWorkflowDeployment = pgTable(
  "muses_workflow_deployment",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    definitionId: text("definition_id").notNull(),
    alias: text("alias").notNull(),
    version: integer("version").notNull(),
    status: text("status").notNull().default("active"),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("muses_workflow_deployment_alias_idx").on(
      table.workspaceId,
      table.definitionId,
      table.alias,
    ),
  ],
);

export const musesOperationCommandReceipt = pgTable(
  "muses_operation_command_receipt",
  {
    workspaceId: text("workspace_id").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    commandId: text("command_id").notNull(),
    actorKind: text("actor_kind").notNull(),
    actorId: text("actor_id").notNull(),
    expectedRevision: integer("expected_revision").notNull(),
    resultingRevision: integer("resulting_revision"),
    status: text("status").notNull().default("processing"),
    response: jsonb("response"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({
      columns: [
        table.workspaceId,
        table.targetType,
        table.targetId,
        table.idempotencyKey,
      ],
    }),
    uniqueIndex("muses_operation_command_receipt_command_idx").on(
      table.workspaceId,
      table.commandId,
    ),
  ],
);

export const creditAccount = pgTable(
  "credit_account",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    currency: text("currency").notNull().default("MUSES_CREDIT"),
    postedBalanceMicros: bigint("posted_balance_micros", { mode: "bigint" })
      .notNull()
      .default(BigInt(0)),
    reservedBalanceMicros: bigint("reserved_balance_micros", {
      mode: "bigint",
    })
      .notNull()
      .default(BigInt(0)),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("credit_account_workspace_idx").on(table.workspaceId),
  ],
);

export const creditLedgerEntry = pgTable(
  "credit_ledger_entry",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    kind: text("kind").notNull(),
    balanceDeltaMicros: bigint("balance_delta_micros", { mode: "bigint" })
      .notNull()
      .default(BigInt(0)),
    reservedDeltaMicros: bigint("reserved_delta_micros", { mode: "bigint" })
      .notNull()
      .default(BigInt(0)),
    balanceAfterMicros: bigint("balance_after_micros", {
      mode: "bigint",
    }).notNull(),
    reservedAfterMicros: bigint("reserved_after_micros", {
      mode: "bigint",
    }).notNull(),
    reservationId: text("reservation_id"),
    workflowRunId: text("workflow_run_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    actorUserId: text("actor_user_id"),
    reason: text("reason").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("credit_ledger_entry_account_idempotency_idx").on(
      table.accountId,
      table.idempotencyKey,
    ),
  ],
);

export const creditReservation = pgTable(
  "credit_reservation",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    submissionId: text("submission_id").notNull(),
    workflowRunId: text("workflow_run_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull().default("active"),
    estimatedMicros: bigint("estimated_micros", { mode: "bigint" }).notNull(),
    settledMicros: bigint("settled_micros", { mode: "bigint" })
      .notNull()
      .default(BigInt(0)),
    pricingSnapshot: jsonb("pricing_snapshot").notNull().default({}),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("credit_reservation_workspace_idempotency_idx").on(
      table.workspaceId,
      table.idempotencyKey,
    ),
    uniqueIndex("credit_reservation_workflow_run_idx").on(table.workflowRunId),
  ],
);

export const musesWorkflowRun = pgTable(
  "muses_workflow_run",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    sdkRunId: text("sdk_run_id"),
    submittedByUserId: text("submitted_by_user_id").notNull(),
    workflowDocumentId: text("workflow_document_id").notNull(),
    workflowDocumentRevision: integer("workflow_document_revision").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    reservationId: text("reservation_id"),
    status: text("status").notNull().default("starting"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("muses_workflow_run_sdk_run_idx").on(table.sdkRunId),
    uniqueIndex("muses_workflow_run_workspace_idempotency_idx").on(
      table.workspaceId,
      table.idempotencyKey,
    ),
  ],
);

export const musesAgentRun = pgTable(
  "muses_agent_run",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    projectId: text("project_id").notNull(),
    canvasId: text("canvas_id"),
    sessionId: text("session_id").notNull(),
    profileId: text("profile_id").notNull(),
    profileVersion: text("profile_version").notNull(),
    modelRef: text("model_ref").notNull(),
    status: text("status").notNull(),
    revision: integer("revision").notNull().default(0),
    snapshot: jsonb("snapshot").notNull(),
    driverStatus: text("driver_status").notNull().default("unclaimed"),
    driverRunId: text("driver_run_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("muses_agent_run_driver_idx").on(table.driverRunId),
  ],
);

export const musesAgentEvent = pgTable(
  "muses_agent_event",
  {
    runId: text("run_id").notNull(),
    sequence: integer("sequence").notNull(),
    eventId: text("event_id").notNull(),
    schemaVersion: text("schema_version").notNull(),
    type: text("type").notNull(),
    data: jsonb("data").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.sequence] }),
    uniqueIndex("muses_agent_event_id_idx").on(table.eventId),
  ],
);

export const musesReferenceImage = pgTable(
  "muses_reference_image",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    objectKey: text("object_key").notNull(),
    fileName: text("file_name").notNull(),
    declaredMimeType: text("declared_mime_type").notNull(),
    mimeType: text("mime_type"),
    byteSize: bigint("byte_size", { mode: "bigint" }),
    width: integer("width"),
    height: integer("height"),
    status: text("status").notNull().default("uploading"),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("muses_reference_image_object_key_idx").on(table.objectKey),
  ],
);

export const modelProvider = pgTable("model_provider", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull(),
  displayName: text("display_name").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const modelOffering = pgTable(
  "model_offering",
  {
    id: text("id").primaryKey(),
    providerId: text("provider_id").notNull(),
    modelRef: text("model_ref").notNull(),
    providerModelId: text("provider_model_id").notNull(),
    displayName: text("display_name").notNull(),
    capabilityFamily: text("capability_family").notNull(),
    specificationVersion: text("specification_version").notNull(),
    lifecycleStatus: text("lifecycle_status").notNull().default("draft"),
    enabled: boolean("enabled").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("model_offering_model_ref_idx").on(table.modelRef)],
);

export const capabilityProfile = pgTable(
  "capability_profile",
  {
    id: text("id").primaryKey(),
    modelOfferingId: text("model_offering_id").notNull(),
    capabilityId: text("capability_id").notNull(),
    profileVersion: text("profile_version").notNull(),
    lifecycleStatus: text("lifecycle_status").notNull().default("draft"),
    specification: jsonb("specification").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("capability_profile_version_idx").on(
      table.modelOfferingId,
      table.capabilityId,
      table.profileVersion,
    ),
  ],
);

export const priceBookEntry = pgTable(
  "price_book_entry",
  {
    id: text("id").primaryKey(),
    modelOfferingId: text("model_offering_id").notNull(),
    priceBookVersion: text("price_book_version").notNull(),
    lifecycleStatus: text("lifecycle_status").notNull().default("draft"),
    billingUnit: text("billing_unit").notNull(),
    unitCreditMicros: bigint("unit_credit_micros", {
      mode: "bigint",
    }).notNull(),
    currencyReference: text("currency_reference"),
    estimationRule: jsonb("estimation_rule").notNull().default({}),
    effectiveFrom: timestamp("effective_from", {
      withTimezone: true,
    }).notNull(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("price_book_entry_version_idx").on(
      table.modelOfferingId,
      table.priceBookVersion,
      table.billingUnit,
    ),
  ],
);

export const billingSubscription = pgTable("billing_subscription", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  plan: text("plan").notNull(),
  status: text("status").notNull(),
  monthlyAmountCents: integer("monthly_amount_cents").notNull().default(0),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  stripePriceId: text("stripe_price_id"),
  stripeCheckoutSessionId: text("stripe_checkout_session_id"),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const billingWebhookEvent = pgTable("billing_webhook_event", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  eventId: text("event_id").notNull(),
  eventType: text("event_type").notNull(),
  status: text("status").notNull(),
  payload: jsonb("payload").notNull(),
  error: text("error"),
  receivedAt: timestamp("received_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
});

export const paymentRecord = pgTable("payment_record", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  provider: text("provider").notNull(),
  providerPaymentId: text("provider_payment_id"),
  providerEventId: text("provider_event_id"),
  customerEmail: text("customer_email"),
  amountCents: integer("amount_cents").notNull().default(0),
  currency: text("currency").notNull().default("usd"),
  status: text("status").notNull(),
  description: text("description"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const analyticsEvent = pgTable("analytics_event", {
  id: text("id").primaryKey(),
  eventName: text("event_name").notNull(),
  path: text("path").notNull(),
  feature: text("feature"),
  referrer: text("referrer"),
  device: text("device"),
  country: text("country"),
  userIdHash: text("user_id_hash"),
  sessionIdHash: text("session_id_hash"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const analyticsDailyRollup = pgTable("analytics_daily_rollup", {
  bucketDate: date("bucket_date").notNull(),
  eventName: text("event_name").notNull(),
  path: text("path").notNull(),
  feature: text("feature").notNull().default("none"),
  device: text("device").notNull().default("unknown"),
  country: text("country").notNull().default("unknown"),
  authenticated: boolean("authenticated").notNull().default(false),
  eventCount: integer("event_count").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const analyticsHourlyRollup = pgTable("analytics_hourly_rollup", {
  bucketStart: timestamp("bucket_start", { withTimezone: true }).notNull(),
  eventName: text("event_name").notNull(),
  path: text("path").notNull(),
  feature: text("feature").notNull().default("none"),
  device: text("device").notNull().default("unknown"),
  country: text("country").notNull().default("unknown"),
  authenticated: boolean("authenticated").notNull().default(false),
  eventCount: integer("event_count").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const analyticsDailyVisitor = pgTable("analytics_daily_visitor", {
  bucketDate: date("bucket_date").notNull(),
  sessionIdHash: text("session_id_hash").notNull(),
  userIdHash: text("user_id_hash"),
  authenticated: boolean("authenticated").notNull().default(false),
  country: text("country").notNull().default("unknown"),
  device: text("device").notNull().default("unknown"),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const analyticsVisitorActivity = pgTable("analytics_visitor_activity", {
  sessionIdHash: text("session_id_hash").primaryKey(),
  userIdHash: text("user_id_hash"),
  authenticated: boolean("authenticated").notNull().default(false),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastCountry: text("last_country").notNull().default("unknown"),
  lastDevice: text("last_device").notNull().default("unknown"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const accountActivitySummary = pgTable("account_activity_summary", {
  userId: text("user_id").primaryKey(),
  userIdHash: text("user_id_hash").notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastCountry: text("last_country").notNull().default("unknown"),
  lastDevice: text("last_device").notNull().default("unknown"),
  lastPath: text("last_path").notNull().default("/"),
  lastEventName: text("last_event_name").notNull().default("page_view"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const auditLog = pgTable("audit_log", {
  id: text("id").primaryKey(),
  actorUserId: text("actor_user_id"),
  actorEmail: text("actor_email"),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const workflowRunResumeReceipt = pgTable(
  "workflow_run_resume_receipt",
  {
    workspaceId: text("workspace_id").notNull(),
    runId: text("run_id").notNull(),
    suspensionId: text("suspension_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    selectedAssetId: text("selected_asset_id").notNull(),
    status: text("status").notNull().default("processing"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({
      columns: [table.workspaceId, table.runId, table.idempotencyKey],
    }),
    uniqueIndex("workflow_run_resume_receipt_suspension_idx").on(
      table.workspaceId,
      table.runId,
      table.suspensionId,
    ),
  ],
);

export const workflowRunCancelReceipt = pgTable(
  "workflow_run_cancel_receipt",
  {
    workspaceId: text("workspace_id").notNull(),
    runId: text("run_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    reason: text("reason"),
    status: text("status").notNull().default("processing"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({
      columns: [table.workspaceId, table.runId, table.idempotencyKey],
    }),
    uniqueIndex("workflow_run_cancel_receipt_run_idx").on(
      table.workspaceId,
      table.runId,
    ),
  ],
);

export const workflowRunRetryReceipt = pgTable(
  "workflow_run_retry_receipt",
  {
    workspaceId: text("workspace_id").notNull(),
    sourceRunId: text("source_run_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    targetRunId: text("target_run_id"),
    status: text("status").notNull().default("processing"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({
      columns: [table.workspaceId, table.sourceRunId, table.idempotencyKey],
    }),
    uniqueIndex("workflow_run_retry_receipt_target_idx").on(table.targetRunId),
  ],
);
