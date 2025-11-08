import { vi } from "vitest";

export const checkFolder = vi.fn();
export const getDateModified = vi.fn(() => new Date());
export const getFileList = vi.fn(() => ({}));
export const removeFile = vi.fn();
export const renameFile = vi.fn();
