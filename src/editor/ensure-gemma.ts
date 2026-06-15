import { spawnSync } from "node:child_process";
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import { getAppConfig } from "../config";

type OllamaTagsResponse = {
  models?: Array<{
    name?: string;
    model?: string;
  }>;
};

const composeArgs = ["compose", "-f", "docker-compose.gemma.yml"];

const getTagsUrl = (): string => {
  const appConfig = getAppConfig();
  const baseUrl = new URL(appConfig.gemma.apiUrl);
  return new URL("/api/tags", baseUrl).toString();
};

const requestJson = (urlValue: string, timeoutMs: number): Promise<unknown> => {
  const url = new URL(urlValue);
  const client = url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const request = client.request(
      url,
      {
        method: "GET",
        timeout: timeoutMs,
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
        });
        response.on("end", () => {
          const statusCode = response.statusCode ?? 0;
          if (statusCode < 200 || statusCode >= 300) {
            reject(new Error(`Gemma health check failed with status ${statusCode}.`));
            return;
          }

          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(
              error instanceof Error
                ? error
                : new Error("Failed to parse Gemma health response."),
            );
          }
        });
      },
    );

    request.on("timeout", () => {
      request.destroy(new Error("Gemma health check timed out."));
    });

    request.on("error", (error) => {
      reject(error);
    });

    request.end();
  });
};

const runDockerCommand = (args: string[], failureMessage: string): void => {
  const result = spawnSync("docker", [...composeArgs, ...args], {
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(failureMessage);
  }
};

const listModelNames = (payload: unknown): string[] => {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const response = payload as OllamaTagsResponse;
  if (!Array.isArray(response.models)) {
    return [];
  }

  return response.models
    .flatMap((model) => [model.name, model.model])
    .filter((value): value is string => typeof value === "string");
};

const waitForGemma = async (tagsUrl: string, timeoutMs: number): Promise<OllamaTagsResponse> => {
  const deadline = Date.now() + timeoutMs;
  let lastError: Error | null = null;

  while (Date.now() < deadline) {
    try {
      const payload = await requestJson(tagsUrl, 5000);
      return payload as OllamaTagsResponse;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  throw new Error(
    `Timed out waiting for Gemma to become ready.${lastError ? ` Last error: ${lastError.message}` : ""}`,
  );
};

const ensureGemma = async (): Promise<void> => {
  const appConfig = getAppConfig();
  const tagsUrl = getTagsUrl();

  let tagsPayload: OllamaTagsResponse | null = null;

  try {
    tagsPayload = (await requestJson(tagsUrl, 5000)) as OllamaTagsResponse;
    console.log(`Gemma service already reachable at ${tagsUrl}.`);
  } catch {
    console.log("Gemma service is not reachable. Starting the local container...");
    runDockerCommand(["up", "-d", "gemma"], "Failed to start the Gemma container.");
    tagsPayload = await waitForGemma(tagsUrl, appConfig.gemma.timeoutMs);
    console.log("Gemma service is now healthy.");
  }

  const availableModels = listModelNames(tagsPayload);
  const hasModel = availableModels.some((name) => name === appConfig.gemma.model);

  if (hasModel) {
    console.log(`Gemma model '${appConfig.gemma.model}' is ready.`);
    return;
  }

  console.log(
    `Gemma model '${appConfig.gemma.model}' is missing. Pulling it now. This can take a while for the first download...`,
  );
  runDockerCommand(["run", "--rm", "gemma-init"], "Failed to pull the Gemma model.");
  const refreshedTags = await waitForGemma(tagsUrl, appConfig.gemma.timeoutMs);
  const refreshedModels = listModelNames(refreshedTags);

  if (!refreshedModels.some((name) => name === appConfig.gemma.model)) {
    throw new Error(`Gemma model '${appConfig.gemma.model}' is still unavailable after pull.`);
  }

  console.log(`Gemma model '${appConfig.gemma.model}' is ready.`);
};

void ensureGemma().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
