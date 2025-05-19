import { Button } from "@/components/ui/button";
import { ArrowDownToLine, GitCommitHorizontal, Github } from "lucide-react";
import { Progress } from "./progress";

interface RepoHeaderProps {
  repoName: string;
  onFetch: () => void;
  status: string;
  progress: {
    phase: string;
    loaded: number;
    total: number;
  } | null;
  commitInfo?: {
    branch: string | undefined;
    commit: {
      oid: string;
      commit: {
        message: string;
      };
      author: {
        name: string;
        email: string;
        timestamp: number;
        timezoneOffset: number;
      };
    };
  };
}

export function RepoHeader({
  repoName,
  onFetch,
  status,
  progress,
  commitInfo,
}: RepoHeaderProps) {
  return (
    <div className="border-b p-4">
      <div className="flex">
        <div className="flex items-end gap-2 grow">
          <h1 className="text-xl font-semibold pr-4">{repoName}</h1>

          {commitInfo && (
            <a
              href={`https://github.com/${repoName}/commit/${commitInfo.commit.oid}`}
              className="flex items-end gap-2"
              target="_blank"
            >
              <div className="flex items-center gap-1">
                <GitCommitHorizontal className="h-4 w-4" />
                <div className="text-sm text-muted-foreground">
                  {commitInfo.branch}
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                ({commitInfo.commit.oid.slice(0, 7)})
              </div>
              <div className="text-xs text-muted-foreground max-w-[36em] overflow-hidden text-ellipsis whitespace-nowrap">
                {commitInfo.commit.commit.message}
              </div>
            </a>
          )}
        </div>
        {(status === "cloning" || status === "fetching") && progress && (
          <div className="pr-4 pt-2 gap-2 items-center">
            <Progress
              phase={progress.phase}
              loaded={progress.loaded}
              total={progress.total}
            />
          </div>
        )}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="lg"
            className="h-7 gap-1"
            onClick={onFetch}
          >
            <ArrowDownToLine className="w-4 h-4" />
            <span>Fetch</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
