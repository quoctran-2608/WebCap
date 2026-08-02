function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }
}

/**
 * Restricts a finite number to an inclusive finite range.
 *
 * This primitive will be reused by coordinate, progress, and image-quality
 * calculations. Invalid ranges fail loudly so capture math cannot silently
 * produce corrupted geometry.
 */
export function clamp(value: number, minimum: number, maximum: number): number {
  assertFinite(value, "value");
  assertFinite(minimum, "minimum");
  assertFinite(maximum, "maximum");

  if (minimum > maximum) {
    throw new RangeError("minimum must be less than or equal to maximum.");
  }

  return Math.min(maximum, Math.max(minimum, value));
}
