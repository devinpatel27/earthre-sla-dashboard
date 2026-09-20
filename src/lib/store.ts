import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { Pool } from "pg";
import { buildServiceStats } from "./stats";
import type { CheckRecord, DashboardData, UploadSummary } from "./types";

type FileDb = {
  activeBatchId: string | null;
  batches: UploadSummary[];
  records: CheckRecord[];
};

const fileDbPath = join(process.cwd(), ".data", "earthre-monitoring.json");
let pool: Pool | null = null;

export async function saveBatch(summary: UploadSummary, records: CheckRecord[]) {
  if (process.env.DATABASE_URL) {
    await saveToPostgres(summary, records);
    return;
  }

  const db = await readFileDb();
  const retainedRecords = db.records.filter((record) => record.batchId !== summary.batchId);
  const retainedBatches = db.batches.filter((batch) => batch.batchId !== summary.batchId);
  await writeFileDb({
    activeBatchId: summary.batchId,
    batches: [...retainedBatches, summary],
    records: [...retainedRecords, ...records],
  });
}

export async function getDashboardData(filters: { date?: string; start?: string; end?: string }): Promise<DashboardData> {
  if (process.env.DATABASE_URL) {
    return getPostgresDashboardData(filters);
  }

  const db = await readFileDb();
  const batch = db.batches.find((item) => item.batchId === db.activeBatchId) ?? db.batches.at(-1) ?? null;
  const records = filterRecords(
    db.records.filter((record) => !batch || record.batchId === batch.batchId),
    filters,
  );

  return {
    batch,
    stats: buildServiceStats(records),
    logs: records.slice(0, 500),
  };
}

async function readFileDb(): Promise<FileDb> {
  try {
    return JSON.parse(await readFile(fileDbPath, "utf8")) as FileDb;
  } catch {
    return { activeBatchId: null, batches: [], records: [] };
  }
}

async function writeFileDb(db: FileDb) {
  await mkdir(join(process.cwd(), ".data"), { recursive: true });
  await writeFile(fileDbPath, JSON.stringify(db), "utf8");
}

function filterRecords(records: CheckRecord[], filters: { date?: string; start?: string; end?: string }) {
  const start = filters.date ? `${filters.date}T00:00:00.000Z` : filters.start ? `${filters.start}T00:00:00.000Z` : null;
  const end = filters.date ? `${filters.date}T23:59:59.999Z` : filters.end ? `${filters.end}T23:59:59.999Z` : null;

  return records
    .filter((record) => (!start || record.timestamp >= start) && (!end || record.timestamp <= end))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

async function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
    });
  }
  return pool;
}

async function ensureSchema() {
  const pg = await getPool();
  await pg.query(`
    create table if not exists upload_batches (
      batch_id text primary key,
      file_name text not null,
      total_rows integer not null,
      accepted_rows integer not null,
      rejected_rows integer not null,
      duplicate_rows integer not null,
      missing_latency_rows integer not null,
      normalized_second_rows integer not null,
      started_at timestamptz,
      ended_at timestamptz,
      issues jsonb not null,
      created_at timestamptz not null default now()
    );

    create table if not exists monitoring_checks (
      id text primary key,
      batch_id text not null references upload_batches(batch_id) on delete cascade,
      service_id text not null,
      service_name text not null,
      checked_at timestamptz not null,
      status_code integer not null,
      latency_ms integer,
      agent text not null,
      region text not null,
      is_up boolean not null
    );

    create index if not exists monitoring_checks_batch_checked_idx
      on monitoring_checks(batch_id, checked_at desc);
  `);
}

async function saveToPostgres(summary: UploadSummary, records: CheckRecord[]) {
  await ensureSchema();
  const pg = await getPool();
  const client = await pg.connect();

  try {
    await client.query("begin");
    await client.query(
      `insert into upload_batches (
        batch_id, file_name, total_rows, accepted_rows, rejected_rows, duplicate_rows,
        missing_latency_rows, normalized_second_rows, started_at, ended_at, issues
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        summary.batchId,
        summary.fileName,
        summary.totalRows,
        summary.acceptedRows,
        summary.rejectedRows,
        summary.duplicateRows,
        summary.missingLatencyRows,
        summary.normalizedSecondRows,
        summary.startedAt,
        summary.endedAt,
        JSON.stringify(summary.issues),
      ],
    );

    for (const record of records) {
      await client.query(
        `insert into monitoring_checks (
          id, batch_id, service_id, service_name, checked_at, status_code,
          latency_ms, agent, region, is_up
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          record.id,
          record.batchId,
          record.serviceId,
          record.serviceName,
          record.timestamp,
          record.statusCode,
          record.latencyMs,
          record.agent,
          record.region,
          record.isUp,
        ],
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function getPostgresDashboardData(filters: { date?: string; start?: string; end?: string }): Promise<DashboardData> {
  await ensureSchema();
  const pg = await getPool();
  const batchResult = await pg.query("select * from upload_batches order by created_at desc limit 1");
  const batchRow = batchResult.rows[0];

  if (!batchRow) {
    return { batch: null, stats: [], logs: [] };
  }

  const allRecords = await pg.query(
    `select * from monitoring_checks where batch_id = $1 order by checked_at desc`,
    [batchRow.batch_id],
  );
  const records = filterRecords(allRecords.rows.map(rowToRecord), filters);

  return {
    batch: {
      batchId: batchRow.batch_id,
      fileName: batchRow.file_name,
      totalRows: batchRow.total_rows,
      acceptedRows: batchRow.accepted_rows,
      rejectedRows: batchRow.rejected_rows,
      duplicateRows: batchRow.duplicate_rows,
      missingLatencyRows: batchRow.missing_latency_rows,
      normalizedSecondRows: batchRow.normalized_second_rows,
      startedAt: batchRow.started_at?.toISOString() ?? null,
      endedAt: batchRow.ended_at?.toISOString() ?? null,
      issues: batchRow.issues,
    },
    stats: buildServiceStats(records),
    logs: records.slice(0, 500),
  };
}

function rowToRecord(row: Record<string, unknown>): CheckRecord {
  return {
    id: String(row.id),
    batchId: String(row.batch_id),
    serviceId: String(row.service_id),
    serviceName: String(row.service_name),
    timestamp: new Date(String(row.checked_at)).toISOString(),
    statusCode: Number(row.status_code),
    latencyMs: row.latency_ms === null ? null : Number(row.latency_ms),
    agent: String(row.agent),
    region: String(row.region),
    isUp: Boolean(row.is_up),
  };
}
