import { Github, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface RepoHeaderProps {
  repoName: string;
}

export function RepoHeader({ repoName }: RepoHeaderProps) {
  return (
    <div className="border-b p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">{repoName}</h1>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-7 gap-1">
              <Github className="h-4 w-4" />
              <span>View</span>
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <GitBranch className="h-4 w-4 text-muted-foreground" />
            <Select defaultValue="main">
              <SelectTrigger className="h-8 w-[130px]">
                <SelectValue placeholder="Branch" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="main">main</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </div>
  );
}
