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
