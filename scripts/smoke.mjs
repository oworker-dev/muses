const apiUrl = process.env.OWORKER_API_URL || "http://127.0.0.1:3001";
const webUrl = process.env.OWORKER_WEB_URL || "http://127.0.0.1:3000";
const smokeRunId = Date.now();

const health = await readJson(`${apiUrl}/health`);
const integrations = await readJson(`${apiUrl}/integrations/health`);
const account = await readJson(`${apiUrl}/account/summary`);
const billing = await readJson(`${apiUrl}/billing/plans`);
const billingState = await readJson(`${apiUrl}/billing/state`);
const upload = await postJson(`${apiUrl}/storage/presigned-upload`, {
  fileName: "smoke.txt",
  contentType: "text/plain"
});
const analyticsEvent = await postJson(`${webUrl}/api/analytics/event`, {
  eventName: "smoke_page_view",
  path: "/smoke",
  feature: "smoke",
  device: "automation"
});
const checkoutWebhook = await postJson(`${webUrl}/api/billing/webhook`, {
  id: `evt_checkout_smoke_${smokeRunId}`,
  type: "checkout.session.completed",
  data: {
    object: {
      id: `cs_smoke_${smokeRunId}`,
      customer: "cus_smoke",
      subscription: `sub_smoke_checkout_${smokeRunId}`,
      status: "complete",
      payment_status: "paid",
      amount_total: 2900,
      currency: "usd",
      customer_email: "smoke@example.com",
      metadata: {
        accountId: "demo-account",
        plan: "pro"
      }
    }
  }
});
const billingEventId = `evt_smoke_${Date.now()}`;
const billingWebhook = await postJson(`${webUrl}/api/billing/webhook`, {
  id: billingEventId,
  type: "customer.subscription.updated",
  data: {
    object: {
      id: "sub_smoke",
      customer: "cus_smoke",
      status: "past_due",
      current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
      metadata: {
        accountId: "demo-account",
        plan: "pro"
      }
    }
  }
});
const duplicateBillingWebhook = await postJson(`${webUrl}/api/billing/webhook`, {
  id: billingEventId,
  type: "customer.subscription.updated",
  data: {
    object: {
      id: "sub_smoke",
      customer: "cus_smoke",
      status: "past_due",
      metadata: {
        accountId: "demo-account",
        plan: "pro"
      }
    }
  }
});
const updatedBillingState = await readJson(`${apiUrl}/billing/state`);

assertStatus("api", health.status, "ok");
for (const key of ["database", "cache", "queue", "storage"]) {
  assertStatus(key, integrations.integrations?.[key]?.status, "ok");
}
assertObject("account", account.account);
assertObject("subscription", account.subscription);
assertArray("billing plans", billing.plans);
assertObject("billing state subscription", billingState.subscription);
assertObject("presigned upload", upload);
assertString("presigned upload url", upload.url);
assertString("presigned upload key", upload.key);
assertValue("analytics event", analyticsEvent.ok, true);
assertValue("analytics event recorded", analyticsEvent.recorded, true);
assertValue("checkout webhook received", checkoutWebhook.received, true);
assertValue("billing webhook received", billingWebhook.received, true);
assertValue("billing webhook duplicate", duplicateBillingWebhook.duplicate, true);
assertValue("billing state status", updatedBillingState.subscription?.status, "past_due");
assertValue("billing state plan", updatedBillingState.subscription?.plan, "pro");
await putUpload(upload);

console.log("OWorker SaaS Starter smoke check passed.");

async function readJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.json();
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.json();
}

async function putUpload(upload) {
  const response = await fetch(upload.url, {
    method: upload.method || "PUT",
    headers: upload.headers || {},
    body: "OWorker SaaS storage smoke"
  });

  if (!response.ok) {
    throw new Error(`presigned upload returned ${response.status}`);
  }
}

function assertStatus(name, actual, expected) {
  if (actual !== expected) {
    throw new Error(`${name} status expected ${expected}, got ${actual || "missing"}`);
  }
}

function assertArray(name, value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${name} expected a non-empty array`);
  }
}

function assertObject(name, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} expected an object`);
  }
}

function assertString(name, value) {
  if (!value || typeof value !== "string") {
    throw new Error(`${name} expected a non-empty string`);
  }
}

function assertValue(name, actual, expected) {
  if (actual !== expected) {
    throw new Error(`${name} expected ${expected}, got ${actual || "missing"}`);
  }
}
