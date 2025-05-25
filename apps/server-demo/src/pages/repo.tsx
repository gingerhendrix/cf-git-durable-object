import { FileExplorer } from "@/components/file-explorer";
import { FileViewer } from "@/components/file-viewer";
import { RepoHeader } from "@/components/repo-header";
import { FileEntry } from "@/lib/types";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type CommitInfo,
  type Events,
} from "../../worker/do/readonly-repo-object";
import { LoaderPinwheel } from "lucide-react";

export function RepoPage({ repo }: { repo: string }) {
  const [status, setStatus] = useState("unknown");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [commitInfo, setCommitInfo] = useState<CommitInfo | null>(null);
  const websocket = useRef<WebSocket>(null);
  const [progress, setProgress] = useState<{
    phase: string;
    loaded: number;
    total: number;
  } | null>(null);

  const fetchFiles = useCallback(async () => {
    setIsLoading(true);
    const res = await fetch(`/api/${repo}/ls-files`, {
      method: "POST",
    });
    const data = (await res.json()) as { files: FileEntry[] };
    setFiles(data.files);
    setIsLoading(false);
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

  const fetchRepo = async () => {
    websocket.current?.send(JSON.stringify({ type: "fetch" }));
  };

  useEffect(() => {
    if (status === "new") {
      websocket.current?.send(
        JSON.stringify({
          type: "clone",
        }),
      );
    } else if (status === "ready") {
      fetchFiles();
    }
  }, [status, fetchFiles]);

  useEffect(() => {
    const ws = new WebSocket(`/api/${repo}/ws`);
    websocket.current = ws;
    ws.addEventListener("open", () => {
      console.log("WebSocket connection established");
      ws.send(JSON.stringify({ type: "init", repo }));
    });
    ws.addEventListener("message", (msg) => {
      const event = JSON.parse(msg.data) as Events;
      console.log("Received event:", event);
      if (event.type === "status") {
        setStatus(event.status);
        setCommitInfo(event.commitInfo || null);
      } else if (event.type === "progress") {
        setProgress(event.progress);
      }
    });

    return () => {
      ws.close();
    };
  }, [repo, fetchFiles]);

  const loaded = status === "ready" && !isLoading;
  let loadingMessage = "";
  if (status === "cloning") {
    loadingMessage = progress?.phase || "Cloning repository...";
  } else if (status === "fetching") {
    loadingMessage = progress?.phase || "Fetching repository...";
  } else if (status === "ready") {
    loadingMessage = "Loading files...";
  }

  return (
    <div className="flex flex-col h-screen">
      <RepoHeader
        repoName={repo}
        onFetch={fetchRepo}
        status={status}
        progress={progress}
        commitInfo={commitInfo}
      />
      <div className="flex flex-1 overflow-hidden">
        {!loaded ? (
          <div className="flex items-center justify-center w-full">
            <LoaderPinwheel className="h-8 w-8 animate-spin text-gray-300" />
            <p className="pl-2 text-lg">{loadingMessage}</p>
          </div>
        ) : (
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
