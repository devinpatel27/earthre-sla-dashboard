import type { CheckRecord, ServiceStat } from "./types";

export function buildServiceStats(records: CheckRecord[]): ServiceStat[] {
  const byService = new Map<string, CheckRecord[]>();

  for (const record of records) {
    const key = `${record.serviceId}|${record.serviceName}`;
    byService.set(key, [...(byService.get(key) ?? []), record]);
  }

  return Array.from(byService.entries())
    .map(([key, serviceRecords]) => {
      const [serviceId, serviceName] = key.split("|");
      const latencies = serviceRecords
        .map((record) => record.latencyMs)
        .filter((latency): latency is number => latency !== null)
        .sort((a, b) => a - b);
      const upChecks = serviceRecords.filter((record) => record.isUp).length;

      return {
        serviceId,
        serviceName,
        totalChecks: serviceRecords.length,
        upChecks,
        failedChecks: serviceRecords.length - upChecks,
        availability: serviceRecords.length ? (upChecks / serviceRecords.length) * 100 : 0,
        avgLatencyMs: latencies.length ? average(latencies) : null,
        p95LatencyMs: latencies.length ? percentile(latencies, 0.95) : null,
      };
    })
    .sort((a, b) => a.availability - b.availability || a.serviceName.localeCompare(b.serviceName));
}

function average(values: number[]) {
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function percentile(values: number[], percentileValue: number) {
  const index = Math.ceil(values.length * percentileValue) - 1;
  return values[Math.max(0, Math.min(values.length - 1, index))];
}
