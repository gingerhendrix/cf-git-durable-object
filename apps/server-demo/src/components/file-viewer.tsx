import { ScrollArea } from "@/components/ui/scroll-area";
import { FileEntry } from "@/lib/types";
import "highlight.js/styles/default.css";
import "react-lowlight/common";
import Lowlight from "react-lowlight";

interface FileViewerProps {
  fileContent: string | null;
  fileEntry: FileEntry | null;
}

export function FileViewer({ fileContent, fileEntry }: FileViewerProps) {
  if (!fileContent || !fileEntry) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        Select a file to view its contents
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full">
      <div className="border-b p-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-medium">{fileEntry.name}</span>
        </div>
      </div>

      <ScrollArea className="h-full">
        <pre className="p-4 text-sm font-mono whitespace-pre-wrap">
          <Lowlight value={fileContent} markers={[]} />
        </pre>
      </ScrollArea>
    </div>
  );
}
