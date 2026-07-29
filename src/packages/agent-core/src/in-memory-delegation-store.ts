import {
  AGENT_DELEGATION_SCHEMA_VERSION,
  type AgentDelegationEvent,
  type AgentDelegationEventDraft,
} from "./orchestration";
import {
  AgentDelegationRuntimeError,
  type AgentDelegationRecord,
  type AgentDelegationStateStorePort,
} from "./delegation-scheduler";
import type { AgentIdPort } from "./ports";

type StoredDelegation = {
  record: AgentDelegationRecord;
  events: AgentDelegationEvent[];
};

export class InMemoryAgentDelegationStore
  implements AgentDelegationStateStorePort
{
  private readonly records = new Map<string, StoredDelegation>();
  private readonly submissionIndex = new Map<string, string>();

  constructor(private readonly ids: AgentIdPort) {}

  async create(
    record: AgentDelegationRecord,
    drafts: readonly AgentDelegationEventDraft[],
  ) {
    const submissionKey = key(record);
    const existingId = this.submissionIndex.get(submissionKey);
    if (existingId) {
      return {
        created: false,
        record: structuredClone(this.records.get(existingId)!.record),
      };
    }
    if (this.records.has(record.snapshot.delegationRunId)) {
      throw new AgentDelegationRuntimeError(
        "delegation-revision-conflict",
        "Delegation run already exists.",
      );
    }
    const stored: StoredDelegation = {
      record: structuredClone(record),
      events: [],
    };
    stored.events.push(...this.materialize(stored, drafts));
    this.records.set(record.snapshot.delegationRunId, stored);
    this.submissionIndex.set(submissionKey, record.snapshot.delegationRunId);
    return { created: true, record: structuredClone(stored.record) };
  }

  async read(delegationRunId: string) {
    const record = this.records.get(delegationRunId)?.record;
    return record ? structuredClone(record) : null;
  }

  async commit(input: Parameters<AgentDelegationStateStorePort["commit"]>[0]) {
    const stored = this.records.get(input.delegationRunId);
    if (!stored) {
      throw new AgentDelegationRuntimeError(
        "delegation-not-found",
        "Delegation run was not found.",
      );
    }
    if (
      stored.record.snapshot.revision !== input.expectedRevision ||
      input.snapshot.revision !== input.expectedRevision + 1
    ) {
      throw new AgentDelegationRuntimeError(
        "delegation-revision-conflict",
        "Delegation run revision changed before commit.",
      );
    }
    stored.record = {
      ...stored.record,
      snapshot: structuredClone(input.snapshot),
    };
    stored.events.push(...this.materialize(stored, input.events));
    return structuredClone(stored.record);
  }

  async readEvents(delegationRunId: string, afterSequence = 0) {
    const stored = this.records.get(delegationRunId);
    if (!stored) {
      throw new AgentDelegationRuntimeError(
        "delegation-not-found",
        "Delegation run was not found.",
      );
    }
    return structuredClone(
      stored.events.filter(({ sequence }) => sequence > afterSequence),
    );
  }

  private materialize(
    stored: StoredDelegation,
    drafts: readonly AgentDelegationEventDraft[],
  ) {
    return drafts.map(
      (draft, index): AgentDelegationEvent => ({
        ...draft,
        schemaVersion: AGENT_DELEGATION_SCHEMA_VERSION,
        eventId: this.ids.create("delegation-event"),
        sequence: stored.events.length + index + 1,
      }),
    );
  }
}

function key(record: AgentDelegationRecord) {
  return `${record.plan.workspaceId}:${record.submission.idempotencyKey}`;
}
