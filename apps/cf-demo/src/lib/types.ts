export type FileEntry = {
  path: string;
  name: string;
  type: "file" | "directory";
  children?: FileEntry[];
  oid: string;
};
