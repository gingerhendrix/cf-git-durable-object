import { FileExplorer } from "@/components/file-explorer";
import { FileViewer } from "@/components/file-viewer";
import { RepoHeader } from "@/components/repo-header";
import { FileEntry } from "@/lib/types";
import { useCallback, useEffect, useState } from "react";

export function RepoPage({ repo }: { repo: string }) {
  const [status, setStatus] = useState("unknown");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState<string[]>([]);

  const fetchFiles = useCallback(async () => {
    const res = await fetch(`/api/${repo}/ls-files`, {
      method: "POST",
    });
    const data = (await res.json()) as { files: FileEntry[] };
    setFiles(data.files);
  }, [repo]);

  const fetchBlob = async (oid: string) => {
    const res = await fetch(`/api/${repo}/blob/${oid}`, {
      method: "GET",
    });
    const data = (await res.json()) as { blob: string };
    return data.blob;
  };

  const onSelectFile = async (entry: FileEntry | null) => {
    if (!entry) {
      setSelectedFile(null);
      return;
    }
    if (entry.type === "file") {
      setCurrentPath(entry.path.split("/").slice(0, -1));
      setSelectedFile(entry);
      setFileContent("Loading...");
      const blob = await fetchBlob(entry.oid);
      setFileContent(blob);
    } else {
      setCurrentPath(entry.path.split("/"));
    }
  };

  useEffect(() => {
    const fetchStatus = async () => {
      const status = await fetch(`/api/${repo}/status`, {
        method: "GET",
      });
      const data = (await status.json()) as { status: string };
      setStatus(data.status);

      if (data.status === "ok") {
        fetchFiles();
      }
    };
    fetchStatus();
  }, [repo, fetchFiles]);

  return (
    <div className="flex flex-col h-screen">
      <RepoHeader repoName={repo} />
      <div className="flex flex-1 overflow-hidden">
        {status !== "ok" && (
          <div className="flex items-center justify-center w-full">
            <p className="text-lg">Loading...</p>
          </div>
        )}
        {status === "ok" && (
          <>
            <FileExplorer
              onSelectFile={onSelectFile}
              currentPath={currentPath}
              setCurrentPath={setCurrentPath}
              files={files}
            />
            <FileViewer fileEntry={selectedFile} fileContent={fileContent} />
          </>
        )}
      </div>
    </div>
  );
}
