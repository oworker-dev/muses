import { describe, expect, it } from "vitest"

import {
  AGENT_EMBED_CONTRACT_VERSION,
  parseAgentEmbedEvent,
} from "@muses/agent-contracts/embed"

describe("Agent Embed host protocol", () => {
  it("accepts only the versioned event surface", () => {
    expect(
      parseAgentEmbedEvent({
        type: "agent.embed.ready",
        contractVersion: AGENT_EMBED_CONTRACT_VERSION,
      }),
    ).toMatchObject({ type: "agent.embed.ready" })
    expect(
      parseAgentEmbedEvent({
        type: "agent.embed.ready",
        contractVersion: "0.0.1",
      }),
    ).toBeUndefined()
  })

  it("projects generic Host capability completions without Muses payload parsing", () => {
    expect(
      parseAgentEmbedEvent({
        type: "agent.embed.host-capability-completed",
        contractVersion: AGENT_EMBED_CONTRACT_VERSION,
        capability: "canvas.item.put",
        output: { itemId: "item-1" },
      }),
    ).toMatchObject({ capability: "canvas.item.put" })
  })
})
