export function normalizeRuntimeArgv(argv) {
  const withoutSeparator = argv[0] === "--" ? argv.slice(1) : argv;
  return withoutSeparator[0] === "saas" ? withoutSeparator.slice(1) : withoutSeparator;
}
