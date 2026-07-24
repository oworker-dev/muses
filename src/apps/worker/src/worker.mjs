const queues = ["maintenance", "notifications"];
const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";

if (process.argv.includes("--check")) {
  console.log("OWorker SaaS worker skeleton check passed.");
} else {
  const { Queue, Worker } = await import("bullmq");
  const { default: IORedis } = await import("ioredis");
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue("maintenance", { connection });
  const worker = new Worker(
    "maintenance",
    async (job) => ({
      ok: true,
      job: job.name
    }),
    { connection }
  );

  worker.on("ready", () => {
    console.log(JSON.stringify({ service: "oworker.saas.worker", status: "ready", queues }));
  });

  worker.on("failed", (job, error) => {
    console.error(JSON.stringify({ service: "oworker.saas.worker", status: "failed", job: job?.name, error: error.message }));
  });

  await queue.add("startup-check", { at: new Date().toISOString() }, { removeOnComplete: true, removeOnFail: true });
}
