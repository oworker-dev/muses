import {
  AGENT_CORE_SCHEMA_VERSION,
  type AgentEvent,
  type AgentEventDraft,
  type AgentRunSnapshot,
} from "./contracts";
import type { AgentIdPort, AgentStateStorePort } from "./ports";
import { AgentRuntimeError } from "./runtime-port";

type RunRecord = {
  snapshot: AgentRunSnapshot;
  events: AgentEvent[];
  listeners: Set<() => void>;
};

export class InMemoryAgentStateStore implements AgentStateStorePort {
  private readonly records = new Map<string, RunRecord>();

  constructor(private readonly ids: AgentIdPort) {}

  async create(snapshot: AgentRunSnapshot, drafts: readonly AgentEventDraft[]) {
    if (this.records.has(snapshot.runId)) {
      throw new AgentRuntimeError(
        "revision-conflict",
        `AgentRun "${snapshot.runId}" already exists.`,
      );
    }
    const record: RunRecord = { snapshot, events: [], listeners: new Set() };
    record.events.push(...this.materialize(record, drafts));
    this.records.set(snapshot.runId, record);
  }

  async read(runId: string) {
    const snapshot = this.records.get(runId)?.snapshot;
    return snapshot ? structuredClone(snapshot) : null;
  }

  async commit(input: {
    readonly runId: string;
    readonly expectedRevision: number;
    readonly snapshot: AgentRunSnapshot;
    readonly events: readonly AgentEventDraft[];
  }) {
    const record = this.records.get(input.runId);
    if (!record) {
      throw new AgentRuntimeError("run-not-found", "AgentRun was not found.");
    }
    if (record.snapshot.revision !== input.expectedRevision) {
      throw new AgentRuntimeError(
        "revision-conflict",
        `Expected AgentRun revision ${input.expectedRevision}; current revision is ${record.snapshot.revision}.`,
      );
    }
    record.snapshot = structuredClone(input.snapshot);
    record.events.push(...this.materialize(record, input.events));
    for (const notify of record.listeners) notify();
    record.listeners.clear();
    return structuredClone(record.snapshot);
  }

  async readEvents(runId: string, afterSequence = 0) {
    const record = this.records.get(runId);
    if (!record) {
      throw new AgentRuntimeError("run-not-found", "AgentRun was not found.");
    }
    return structuredClone(
      record.events.filter((event) => event.sequence > afterSequence),
    );
  }

  async *stream(runId: string, afterSequence = 0): AsyncIterable<AgentEvent> {
    let cursor = afterSequence;
    while (true) {
      const record = this.records.get(runId);
      if (!record) {
        throw new AgentRuntimeError("run-not-found", "AgentRun was not found.");
      }
      const pending = record.events.filter((event) => event.sequence > cursor);
      for (const event of pending) {
        cursor = event.sequence;
        yield structuredClone(event);
      }
      if (isTerminal(record.snapshot.status)) return;
      await new Promise<void>((resolve) => record.listeners.add(resolve));
    }
  }

  private materialize(record: RunRecord, drafts: readonly AgentEventDraft[]) {
    return drafts.map(
      (draft, index): AgentEvent => ({
        ...draft,
        schemaVersion: AGENT_CORE_SCHEMA_VERSION,
        eventId: this.ids.create("aevent"),
        sequence: record.events.length + index + 1,
      }),
    );
  }
}

function isTerminal(status: AgentRunSnapshot["status"]) {
  return (
    status === "completed" || status === "failed" || status === "cancelled"
  );
}
