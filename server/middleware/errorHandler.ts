import type { ErrorRequestHandler } from "express";

export class MissingDataError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message = "Missing data", status = 200) {
    super(message);
    this.name = "MissingDataError";
    this.status = status;
    this.code = "MISSING_DATA";
  }
}

type ErrorWithMetadata = Partial<{
  status: number;
  code: string;
  details: unknown;
}>;

function isMissingData(error: unknown): error is MissingDataError {
  if (error instanceof MissingDataError) {
    return true;
  }
  if (typeof error === "object" && error !== null) {
    const candidate = error as ErrorWithMetadata;
    return candidate.code === "MISSING_DATA";
  }
  return false;
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const message = err instanceof Error && err.message ? err.message : "Internal Server Error";
  const metadata: ErrorWithMetadata = typeof err === "object" && err !== null ? (err as ErrorWithMetadata) : {};

  if (isMissingData(err)) {
    console.info(`[fallback] ${req.method} ${req.originalUrl}: ${message}`);
    res.status(200).json({ error: false, message, fallback: true });
    return;
  }

  const status = typeof metadata.status === "number" && metadata.status >= 400 ? metadata.status : 500;

  if (status >= 500) {
    console.error(`[error] ${req.method} ${req.originalUrl}: ${message}`, err);
  } else {
    console.warn(`[warn] ${req.method} ${req.originalUrl}: ${message}`);
  }

  const payload: Record<string, unknown> = { error: true, message };
  if (metadata.details != null) {
    payload.details = metadata.details;
  }
  res.status(status).json(payload);
};
