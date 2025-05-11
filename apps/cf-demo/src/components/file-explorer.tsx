import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileEntry } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatDistance, parseISO } from "date-fns";
import {
  ChevronDown,
  ChevronRight,
  File,
  Folder,
  GitCommit,
} from "lucide-react";
import { useState } from "react";

interface FileExplorerProps {
  onSelectFile: (file: FileEntry | null) => void;
  currentPath: string[];
  setCurrentPath: (path: string[]) => void;
  files: FileEntry[];
}

export function FileExplorer({
  onSelectFile,
  currentPath,
  setCurrentPath,
  files,
}: FileExplorerProps) {
  const [expandedFolders, setExpandedFolders] = useState<
    Record<string, boolean>
  >({
    src: true,
  });

  const toggleFolder = (path: string) => {
    setExpandedFolders((prev) => ({
      ...prev,
      [path]: !prev[path],
    }));
  };

  const handleFileClick = (entry: FileEntry) => {
    onSelectFile(entry);
  };

  const handleFolderClick = (entry: FileEntry) => {
    const { path } = entry;
    toggleFolder(path);

    if (!expandedFolders[path]) {
      setCurrentPath(path.split("/"));
    }
  };

  const navigateUp = () => {
    if (currentPath.length > 0) {
      setCurrentPath(currentPath.slice(0, -1));
    }
  };

  const renderFileTree = (structure: FileEntry[], basePath: string[] = []) => {
    return structure.map((entry) => {
      const path = entry.path.split("/");
      const isExpanded = expandedFolders[entry.path];

      if (entry.type === "directory") {
        return (
          <div key={entry.path} className={`group/${entry.path}`}>
            <div
              className="flex items-center py-1 px-2 hover:bg-muted/50 cursor-pointer rounded-sm group"
              onClick={() => handleFolderClick(entry)}
            >
              <Button
                variant="ghost"
                size="icon"
                className="h-4 w-4 p-0 text-muted-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFolder(entry.path);
                }}
              >
                {isExpanded ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
              </Button>
              <Folder className="h-4 w-4 text-muted-foreground mr-1" />
              <span className="text-sm">{entry.name}</span>
              <span className="ml-auto text-xs text-muted-foreground hidden group-hover:inline-flex items-center gap-1">
                <GitCommit className="h-3 w-3" />
                {formatDistance(parseISO(entry.lastCommit), new Date(), {
                  addSuffix: true,
                })}
              </span>
            </div>
            {isExpanded && (
              <div className="pl-4">
                {renderFileTree(entry.children || [], path)}
              </div>
            )}
          </div>
        );
      } else {
        return (
          <div
            key={entry.path}
            className="flex items-center py-1 px-2 pl-6 hover:bg-muted/50 cursor-pointer rounded-sm group"
            onClick={() => handleFileClick(entry)}
          >
            <File className="h-4 w-4 text-muted-foreground mr-1" />
            <span className="text-sm">{entry.name}</span>
            <span className="ml-auto text-xs text-muted-foreground hidden group-hover:inline-flex items-center gap-1">
              <GitCommit className="h-3 w-3" />
              {formatDistance(parseISO(entry.lastCommit), new Date(), {
                addSuffix: true,
              })}
            </span>
          </div>
        );
      }
    });
  };

  const getBreadcrumbs = () => {
    return (
      <div className="flex items-center text-sm text-muted-foreground px-2 py-1 border-b">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={navigateUp}
          disabled={currentPath.length === 0}
        >
          root
        </Button>
        {currentPath.map((segment, index) => (
          <div key={index} className="flex items-center">
            <span className="mx-1">/</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => setCurrentPath(currentPath.slice(0, index + 1))}
            >
              {segment}
            </Button>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className={cn("w-80 border-r flex flex-col h-full")}>
      {getBreadcrumbs()}
      <ScrollArea className="flex-1">
        <div className="p-2">{renderFileTree(files, currentPath)}</div>
      </ScrollArea>
    </div>
  );
}
