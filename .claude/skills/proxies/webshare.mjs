// Usage: node --env-file=.env .claude/skills/proxies/webshare.mjs
const api = "https://proxy.webshare.io/api/v2";
const headers = { Authorization: `Token ${process.env.PROXY_API_KEY}` };
const GB = 1e9;

const get = async (path) => {
  const response = await fetch(`${api}${path}`, { headers });
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return response.json();
};

const gb = (bytes) => (bytes / GB).toFixed(1);

const subscription = await get("/subscription/");
const { results: plans } = await get("/subscription/plan/");
const start = subscription.start_date;
const end = subscription.end_date;
const range = `timestamp__gte=${start}&timestamp__lte=${end}`;

console.log(`Period ${start.slice(0, 10)} - ${end.slice(0, 10)}, throttled: ${subscription.throttled}, paused: ${subscription.paused}\n`);

for (const plan of plans.filter((plan) => plan.status === "active")) {
  const stats = await get(`/stats/aggregate/?plan_id=${plan.id}&${range}`);
  const limit = plan.bandwidth_limit * GB;
  const pct = (bytes) => (limit ? ((bytes / limit) * 100).toFixed(0) + "%" : "unlimited");
  console.log(`${plan.proxy_subtype} (${plan.id}): ${plan.proxy_count} proxies, $${plan.monthly_price.toFixed(2)}/mo, high concurrency: ${plan.is_high_concurrency}`);
  console.log(`  bandwidth  ${gb(stats.bandwidth_total)} / ${plan.bandwidth_limit} GB (${pct(stats.bandwidth_total)}), projected ${gb(stats.bandwidth_projected)} GB (${pct(stats.bandwidth_projected)})`);
  console.log(`  avg concurrency ${stats.average_concurrency.toFixed(0)}, avg rps ${stats.average_rps.toFixed(1)}, requests ${stats.requests_total} (${stats.requests_failed} failed)`);
  console.log(`  last request ${stats.last_request_sent_at}`);
  for (const error of stats.error_reasons) console.log(`  error ${error.reason}: ${error.count}`);

  const hours = await get(`/stats/?plan_id=${plan.id}&${range}`);
  const days = {};
  for (const hour of hours.filter((hour) => !hour.is_projected)) {
    const day = hour.timestamp.slice(0, 10);
    days[day] = (days[day] ?? 0) + hour.bandwidth_total;
  }
  const max = Math.max(...Object.values(days));
  for (const [day, bytes] of Object.entries(days)) {
    console.log(`  ${day} ${"█".repeat(Math.round((bytes / max) * 40)).padEnd(40)} ${gb(bytes)} GB`);
  }
  console.log();
}
