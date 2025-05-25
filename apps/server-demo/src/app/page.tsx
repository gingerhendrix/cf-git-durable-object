import { useState } from "react"
import { FileExplorer } from "@/components/file-explorer"
import { FileViewer } from "@/components/file-viewer"
import { RepoHeader } from "@/components/repo-header"

export default function Home() {
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [currentPath, setCurrentPath] = useState<string[]>([])

  return (
    <div className="flex flex-col h-screen">
      <RepoHeader repoName="example/repository" />
      <div className="flex flex-1 overflow-hidden">
        <FileExplorer onSelectFile={setSelectedFile} currentPath={currentPath} setCurrentPath={setCurrentPath} />
        <FileViewer selectedFile={selectedFile} />
      </div>
    </div>
  )
}
