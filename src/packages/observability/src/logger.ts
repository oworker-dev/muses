export function logInfo(event, data = {}) {
  console.log(JSON.stringify({ level: "info", event, ...data }));
}
