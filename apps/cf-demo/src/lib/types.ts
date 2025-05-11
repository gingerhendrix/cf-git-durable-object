export type FileEntry = {
  path: string;
  name: string;
  type: "file" | "directory";
  lastCommit: string;
  children?: FileEntry[];
  oid: string;
};
