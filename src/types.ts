export type TorrentData = {
  title: string;
  magnetLink: string;
  path?: string;
};

export type DownloadEntry = {
  folder: string;
  uploader: string;
  query: string;
  complete: boolean;
  pattern?: string;
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

export type AppConfig = {
  nyaaUrl: string;
  downloadFolder: string;
  smtp: SmtpConfig;
  reportEmail: string;
  fromEmail: string;
};
