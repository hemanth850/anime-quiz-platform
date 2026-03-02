#!/usr/bin/env node
const baseUrl = process.env.API_URL ?? "http://localhost:4000";
const durationSec = Number(process.env.LOAD_DURATION_SEC ?? 20);
const concurrency = Number(process.env.LOAD_CONCURRENCY ?? 20);

const endpoints = ["/health", "/api/rankings", "/api/questions"];
let total = 0;
let failed = 0;
const latencies = [];

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function worker(stopAt) {
  while (Date.now() < stopAt) {
    const path = endpoints[Math.floor(Math.random() * endpoints.length)];
    const started = performance.now();
    try {
      const res = await fetch(`${baseUrl}${path}`);
      if (!res.ok) {
        failed += 1;
      }
      await res.arrayBuffer();
    } catch {
      failed += 1;
    } finally {
      total += 1;
      latencies.push(performance.now() - started);
    }
  }
}

async function main() {
  const stopAt = Date.now() + durationSec * 1000;
  const workers = Array.from({ length: concurrency }, () => worker(stopAt));

  console.log(`Running load smoke test: ${durationSec}s, concurrency=${concurrency}, baseUrl=${baseUrl}`);
  await Promise.all(workers);

  const avg = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
  console.log("Load smoke result");
  console.log(`- total requests: ${total}`);
  console.log(`- failed requests: ${failed}`);
  console.log(`- avg latency: ${avg.toFixed(2)}ms`);
  console.log(`- p50 latency: ${percentile(latencies, 50).toFixed(2)}ms`);
  console.log(`- p95 latency: ${percentile(latencies, 95).toFixed(2)}ms`);
  console.log(`- p99 latency: ${percentile(latencies, 99).toFixed(2)}ms`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Load smoke failed", err);
  process.exit(1);
});
