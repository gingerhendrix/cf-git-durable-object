import { useState } from "react";
import { Button } from "../components/ui/button";

export function HomePage() {
  const [repoName, setRepoName] = useState("");
  const [repoStatus, setRepoStatus] = useState("unknown");
  const [files, setFiles] = useState<string[]>([]);

  return (
    <div className="card">
      <h1 className="text-3xl font-bold">Git on a Durable Object</h1>
      <input value={repoName} onChange={(e) => setRepoName(e.target.value)} />
      <Button
        variant="outline"
        onClick={() => {
          fetch(`/api/${repoName}/status`)
            .then((res) => res.json() as Promise<{ status: string }>)
            .then((data) => setRepoStatus(data.status));
        }}
      >
        {repoName} is {repoStatus}
      </Button>
      <button
        onClick={async () => {
          setRepoStatus("cloning");
          const res = await fetch(`/api/${repoName}/clone`, {
            method: "POST",
          });
          const data = (await res.json()) as { status: string };
          setRepoStatus(data.status);
        }}
      >
        Clone
      </button>
      <button
        onClick={async () => {
          const res = await fetch(`/api/${repoName}/ls-files`, {
            method: "POST",
          });
          const data = (await res.json()) as { files: string[] };
          setFiles(data.files);
        }}
      >
        List files
      </button>

      <div>
        {files.length > 0 ? (
          <ul>
            {files.map((file) => (
              <li key={file}>{file}</li>
            ))}
          </ul>
        ) : (
          <p>No files listed.</p>
        )}
      </div>
    </div>
  );
}
