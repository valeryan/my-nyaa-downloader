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

export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
};

export type AppConfig = {
  smtp: SmtpConfig;
  reportEmail: string;
  fromEmail: string;
};
