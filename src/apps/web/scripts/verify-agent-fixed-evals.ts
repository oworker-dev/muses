import { readFile } from "node:fs/promises"

import { runA9FixedEvals } from "../../../packages/agent-core/tests/a9-fixed-evals"

const report = await runA9FixedEvals()
const expectedPath = expectedEvidencePath(process.argv.slice(2))

if (expectedPath) {
  const expected = JSON.parse(await readFile(expectedPath, "utf8"))
  if (JSON.stringify(expected) !== JSON.stringify(report)) {
    console.error(`A9 fixed eval evidence drifted from ${expectedPath}.`)
    process.exitCode = 1
  }
}

console.log(JSON.stringify(report, null, 2))
if (report.status !== "passed") process.exitCode = 1

function expectedEvidencePath(args: readonly string[]) {
  const index = args.indexOf("--expect")
  if (index === -1) return undefined
  const value = args[index + 1]
  if (!value) throw new Error("--expect requires an evidence path.")
  return value
}
