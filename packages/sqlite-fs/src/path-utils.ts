import path from "node:path";

export const dirname = path.dirname;
export const basename = path.basename;
export const join = path.join;
export const normalize = path.normalize; // Useful for handling '.' and '..'

// Custom helper for handling root path case
export function getParentPath(p: string): string {
  const parent = path.dirname(p);
  return parent === p ? "" : parent; // Handle root case
}

