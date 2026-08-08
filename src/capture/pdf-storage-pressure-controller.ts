export type PdfStoragePressureLevel = "unknown" | "healthy" | "pressure" | "critical";

export interface PdfStoragePressureDecision {
  level: PdfStoragePressureLevel;
  reserveBytes: number;
  requestedBytes: number;
  minimumProgressBytes: number;
  safeBatchBytes?: number;
  availableBytes?: number;
  quotaBytes?: number;
  usageBytes?: number;
  pauseRequired: boolean;
}

export interface PdfStoragePressurePort {
  assess(requestedBytes: number, minimumProgressBytes: number): Promise<PdfStoragePressureDecision>;
}

export interface PdfStoragePressureControllerOptions {
  estimate?: () => Promise<StorageEstimate>;
  reserveBytes?: number;
  pressureHeadroomRatio?: number;
}

export const PDF_STORAGE_RESERVE_BYTES = 16 * 1024 * 1024;
const DEFAULT_PRESSURE_HEADROOM_RATIO = 1.5;

function boundedBytes(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.max(1, Math.floor(value));
}

export class PdfStoragePressureController implements PdfStoragePressurePort {
  private readonly estimate: () => Promise<StorageEstimate>;
  private readonly reserveBytes: number;
  private readonly pressureHeadroomRatio: number;

  constructor(options: PdfStoragePressureControllerOptions = {}) {
    this.estimate = options.estimate ?? (() => navigator.storage.estimate());
    this.reserveBytes = Math.max(0, Math.floor(options.reserveBytes ?? PDF_STORAGE_RESERVE_BYTES));
    this.pressureHeadroomRatio = Math.max(
      1,
      options.pressureHeadroomRatio ?? DEFAULT_PRESSURE_HEADROOM_RATIO,
    );
  }

  async assess(
    requestedBytesInput: number,
    minimumProgressBytesInput: number,
  ): Promise<PdfStoragePressureDecision> {
    const requestedBytes = boundedBytes(requestedBytesInput);
    const minimumProgressBytes = boundedBytes(minimumProgressBytesInput);
    let estimate: StorageEstimate;
    try {
      estimate = await this.estimate();
    } catch {
      return {
        level: "unknown",
        reserveBytes: this.reserveBytes,
        requestedBytes,
        minimumProgressBytes,
        pauseRequired: false,
      };
    }

    const quota = estimate.quota;
    const usage = estimate.usage;
    if (
      quota === undefined ||
      usage === undefined ||
      !Number.isFinite(quota) ||
      !Number.isFinite(usage)
    ) {
      return {
        level: "unknown",
        reserveBytes: this.reserveBytes,
        requestedBytes,
        minimumProgressBytes,
        pauseRequired: false,
      };
    }

    const availableBytes = Math.max(0, Math.floor(quota - usage - this.reserveBytes));
    const base = {
      reserveBytes: this.reserveBytes,
      requestedBytes,
      minimumProgressBytes,
      availableBytes,
      quotaBytes: Math.max(0, Math.floor(quota)),
      usageBytes: Math.max(0, Math.floor(usage)),
    };
    if (availableBytes < minimumProgressBytes) {
      return {
        ...base,
        level: "critical",
        safeBatchBytes: availableBytes,
        pauseRequired: true,
      };
    }

    const pressureThreshold = Math.ceil(requestedBytes * this.pressureHeadroomRatio);
    if (availableBytes < pressureThreshold) {
      return {
        ...base,
        level: "pressure",
        safeBatchBytes: Math.max(minimumProgressBytes, Math.min(requestedBytes, availableBytes)),
        pauseRequired: false,
      };
    }

    return {
      ...base,
      level: "healthy",
      safeBatchBytes: requestedBytes,
      pauseRequired: false,
    };
  }
}
