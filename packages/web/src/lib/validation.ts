/** Validate that a value is a non-empty string within a max length. Returns error message or null. */
export function validateString(
  value: unknown,
  fieldName: string,
  maxLength: number,
): string | null {
  if (value === undefined || value === null) {
    return `${fieldName} is required`;
  }
  if (typeof value !== "string") {
    return `${fieldName} must be a string`;
  }
  if (value.trim().length === 0) {
    return `${fieldName} must not be empty`;
  }
  if (value.length > maxLength) {
    return `${fieldName} must be at most ${maxLength} characters`;
  }
  return null;
}

/** Validate that a value matches a safe identifier pattern (alphanumeric, hyphens, underscores). */
export function validateIdentifier(
  value: unknown,
  fieldName: string,
  maxLength = 128,
): string | null {
  const strErr = validateString(value, fieldName, maxLength);
  if (strErr) return strErr;
  if (!/^[a-zA-Z0-9_-]+$/.test(value as string)) {
    return `${fieldName} must match [a-zA-Z0-9_-]+`;
  }
  return null;
}
