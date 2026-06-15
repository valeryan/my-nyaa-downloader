import { getAppConfig } from "../config";
import { scrapeNyaaViewPage } from "../services/nyaa";
import { inspectTorrentFiles } from "../services/torrent-metadata";
import type {
  DownloadEntry,
  ImportFolderSuggestion,
  ImportFromLinkService,
  ImportPatternSuggestion,
  ImportPlacementSuggestion,
  ImportSuggestion,
  ImportSuggestionContext,
  ImportSuggestionProvider,
  ImportSuggestionReasons,
  ImportTargetSection,
} from "../types";
import { resolveAnimePattern, validatePattern } from "../utils/episode";
import { patterns } from "../utils/patterns";
import { logger } from "../utils/logger";

type ImportServiceDependencies = {
  inspectTorrentFiles?: (magnetLink: string) => Promise<string[]>;
  provider?: ImportSuggestionProvider;
};

type OllamaGenerateResponse = {
  response?: string;
};

type PlacementResponse = {
  isEcchi?: unknown;
  warnings?: unknown;
  reasons?: unknown;
};

type FolderResponse = {
  folder?: unknown;
  query?: unknown;
  warnings?: unknown;
  reasons?: unknown;
};

type PatternResponse = {
  pattern?: unknown;
  warnings?: unknown;
  reasons?: unknown;
};

const emptyPatternEntry: DownloadEntry = {
  folder: "",
  uploader: "",
  query: "",
  complete: false,
};

const normalizeText = (value: string): string => value.replace(/\s+/g, " ").trim();

const getTimeoutSignal = (timeoutMs: number): AbortSignal => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
};

