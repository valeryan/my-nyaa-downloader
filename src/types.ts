export type TorrentData = {
  title: string;
  magnetLink: string;
  path?: string;
};

export type MetaData = {
  folder: string;
  uploader: string;
  query: string;
  complete: boolean;
};

export type NyaaMeta = {
  [rootFolder: string]: MetaData[];
};

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
