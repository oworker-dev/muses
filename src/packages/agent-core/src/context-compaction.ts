import {
  AGENT_CORE_SCHEMA_VERSION,
  type AgentContextFact,
  type AgentContextSummary,
  type AgentMessage,
  type AgentRunSnapshot,
} from "./contracts";

export const DEFAULT_AGENT_CONTEXT_MAX_MESSAGES = 24;
export const DEFAULT_AGENT_CONTEXT_RETAIN_MESSAGES = 16;
export const DEFAULT_AGENT_CONTEXT_MAX_CHARACTERS = 48_000;
export const DEFAULT_AGENT_CONTEXT_RETAIN_CHARACTERS = 32_000;
export const DEFAULT_AGENT_CONTEXT_HISTORY_CHARACTERS = 16_000;

export function compactAgentContext(
  run: AgentRunSnapshot,
  maxMessages = DEFAULT_AGENT_CONTEXT_RETAIN_MESSAGES,
  maxCharacters = DEFAULT_AGENT_CONTEXT_RETAIN_CHARACTERS,
): {
  readonly messages: readonly AgentMessage[];
  readonly summary: AgentContextSummary;
} {
  const limit = normalizeLimit(maxMessages);
  const characterLimit = normalizeCharacterLimit(maxCharacters);
  const messages = run.context.messages;
  const reserved = new Set<string>();

  for (const message of messages) {
    if (message.role === "system") reserved.add(message.id);
  }
  for (const pending of run.pendingToolCalls) {
    for (const message of messages) {
      if (message.toolCalls?.some((call) => call.id === pending.call.id)) {
        reserved.add(message.id);
      }
    }
  }

  const retained = new Set<string>(reserved);
  const remainingSlots = Math.max(0, limit - retained.size);
  let retainedCharacters = messages
    .filter(({ id }) => retained.has(id))
    .reduce((total, message) => total + messageCharacterCount(message), 0);
  let retainedRecent = 0;
  for (const message of [...messages].reverse()) {
    if (retained.size >= limit) break;
    if (retained.has(message.id)) continue;
    const messageCharacters = messageCharacterCount(message);
    if (
      retainedRecent > 0 &&
      retainedCharacters + messageCharacters > characterLimit
    ) {
      break;
    }
    retained.add(message.id);
    retainedCharacters += messageCharacters;
    retainedRecent += 1;
    if (retained.size - reserved.size >= remainingSlots) break;
  }
  const retainedMessages = messages.filter((message) =>
    retained.has(message.id),
  );
  const omittedMessages = messages.filter(
    (message) => !retained.has(message.id),
  );
  const facts = buildFacts(run, omittedMessages);
  const summary: AgentContextSummary = {
    schemaVersion: AGENT_CORE_SCHEMA_VERSION,
    version: (run.context.summary?.version || 0) + 1,
    sourceContextVersion: run.context.version,
    sourceMessageCount: messages.length,
    retainedMessageIds: retainedMessages.map(({ id }) => id),
    facts,
    text: renderSummary(run, facts),
    createdAt: run.updatedAt,
  };
  return { messages: retainedMessages, summary };
}

