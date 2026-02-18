import { describe, it, expect } from "vitest";
import { percentile, normalizeRoutePath } from "../utils.js";

describe("percentile", () => {
  it("returns 0 for empty array", () => {
    expect(percentile([], 50)).toBe(0);
  });

  it("returns the single element for single-element array", () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 95)).toBe(42);
    expect(percentile([42], 99)).toBe(42);
  });

  it("returns correct p50 for odd-length array", () => {
    expect(percentile([10, 20, 30, 40, 50], 50)).toBe(30);
  });

  it("returns correct p95 for larger array", () => {
    // 20 elements, p95 = ceil(0.95 * 20) - 1 = ceil(19) - 1 = 18
    const sorted = Array.from({ length: 20 }, (_, i) => (i + 1) * 10);
    expect(percentile(sorted, 95)).toBe(190);
  });

  it("returns correct p99 for larger array", () => {
    // 100 elements, p99 = ceil(0.99 * 100) - 1 = 99 - 1 = 98
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(sorted, 99)).toBe(99);
  });

  it("handles p=0 by returning the first element", () => {
    // p=0: idx = ceil(0) - 1 = -1, clamped to 0
    expect(percentile([10, 20, 30], 0)).toBe(10);
  });

  it("handles p=100 by returning the last element", () => {
    // p=100: idx = ceil(1 * 3) - 1 = 2
    expect(percentile([10, 20, 30], 100)).toBe(30);
  });

  it("returns correct p50 for even-length array", () => {
    // 4 elements, p50 = ceil(0.5 * 4) - 1 = ceil(2) - 1 = 1
    expect(percentile([10, 20, 30, 40], 50)).toBe(20);
  });
});

describe("normalizeRoutePath", () => {
  it("replaces /sessions/<id> with /sessions/:id", () => {
    expect(normalizeRoutePath("/sessions/abc123")).toBe("/sessions/:id");
  });

  it("replaces /prs/<id> with /prs/:id", () => {
    expect(normalizeRoutePath("/prs/456")).toBe("/prs/:id");
  });

  it("handles paths with both sessions and prs segments", () => {
    expect(normalizeRoutePath("/api/sessions/abc/prs/123")).toBe(
      "/api/sessions/:id/prs/:id",
    );
  });

  it("leaves paths without dynamic segments unchanged", () => {
    expect(normalizeRoutePath("/api/health")).toBe("/api/health");
    expect(normalizeRoutePath("/")).toBe("/");
  });

  it("handles multiple session segments", () => {
    expect(normalizeRoutePath("/sessions/a/sessions/b")).toBe(
      "/sessions/:id/sessions/:id",
    );
  });

  it("preserves query strings and trailing slashes", () => {
    // normalizeRoutePath only replaces path segments; everything else passes through
    expect(normalizeRoutePath("/sessions/abc123/details")).toBe(
      "/sessions/:id/details",
    );
  });
});
