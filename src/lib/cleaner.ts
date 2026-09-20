import { parse } from "csv-parse/sync";
import { randomUUID } from "crypto";
import type { CheckRecord, UploadSummary } from "./types";

type CsvRow = {
  service_id?: string;
  service_name?: string;
  timestamp?: string;
  status_code?: string;
  latency?: string;
  latency_unit?: string;
  agent?: string;
  region?: string;
};

export function cleanMonitoringCsv(csvText: string, fileName: string) {
  const batchId = randomUUID();
  const rows = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as CsvRow[];

  const records: CheckRecord[] = [];
  const rejectedReasons = new Map<string, number>();
  const seen = new Set<string>();
  let duplicateRows = 0;
  let missingLatencyRows = 0;
  let normalizedSecondRows = 0;

  for (const row of rows) {
    const serviceId = row.service_id?.trim();
    const serviceName = row.service_name?.trim();
    const timestamp = parseTimestamp(row.timestamp);
    const statusCode = Number(row.status_code);
    const agent = row.agent?.trim();
    const region = row.region?.trim();

    if (!serviceId || !serviceName || !timestamp || !agent || !region) {
      addIssue(rejectedReasons, "Rejected rows with missing required identity/timestamp fields.");
      continue;
    }

    if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
      addIssue(rejectedReasons, "Rejected rows with invalid HTTP status codes outside 100-599.");
      continue;
    }

    const latency = normalizeLatency(row.latency, row.latency_unit);
    if (latency.kind === "invalid") {
      addIssue(rejectedReasons, "Rejected rows with negative or non-numeric latency.");
      continue;
    }
    if (latency.kind === "missing") {
      missingLatencyRows += 1;
    }
    if (latency.wasSeconds) {
      normalizedSecondRows += 1;
    }

    const dedupeKey = `${serviceId}|${timestamp}|${agent}|${region}`;
    if (seen.has(dedupeKey)) {
      duplicateRows += 1;
      continue;
    }
    seen.add(dedupeKey);

    records.push({
      id: randomUUID(),
      batchId,
      serviceId,
      serviceName,
      timestamp,
      statusCode,
      latencyMs: latency.value,
      agent,
      region,
      isUp: statusCode >= 200 && statusCode < 400,
    });
  }

  records.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const summary: UploadSummary = {
    batchId,
    fileName,
    totalRows: rows.length,
    acceptedRows: records.length,
    rejectedRows: rows.length - records.length - duplicateRows,
    duplicateRows,
    missingLatencyRows,
    normalizedSecondRows,
    startedAt: records[0]?.timestamp ?? null,
    endedAt: records.at(-1)?.timestamp ?? null,
    issues: [
      ...Array.from(rejectedReasons.entries()).map(([reason, count]) => `${reason} (${count})`),
      duplicateRows ? `Dropped duplicate checks using service, timestamp, agent, and region. (${duplicateRows})` : "",
      missingLatencyRows ? `Kept rows with missing latency as null so availability is not biased. (${missingLatencyRows})` : "",
      normalizedSecondRows ? `Converted latency values reported in seconds to milliseconds. (${normalizedSecondRows})` : "",
    ].filter(Boolean),
  };

  return { summary, records };
}

function parseTimestamp(value?: string) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function normalizeLatency(value?: string, unit?: string) {
  if (!value) {
    return { kind: "missing" as const, value: null, wasSeconds: false };
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return { kind: "invalid" as const, value: null, wasSeconds: false };
  }

  if (unit === "s") {
    return { kind: "valid" as const, value: Math.round(numeric * 1000), wasSeconds: true };
  }

  return { kind: "valid" as const, value: Math.round(numeric), wasSeconds: false };
}

function addIssue(issues: Map<string, number>, reason: string) {
  issues.set(reason, (issues.get(reason) ?? 0) + 1);
}