function buildFacts(
  run: AgentRunSnapshot,
  omittedMessages: readonly AgentMessage[],
): readonly AgentContextFact[] {
  const facts: AgentContextFact[] = [];
  const previousFacts = run.context.summary?.facts || [];
  const previousIntent = previousFacts.find(
    ({ kind }) => kind === "user-intent",
  );
  const firstUser = run.context.messages.find(({ role }) => role === "user");
  if (previousIntent) {
    facts.push(previousIntent);
  } else if (firstUser) {
    facts.push({
      kind: "user-intent",
      key: firstUser.id,
      value: truncate(firstUser.content),
    });
  }
  if (run.plan) {
    facts.push({
      kind: "plan",
      key: `revision:${run.plan.revision}`,
      value: stableJson(run.plan),
    });
  }
  facts.push({
    kind: "permissions",
    key: "run",
    value: run.permissions.join(",") || "(none)",
  });
  facts.push({
    kind: "budget",
    key: "usage",
    value: stableJson(run.budget),
  });
  for (const ref of run.context.artifactRefs) {
    facts.push({ kind: "artifact", key: ref, value: ref });
  }
  for (const pending of run.pendingToolCalls) {
    facts.push({
      kind: "pending-action",
      key: pending.call.id,
      value: stableJson({ call: pending.call, approval: pending.approval }),
    });
  }
  const toolResults = new Map<string, AgentContextFact>();
  for (const fact of previousFacts) {
    if (fact.kind === "tool-result") toolResults.set(fact.key, fact);
  }
  for (const message of omittedMessages) {
    if (message.role === "tool") {
      toolResults.set(message.toolCallId || message.id, {
        kind: "tool-result",
        key: message.toolCallId || message.id,
        value: `${message.toolName || "tool"}: ${truncate(message.content, 1600)}`,
      });
    }
  }
  facts.push(...toolResults.values());

  const history = buildConversationHistory(previousFacts, omittedMessages);
  if (history) {
    facts.push({
      kind: "message",
      key: "history",
      value: history,
    });
  }
  return facts;
}

function buildConversationHistory(
  previous: readonly AgentContextFact[],
  omittedMessages: readonly AgentMessage[],
) {
  const previousHistory = previous
    .filter(({ kind }) => kind === "message")
    .map(({ value }) => value);
  const currentHistory = omittedMessages
    .filter(({ role }) => role !== "tool")
    .map(summarizeMessage);
  const history = [...previousHistory, ...currentHistory]
    .filter(Boolean)
    .join("\n");
  if (!history) return "";
  if (history.length <= DEFAULT_AGENT_CONTEXT_HISTORY_CHARACTERS) {
    return history;
  }
  const prefix = "[Earlier conversational detail compacted]\n";
  return `${prefix}${history.slice(
    -(DEFAULT_AGENT_CONTEXT_HISTORY_CHARACTERS - prefix.length),
  )}`;
}

function renderSummary(
  run: AgentRunSnapshot,
  facts: readonly AgentContextFact[],
) {
  return [
    `Muses context summary v${(run.context.summary?.version || 0) + 1}.`,
    `Source context version: ${run.context.version}; source messages: ${run.context.messages.length}.`,
    `${facts.length} structured facts were preserved by Agent Core.`,
  ].join("\n");
}

function normalizeLimit(value: number) {
  if (!Number.isInteger(value) || value < 2) return 2;
  return Math.min(value, 200);
}

function normalizeCharacterLimit(value: number) {
  if (!Number.isInteger(value) || value < 1_024) return 1_024;
  return Math.min(value, 2_000_000);
}

export function agentContextCharacterCount(run: AgentRunSnapshot) {
  const messageCharacters = run.context.messages.reduce(
    (total, message) => total + messageCharacterCount(message),
    0,
  );
  const summaryCharacters = run.context.summary
    ? run.context.summary.text.length +
      run.context.summary.facts.reduce(
        (total, fact) =>
          total + fact.kind.length + fact.key.length + fact.value.length,
        0,
      )
    : 0;
  return messageCharacters + summaryCharacters;
}

function messageCharacterCount(message: AgentMessage) {
  return (
    message.content.length +
    (message.toolCalls ? stableJson(message.toolCalls).length : 0) +
    (message.metadata ? stableJson(message.metadata).length : 0)
  );
}

function summarizeMessage(message: AgentMessage) {
  const toolCalls = message.toolCalls?.length
    ? `; toolCalls=${truncate(stableJson(message.toolCalls), 1600)}`
    : "";
  return `${message.role} [${message.id}]: ${truncate(message.content, 1600)}${toolCalls}`;
}

function truncate(value: string, max = 800) {
  return value.length <= max ? value : `${value.slice(0, max)}...`;
}

function stableJson(value: unknown) {
  return JSON.stringify(value);
}
