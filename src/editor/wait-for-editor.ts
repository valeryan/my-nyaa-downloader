const editorApiUrl = process.env.EDITOR_API_URL ?? "http://127.0.0.1:4310/api/health";
const timeoutMs = Number.parseInt(process.env.EDITOR_API_WAIT_MS ?? "15000", 10);
const pollIntervalMs = 250;

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const isReachable = async (): Promise<boolean> => {
  try {
    const response = await fetch(editorApiUrl);
    return response.ok;
  } catch {
    return false;
  }
};

const main = async (): Promise<void> => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await isReachable()) {
      return;
    }
    await sleep(pollIntervalMs);
  }

  throw new Error(`Editor API did not become ready at ${editorApiUrl} within ${timeoutMs}ms.`);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
