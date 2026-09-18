export type CheckRecord = {
  id: string;
  batchId: string;
  serviceId: string;
  serviceName: string;
  timestamp: string;
  statusCode: number;
  latencyMs: number | null;
  agent: string;
  region: string;
  isUp: boolean;
};

export type UploadSummary = {
  batchId: string;
  fileName: string;
  totalRows: number;
  acceptedRows: number;
  rejectedRows: number;
  duplicateRows: number;
  missingLatencyRows: number;
  normalizedSecondRows: number;
  startedAt: string | null;
  endedAt: string | null;
  issues: string[];
};

export type ServiceStat = {
  serviceId: string;
  serviceName: string;
  totalChecks: number;
  upChecks: number;
  failedChecks: number;
  availability: number;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
};

export type DashboardData = {
  batch: UploadSummary | null;
  stats: ServiceStat[];
  logs: CheckRecord[];
};
