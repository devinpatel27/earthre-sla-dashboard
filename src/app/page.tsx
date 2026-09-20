"use client";

import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Database, FileUp, RefreshCw } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { DashboardData, UploadSummary } from "@/lib/types";
import styles from "./page.module.css";

const emptyDashboard: DashboardData = { batch: null, stats: [], logs: [] };

export default function Home() {
  const [dashboard, setDashboard] = useState<DashboardData>(emptyDashboard);
  const [file, setFile] = useState<File | null>(null);
  const [date, setDate] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [statsOpen, setStatsOpen] = useState(true);

  const overall = useMemo(() => {
    const total = dashboard.stats.reduce((sum, item) => sum + item.totalChecks, 0);
    const up = dashboard.stats.reduce((sum, item) => sum + item.upChecks, 0);
    return {
      availability: total ? (up / total) * 100 : 0,
      total,
      failed: total - up,
      breachCount: dashboard.stats.filter((item) => item.availability < 99.9).length,
    };
  }, [dashboard.stats]);

  async function loadDashboard(nextFilters = { date, start, end }) {
    const params = new URLSearchParams();
    if (nextFilters.date) {
      params.set("date", nextFilters.date);
    } else {
      if (nextFilters.start) params.set("start", nextFilters.start);
      if (nextFilters.end) params.set("end", nextFilters.end);
    }
    const response = await fetch(`/api/dashboard?${params.toString()}`);
    setDashboard(await response.json());
  }

  useEffect(() => {
    let ignore = false;

    fetch("/api/dashboard")
      .then((response) => response.json())
      .then((data: DashboardData) => {
        if (!ignore) {
          setDashboard(data);
        }
      });

    return () => {
      ignore = true;
    };
  }, []);

  async function uploadCsv(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setMessage("Choose a monitoring CSV first.");
      return;
    }

    setBusy(true);
    setMessage("Processing upload in the serverless function...");
    const body = new FormData();
    body.append("file", file);

    const response = await fetch("/api/upload", { method: "POST", body });
    if (!response.ok) {
      setMessage("Upload failed. Check the CSV format and try again.");
      setBusy(false);
      return;
    }

    const result = (await response.json()) as { summary: UploadSummary };
    setDate("");
    setStart("");
    setEnd("");
    await loadDashboard({ date: "", start: "", end: "" });
    setMessage(`Loaded ${result.summary.acceptedRows.toLocaleString()} clean checks from ${result.summary.fileName}.`);
    setBusy(false);
  }

  async function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await loadDashboard({ date, start, end });
  }

  return (
    <main className={styles.shell}>
      <section className={styles.header}>
        <div>
          <p className={styles.eyebrow}>EarthRe SLA monitoring</p>
          <h1>Upload messy health checks, audit clean SLA results.</h1>
        </div>
        <div className={styles.healthBadge}>
          {overall.breachCount ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
          {overall.breachCount ? `${overall.breachCount} SLA risk${overall.breachCount > 1 ? "s" : ""}` : "All services clear"}
        </div>
      </section>

      <section className={styles.uploadBand}>
        <form onSubmit={uploadCsv} className={styles.uploadForm}>
          <label>
            <span>Monitoring CSV</span>
            <input type="file" accept=".csv,text/csv" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          </label>
          <button disabled={busy} type="submit">
            {busy ? <RefreshCw size={18} /> : <FileUp size={18} />}
            {busy ? "Processing" : "Upload and process"}
          </button>
        </form>
        <p className={styles.message}>{message || "Cleaned data is persisted after upload and can be queried again later."}</p>
      </section>

      <section className={styles.statsPanel}>
        <button className={styles.panelToggle} type="button" onClick={() => setStatsOpen((value) => !value)}>
          <span>Stats</span>
          {statsOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>

        {statsOpen ? (
          <>
            <div className={styles.kpiGrid}>
              <Kpi label="Availability" value={`${overall.availability.toFixed(3)}%`} />
              <Kpi label="Checks analyzed" value={overall.total.toLocaleString()} />
              <Kpi label="Failed checks" value={overall.failed.toLocaleString()} />
              <Kpi label="SLA threshold" value="99.900%" />
            </div>

            {dashboard.batch ? (
              <div className={styles.batchMeta}>
                <Database size={18} />
                <span>
                  {dashboard.batch.fileName} · {formatDate(dashboard.batch.startedAt)} to {formatDate(dashboard.batch.endedAt)} ·{" "}
                  {dashboard.batch.rejectedRows} rejected · {dashboard.batch.duplicateRows} duplicates removed
                </span>
              </div>
            ) : null}

            <div className={styles.serviceGrid}>
              {dashboard.stats.map((service) => (
                <article className={styles.serviceCard} key={service.serviceId}>
                  <div>
                    <h2>{service.serviceName}</h2>
                    <p>{service.serviceId}</p>
                  </div>
                  <strong className={service.availability < 99.9 ? styles.risk : styles.ok}>{service.availability.toFixed(3)}%</strong>
                  <dl>
                    <div>
                      <dt>Failures</dt>
                      <dd>{service.failedChecks}</dd>
                    </div>
                    <div>
                      <dt>P95 latency</dt>
                      <dd>{service.p95LatencyMs === null ? "n/a" : `${service.p95LatencyMs} ms`}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>

            {dashboard.batch?.issues.length ? (
              <ul className={styles.issueList}>
                {dashboard.batch.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
      </section>

      <section className={styles.logsPanel}>
        <form className={styles.filterBar} onSubmit={applyFilters}>
          <label>
            <span>Single date</span>
            <input value={date} type="date" onChange={(event) => setDate(event.target.value)} />
          </label>
          <label>
            <span>Range start</span>
            <input value={start} type="date" disabled={Boolean(date)} onChange={(event) => setStart(event.target.value)} />
          </label>
          <label>
            <span>Range end</span>
            <input value={end} type="date" disabled={Boolean(date)} onChange={(event) => setEnd(event.target.value)} />
          </label>
          <button type="submit">Apply filters</button>
        </form>

        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Service</th>
                <th>Status</th>
                <th>Latency</th>
                <th>Agent</th>
                <th>Region</th>
              </tr>
            </thead>
            <tbody>
              {dashboard.logs.map((log) => (
                <tr key={log.id}>
                  <td>{formatDate(log.timestamp)}</td>
                  <td>{log.serviceName}</td>
                  <td className={log.isUp ? styles.ok : styles.risk}>{log.statusCode}</td>
                  <td>{log.latencyMs === null ? "n/a" : `${log.latencyMs} ms`}</td>
                  <td>{log.agent}</td>
                  <td>{log.region}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!dashboard.logs.length ? <p className={styles.empty}>Upload a CSV or change the date filter.</p> : null}
        </div>
      </section>
    </main>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <article className={styles.kpi}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function formatDate(value: string | null) {
  if (!value) {
    return "n/a";
  }
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}
