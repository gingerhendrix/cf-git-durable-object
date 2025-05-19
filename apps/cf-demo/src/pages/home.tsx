import { useState } from "react";
import { Button } from "../components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@radix-ui/react-label";
import { Github } from "lucide-react";

export function HomePage() {
  const [repoName, setRepoName] = useState("");

  return (
    <div className="flex flex-col items-center justify-center h-screen">
      <h1 className="text-3xl font-bold m-6">Git on a Durable Object</h1>
      <Card className="w-[350px]">
        <CardHeader>
          <CardTitle>
            <div className="flex items-center gap-1">
              <Github className="w-4 h-4" />
              <div>Clone a GitHub Repo</div>
            </div>
          </CardTitle>
          <CardDescription>
            Clone a github repository into a Cloudflare Durable Object.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid w-full items-center gap-4">
            <div className="flex flex-col space-y-1.5">
              <Label htmlFor="name">Repo</Label>
              <Input
                id="name"
                placeholder="e.g. gingerhendrix/cf-git-durable-object"
                value={repoName}
                onChange={(e) => setRepoName(e.currentTarget.value)}
              />
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex justify-between">
          <Button asChild>
            <a href={`/repo/${repoName}`} className="w-full">
              Clone
            </a>
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
