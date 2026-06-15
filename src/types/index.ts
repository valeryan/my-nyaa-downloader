export type EpisodeAttributes = {
  version?: number;
  encoding?: string;
  resolution?: number;
  timestamp?: number;
  season: string;
};

export type TorrentData = {
  title: string;
  magnetLink: string;
  size: string;
  timestamp: number;
  path?: string;
};

export type DownloadEntry = {
  folder: string;
  uploader: string;
  query: string;
  complete: boolean;
  sukebei?: boolean;
  pattern?: string;
  seasonPack?: boolean;
};

export type DownloadList = {
  [rootFolder: string]: DownloadEntry[];
};

export type EntryFileList = Record<string, string[]>;

export type TrackerData = {
  title: string;
  newEpisodes: number;
};

export type TrackerGroup = {
  [rootFolder: string]: TrackerData[];
};

export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
};

export type GemmaConfig = {
  apiUrl: string;
  model: string;
  timeoutMs: number;
};

export type SourceSite = "nyaa" | "sukebei";

export type ImportTargetSection = "regular" | "seasonPacks";

export type ViewPageData = {
  url: string;
  sourceSite: SourceSite;
  title: string;
  uploader: string;
  category: string;
  magnetLink: string;
  infoRows: Record<string, string>;
  description: string;
  fileList: string[];
};

export type TorrentFileInfo = {
  name: string;
  path: string;
};

export type ImportSuggestionReasons = {
  placement?: string;
  section?: string;
  folder?: string;
  query?: string;
  pattern?: string;
};

export type ImportSuggestionFields = {
  folder: string;
  uploader: string;
  query: string;
  pattern?: string;
};

export type ImportSuggestionContext = {
  viewPage: ViewPageData;
  torrentFiles: string[];
  allowedGroups: string[];
  defaultGroup: string;
};

export type ImportPlacementSuggestion = {
  isEcchi: boolean;
  warnings?: string[];
  reasons?: Pick<ImportSuggestionReasons, "placement">;
};

export type ImportFolderSuggestion = {
  folder?: string;
  query?: string;
  warnings?: string[];
  reasons?: Pick<ImportSuggestionReasons, "folder" | "query">;
};

export type ImportPatternSuggestion = {
  pattern?: string;
  warnings?: string[];
  reasons?: Pick<ImportSuggestionReasons, "pattern">;
};

export type ImportSuggestionProvider = {
  generatePlacementSuggestion?: (
    context: ImportSuggestionContext,
  ) => Promise<ImportPlacementSuggestion>;
  generateFolderSuggestion?: (
    context: ImportSuggestionContext,
  ) => Promise<ImportFolderSuggestion>;
  generatePatternSuggestion?: (
    context: ImportSuggestionContext,
  ) => Promise<ImportPatternSuggestion>;
};

export type ImportSuggestion = {
  suggestedGroup: string;
  suggestedSection: ImportTargetSection;
  fields: ImportSuggestionFields;
  sourceSite: SourceSite;
  warnings: string[];
  rawTitle?: string;
  reasons?: ImportSuggestionReasons;
};

export type ImportFromLinkService = (
  url: string,
  allowedGroups: string[],
) => Promise<ImportSuggestion>;

export type AppConfig = {
  nyaaUrl: string;
  sukebeiUrl: string;
  downloadFolder: string;
  smtp: SmtpConfig;
  reportEmail: string;
  fromEmail: string;
  gemma: GemmaConfig;
};
