import { describe, expect, it } from "vitest";

import { runA9FixedEvals } from "./a9-fixed-evals";
import { A9_FIXED_EVAL_SUITE } from "./fixtures/a9-fixed-v1";

describe("A9 fixed Agent evals", () => {
  it("passes every versioned hard gate without live provider or network calls", async () => {
    const report = await runA9FixedEvals();

    expect(report).toMatchObject({
      status: "passed",
      passed: 8,
      failed: 0,
      total: 8,
      liveProviderCalls: 0,
      liveNetworkCalls: 0,
    });
    expect(
      report.cases.map(({ id, category, status }) => ({
        id,
        category,
        status,
      })),
    ).toEqual(
      A9_FIXED_EVAL_SUITE.cases.map(({ id, category }) => ({
        id,
        category,
        status: "passed",
      })),
    );
    expect(
      report.cases.every(
        (result) =>
          result.observed &&
          result.assertions.every((key) => key in result.observed!),
      ),
    ).toBe(true);
  });
});
