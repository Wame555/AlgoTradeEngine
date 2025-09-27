import { promises as fs } from "node:fs";
import path from "node:path";

export interface AccountSnapshotState {
  totalBalance: number;
  equity?: number;
  openPnL?: number;
  updatedAt: string;
}

const SNAPSHOT_DIR = path.resolve(process.cwd(), "server/.cache");
const SNAPSHOT_FILE = path.join(SNAPSHOT_DIR, "accountSnapshot.json");

let snapshot: AccountSnapshotState | null = null;
let writeTimer: NodeJS.Timeout | null = null;

async function ensureSnapshotDir(): Promise<void> {
  await fs.mkdir(SNAPSHOT_DIR, { recursive: true });
}

function serialize(state: AccountSnapshotState): string {
  return JSON.stringify(state, null, 2);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export async function loadAccountSnapshotFromDisk(): Promise<AccountSnapshotState | null> {
  try {
    const raw = await fs.readFile(SNAPSHOT_FILE, "utf8");
    const data = JSON.parse(raw) as Partial<AccountSnapshotState>;
    if (!isFiniteNumber(data.totalBalance)) {
      return null;
    }
    const result: AccountSnapshotState = {
      totalBalance: data.totalBalance,
      equity: isFiniteNumber(data.equity) ? data.equity : undefined,
      openPnL: isFiniteNumber(data.openPnL) ? data.openPnL : undefined,
      updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : new Date().toISOString(),
    };
    snapshot = result;
    return result;
  } catch (error: any) {
    if (error && error.code === "ENOENT") {
      return null;
    }
    console.warn(
      `[accountSnapshot] failed to load snapshot: ${(error as Error).message ?? error}`,
    );
    return null;
  }
}

async function persistSnapshot(): Promise<void> {
  if (!snapshot) {
    return;
  }
  try {
    await ensureSnapshotDir();
    await fs.writeFile(SNAPSHOT_FILE, serialize(snapshot), "utf8");
  } catch (error) {
    console.warn(
      `[accountSnapshot] failed to persist snapshot: ${(error as Error).message ?? error}`,
    );
  }
}

function schedulePersist(): void {
  if (writeTimer) {
    return;
  }
  writeTimer = setTimeout(() => {
    writeTimer = null;
    void persistSnapshot();
  }, 1000);
}

export function updateAccountSnapshot(data: Partial<AccountSnapshotState>): void {
  if (!snapshot) {
    snapshot = {
      totalBalance: 0,
      updatedAt: new Date().toISOString(),
    };
  }

  if (isFiniteNumber(data.totalBalance)) {
    snapshot.totalBalance = data.totalBalance;
  }
  if (isFiniteNumber(data.equity)) {
    snapshot.equity = data.equity;
  }
  if (isFiniteNumber(data.openPnL)) {
    snapshot.openPnL = data.openPnL;
  }
  snapshot.updatedAt = data.updatedAt ?? new Date().toISOString();
  schedulePersist();
}

export function getAccountSnapshot(): AccountSnapshotState | null {
  return snapshot;
}

export function resetAccountSnapshot(): void {
  snapshot = null;
}
