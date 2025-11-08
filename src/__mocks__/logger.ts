import { vi } from "vitest";

export const logger = {
  debug: vi.fn(),
  error: vi.fn(),
  header: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  warn: vi.fn(),
};
