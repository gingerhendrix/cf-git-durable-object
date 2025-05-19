import * as git from "isomorphic-git";
import path from "path";

export type FileEntry = {
  path: string;
  name: string;
  type: "file" | "directory";
  children?: FileEntry[];
  oid: string;
};

export async function walkTree({
  repoDir,
  fs,
}: {
  repoDir: string;
  fs: git.FsClient;
}): Promise<FileEntry[] | null> {
  const cache = {};

  async function map(
    filepath: string,
    entries: (git.WalkerEntry | null)[],
  ): Promise<FileEntry | null> {
    const entry = entries[0];
    if (!entry) {
      return null; // Should not happen if an entry exists in HEAD
    }

    const entryType = await entry.type();
    if (!entryType) return null;

    const mappedType = entryType === "tree" ? "directory" : "file";

    const name =
      filepath === "."
        ? path.basename(repoDir) || "root"
        : path.basename(filepath);

    return {
      path: filepath,
      name: name,
      type: mappedType,
      oid: await entry.oid(),
    };
  }

  async function reduce(
    parent: FileEntry | undefined,
    children: (FileEntry | null)[],
  ): Promise<FileEntry | FileEntry[] | null> {
    const filteredChildren = children.filter((c) => c !== null) as FileEntry[];

    if (parent) {
      if (parent.type === "directory") {
        // Only add children array if there are actual children
        if (filteredChildren.length > 0) {
          parent.children = filteredChildren;
        } else {
          delete parent.children; // Or set to undefined, depending on preference
        }
      }
      return parent;
    }
    return filteredChildren;
  }

  const result = await git.walk({
    fs,
    dir: repoDir,
    trees: [git.TREE({ ref: "HEAD" })],
    map,
    reduce,
    cache,
  });

  if (result && !Array.isArray(result) && result.path === ".") {
    return result.children || []; // If root is an object, return its children
  }
  return (result as FileEntry[]) || [];
}
