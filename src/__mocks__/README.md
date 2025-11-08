# Mocks Directory

This directory contains centralized mock implementations for commonly mocked modules across test files.

## Available Mocks

### `logger.ts`
Mock for `../utils/logger` with all logging methods stubbed:
- `debug`, `error`, `header`, `info`, `log`, `warn`

### `file.ts`
Mock for `../utils/file` with common file operations stubbed:
- `checkFolder`, `getDateModified`, `getFileList`, `removeFile`, `renameFile`

## Usage

Instead of defining inline mocks in each test file:

```typescript
// ❌ Don't do this
vi.mock("../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));
```

Simply use the centralized mock:

```typescript
// ✅ Do this
vi.mock("../utils/logger");
```

Vitest will automatically use the mock from this `__mocks__` directory.

## Adding New Mocks

When you find yourself mocking the same module in multiple test files:

1. Create a new file in this directory matching the module name
2. Export mocked versions of the module's exports
3. Update test files to use `vi.mock("module-path")` without inline implementation

## Benefits

- **DRY**: Don't repeat mock definitions across test files
- **Consistency**: All tests use the same mock implementation
- **Maintainability**: Update mocks in one place when the API changes
- **Simplicity**: Cleaner test files with less boilerplate