const truncateText = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...`;
};

const dedupe = (items: string[]): string[] => [...new Set(items.filter((item) => item.trim()))];

const normalizeUploader = (value: string | undefined): string => {
  const normalized = normalizeText(value ?? "");
  if (!normalized || normalized.toLowerCase() === "anonymous") {
    return "Anonymous";
  }
  return normalized;
};

const getReasonValue = (candidate: Record<string, unknown>, keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = candidate[key];
    if (typeof value === "string" && value.trim()) {
      return normalizeText(value);
    }
  }
  return undefined;
};

const parseWarnings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((warning): warning is string => typeof warning === "string").map(normalizeText)
    : [];

const parseReasons = (
  value: unknown,
  preferredKeys?: Array<keyof ImportSuggestionReasons>,
): Partial<ImportSuggestionReasons> | undefined => {
  if (typeof value === "string" && value.trim()) {
    const reason = normalizeText(value);
    if (!preferredKeys?.length) {
      return undefined;
    }

    return preferredKeys.reduce<Partial<ImportSuggestionReasons>>((acc, key) => {
      acc[key] = reason;
      return acc;
    }, {});
  }

  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  const reasons: Partial<ImportSuggestionReasons> = {};

  const placement = getReasonValue(candidate, ["placementReason", "groupReason", "categoryReason", "placement"]);
  const section = getReasonValue(candidate, ["sectionReason", "section"]);
  const folder = getReasonValue(candidate, ["folderReason", "titleReason", "folder"]);
  const query = getReasonValue(candidate, ["queryReason", "searchReason", "query"]);
  const pattern = getReasonValue(candidate, ["patternReason", "regexReason", "pattern"]);

  if (placement) reasons.placement = placement;
  if (section) reasons.section = section;
  if (folder) reasons.folder = folder;
  if (query) reasons.query = query;
  if (pattern) reasons.pattern = pattern;

  return Object.keys(reasons).length > 0 ? reasons : undefined;
};

const getRepresentativeFiles = (context: ImportSuggestionContext): string[] =>
  context.viewPage.fileList.length > 0 ? context.viewPage.fileList : context.torrentFiles;

const buildDefaultGroup = (context: ImportSuggestionContext, warnings: string[]): string => {
  if (context.viewPage.sourceSite === "sukebei" && context.allowedGroups.includes("Ecchi")) {
    return "Ecchi";
  }

  if (context.allowedGroups.includes("Anime")) {
    return "Anime";
  }

  warnings.push(
    context.viewPage.sourceSite === "sukebei"
      ? "Ecchi group is not configured, so this Sukebei import fell back to the first available group."
      : "Anime group is not configured, so this import fell back to the first available group.",
  );
  return context.allowedGroups[0];
};

const buildSectionDecision = (context: ImportSuggestionContext): {
  suggestedSection: ImportTargetSection;
  reason: string;
} => {
  const files = getRepresentativeFiles(context);
  if (files.length >= 2) {
    const sourceLabel = context.viewPage.fileList.length > 0 ? "page file list" : "torrent metadata";
    return {
      suggestedSection: "seasonPacks",
      reason: `seasonPacks was selected because ${sourceLabel} contains ${files.length} files.`,
    };
  }

  return {
    suggestedSection: "regular",
    reason: "regular was selected because the available file list did not show multiple files.",
  };
};

const shouldAskPlacementAi = (context: ImportSuggestionContext): boolean =>
  context.viewPage.sourceSite === "nyaa" &&
  context.allowedGroups.includes("Ecchi") &&
  context.defaultGroup === "Anime";

const shouldRequestCustomPattern = (context: ImportSuggestionContext): boolean => {
  const samples = [context.viewPage.title, ...getRepresentativeFiles(context)]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .slice(0, 12);

  if (!samples.length) {
    return false;
  }

  return !samples.some((sample) => resolveAnimePattern(emptyPatternEntry, sample).resolvedPattern);
};

const createPlacementPrompt = (context: ImportSuggestionContext): string => {
  const payload = {
    sourceSite: context.viewPage.sourceSite,
    rawTitle: context.viewPage.title,
    category: context.viewPage.category,
    description: truncateText(context.viewPage.description, 500),
    infoRows: context.viewPage.infoRows,
    fileList: context.viewPage.fileList.slice(0, 20).map((file) => truncateText(file, 180)),
  };

  return [
    "Decide whether a normal Nyaa torrent page appears to be adult sexual content.",
    "Return JSON only.",
    "Return keys: isEcchi, reasons, warnings.",
    'reasons must be an object with a placement string: { "placement": "..." }.',
    "In this app, isEcchi=true means the entry should go in the Ecchi group because it looks like adult, sexual, explicit, pornographic, hentai, or otherwise mature erotic content.",
    "Do not use isEcchi=true for ordinary anime, romance, fanservice, or suggestive but non-explicit content unless the page clearly indicates actual adult sexual material.",
    "If the page looks like normal non-adult anime, return isEcchi as false.",
    "reasons should include placement and mention the specific evidence.",
    "Input JSON:",
    JSON.stringify(payload),
  ].join("\n");
};

const createFolderPrompt = (context: ImportSuggestionContext): string => {
  const payload = {
    rawTitle: context.viewPage.title,
    category: context.viewPage.category,
    description: truncateText(context.viewPage.description, 600),
    pageFileList: context.viewPage.fileList.slice(0, 20).map((file) => truncateText(file, 180)),
    torrentFiles: context.torrentFiles.slice(0, 20).map((file) => truncateText(file, 180)),
  };

  return [
    "Fill two form fields from a torrent page: folder and query.",
    "Return JSON only.",
    "Return keys: folder, query, reasons, warnings.",
    'reasons must be an object with string fields for folder and query: { "folder": "...", "query": "..." }.',
    "folder should be the series folder name that best fits this release.",
    "If the raw title contains a clear English title, including one in parentheses, prefer that English series title for folder.",
    "When the raw title has both a romanized title and a clear English title in parentheses, prefer only the English title for folder instead of combining both.",
    "query must be an exact substring of rawTitle.",
    "query is for Nyaa search recall, not for reconstructing the full title.",
    "Prefer the earliest distinctive prefix of rawTitle that is likely to find this exact release again.",
    "In this project, a good query often keeps the leading release tag like [Sav1or] or [SubsPlease] plus the main title.",
    "Do not append extra alternate-title text in parentheses or other later title fragments unless they are truly needed to make the search specific enough.",
    "Stop before any season-specific or episode-specific text.",
    "Do not include season numbers, episode numbers, cour numbers, part numbers, batch markers, or other title parts that the episode/season pattern logic should handle separately.",
    "If you are unsure, return an empty string instead of guessing wildly.",
    "When you provide folder or query, reasons should include folder and query and explain the evidence used.",
    "Input JSON:",
    JSON.stringify(payload),
  ].join("\n");
};

const createPatternPrompt = (context: ImportSuggestionContext): string => {
  const sampleTitles = [context.viewPage.title, ...getRepresentativeFiles(context)]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .slice(0, 12)
    .map((value) => truncateText(value, 180));

  const payload = {
    defaultPatterns: patterns.defaultPatterns.map((pattern) => pattern.source),
    sampleTitles,
  };

  return [
    "Decide whether this torrent naming style needs a custom episode regex.",
    "Return JSON only.",
    "Return keys: pattern, reasons, warnings.",
    'reasons must be an object with a pattern string when provided: { "pattern": "..." }.',
    "pattern must be a bare regex source string with exactly two capture groups: season and episode.",
    "If no trustworthy custom pattern is needed, return an empty string.",
    "reasons may include pattern.",
    "Input JSON:",
    JSON.stringify(payload),
  ].join("\n");
};

export const createGemmaImportSuggestionProvider = (): ImportSuggestionProvider => {
  const requestGemmaJson = async (label: string, prompt: string): Promise<unknown> => {
    const appConfig = getAppConfig();
    const response = await fetch(appConfig.gemma.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: getTimeoutSignal(appConfig.gemma.timeoutMs),
      body: JSON.stringify({
        model: appConfig.gemma.model,
        prompt,
        stream: false,
        format: "json",
      }),
    });

    if (!response.ok) {
      throw new Error(`Gemma request failed (${response.status}).`);
    }

    const body = (await response.json()) as OllamaGenerateResponse;
    if (!body.response) {
      throw new Error("Gemma response was missing generated content.");
    }

    try {
      const parsed = JSON.parse(body.response);
      logger.debug(`Gemma ${label} response:`, parsed);
      return parsed;
    } catch {
      logger.debug(`Gemma ${label} raw response text:`, body.response);
      throw new Error("Gemma returned invalid JSON.");
    }
  };

  return {
    generatePlacementSuggestion: async (context): Promise<ImportPlacementSuggestion> => {
      const parsed = await requestGemmaJson("placement", createPlacementPrompt(context));
      if (typeof parsed !== "object" || parsed === null) {
        throw new Error("Gemma returned an invalid placement payload.");
      }

      const candidate = parsed as PlacementResponse;
      if (typeof candidate.isEcchi !== "boolean") {
        throw new Error("Gemma returned a malformed placement payload.");
      }

      return {
        isEcchi: candidate.isEcchi,
        warnings: parseWarnings(candidate.warnings),
        reasons: parseReasons(candidate.reasons ?? candidate, ["placement"]) as Pick<ImportSuggestionReasons, "placement"> | undefined,
      };
    },
    generateFolderSuggestion: async (context): Promise<ImportFolderSuggestion> => {
      const parsed = await requestGemmaJson("folder-query", createFolderPrompt(context));
      if (typeof parsed !== "object" || parsed === null) {
        throw new Error("Gemma returned an invalid folder payload.");
      }

      const candidate = parsed as FolderResponse;
      if (
        (candidate.folder !== undefined && typeof candidate.folder !== "string") ||
        (candidate.query !== undefined && typeof candidate.query !== "string")
      ) {
        throw new Error("Gemma returned a malformed folder payload.");
      }

      return {
        ...(typeof candidate.folder === "string" ? { folder: normalizeText(candidate.folder) } : {}),
        ...(typeof candidate.query === "string" ? { query: normalizeText(candidate.query) } : {}),
        warnings: parseWarnings(candidate.warnings),
        reasons: parseReasons(candidate.reasons ?? candidate, ["folder", "query"]) as Pick<ImportSuggestionReasons, "folder" | "query"> | undefined,
      };
    },
    generatePatternSuggestion: async (context): Promise<ImportPatternSuggestion> => {
      const parsed = await requestGemmaJson("pattern", createPatternPrompt(context));
      if (typeof parsed !== "object" || parsed === null) {
        throw new Error("Gemma returned an invalid pattern payload.");
      }

      const candidate = parsed as PatternResponse;
      if (candidate.pattern !== undefined && candidate.pattern !== null && typeof candidate.pattern !== "string") {
        throw new Error("Gemma returned a malformed pattern payload.");
      }

      const pattern = typeof candidate.pattern === "string" ? candidate.pattern.trim() : "";
      return {
        ...(pattern ? { pattern } : {}),
        warnings: parseWarnings(candidate.warnings),
        reasons: parseReasons(candidate.reasons ?? candidate, ["pattern"]) as Pick<ImportSuggestionReasons, "pattern"> | undefined,
      };
    },
  };
};

export const createImportFromLinkService = (
  dependencies: ImportServiceDependencies = {},
): ImportFromLinkService => {
  const metadataInspector = dependencies.inspectTorrentFiles ?? inspectTorrentFiles;
  const provider = dependencies.provider ?? createGemmaImportSuggestionProvider();

  return async (url: string, allowedGroups: string[]): Promise<ImportSuggestion> => {
    if (!allowedGroups.length) {
      throw new Error("No download groups are configured for imports.");
    }

    const viewPage = await scrapeNyaaViewPage(url);
    const warnings: string[] = [];
    let torrentFiles: string[] = [];

    if (viewPage.fileList.length === 0 && viewPage.magnetLink) {
      try {
        const inspectedFiles = await metadataInspector(viewPage.magnetLink);
        torrentFiles = Array.isArray(inspectedFiles) ? inspectedFiles : [];
      } catch (error) {
        warnings.push(
          error instanceof Error
            ? `Torrent metadata inspection failed: ${error.message}`
            : "Torrent metadata inspection failed.",
        );
      }
    }

    const context: ImportSuggestionContext = {
      viewPage,
      torrentFiles,
      allowedGroups,
      defaultGroup: allowedGroups.includes("Anime") ? "Anime" : allowedGroups[0],
    };

    const reasons: Partial<ImportSuggestionReasons> = {};
    const suggestedSection = buildSectionDecision(context);

    const suggestedUploader = normalizeUploader(viewPage.uploader);

    let suggestedGroup = buildDefaultGroup(context, warnings);
    if (viewPage.sourceSite !== "sukebei" && shouldAskPlacementAi(context) && provider.generatePlacementSuggestion) {
      try {
        const placement = await provider.generatePlacementSuggestion(context);
        warnings.push(...(placement.warnings ?? []));
        if (placement.isEcchi) {
          suggestedGroup = "Ecchi";
        }
        reasons.placement = placement.reasons?.placement;
        if (!reasons.placement) {
          warnings.push("AI returned category guidance without a placement reason.");
        }
      } catch (error) {
        warnings.push(
          error instanceof Error
            ? `Category suggestion failed: ${error.message}`
            : "Category suggestion failed.",
        );
      }
    }

    let folder = "";
    let query = "";
    if (provider.generateFolderSuggestion) {
      try {
        const folderSuggestion = await provider.generateFolderSuggestion(context);
        warnings.push(...(folderSuggestion.warnings ?? []));
        folder = normalizeText(folderSuggestion.folder ?? "");
        query = normalizeText(folderSuggestion.query ?? "");
        reasons.folder = folderSuggestion.reasons?.folder;
        reasons.query = folderSuggestion.reasons?.query;
        if (folder && !reasons.folder) {
          warnings.push("AI returned folder without a reason.");
        }
        if (query && !reasons.query) {
          warnings.push("AI returned query without a reason.");
        }
      } catch (error) {
        warnings.push(
          error instanceof Error
            ? `Folder/query suggestion failed: ${error.message}`
            : "Folder/query suggestion failed.",
        );
      }
    }

    let pattern: string | undefined;
    if (provider.generatePatternSuggestion && shouldRequestCustomPattern(context)) {
      try {
        const patternSuggestion = await provider.generatePatternSuggestion(context);
        warnings.push(...(patternSuggestion.warnings ?? []));
        if (patternSuggestion.pattern) {
          if (validatePattern(patternSuggestion.pattern)) {
            pattern = patternSuggestion.pattern;
            reasons.pattern = patternSuggestion.reasons?.pattern;
          } else {
            warnings.push("Pattern suggestion was invalid and was left blank.");
          }
        }
      } catch (error) {
        warnings.push(
          error instanceof Error
            ? `Pattern suggestion failed: ${error.message}`
            : "Pattern suggestion failed.",
        );
      }
    }

    return {
      suggestedGroup,
      suggestedSection: suggestedSection.suggestedSection,
      fields: {
        folder,
        uploader: suggestedUploader,
        query,
        ...(pattern ? { pattern } : {}),
      },
      sourceSite: viewPage.sourceSite,
      warnings: dedupe(warnings),
      rawTitle: viewPage.title,
      ...(Object.keys(reasons).length > 0 ? { reasons } : {}),
    };
  };
};
