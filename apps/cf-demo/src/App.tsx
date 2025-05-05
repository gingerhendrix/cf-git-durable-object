import { useState } from "react";
import "./App.css";

function App() {
  const [repoName, setRepoName] = useState("");
  const [repoStatus, setRepoStatus] = useState("unknown");

  return (
    <>
      <h1>Git on a Durable Object</h1>
      <div className="card">
        <input value={repoName} onChange={(e) => setRepoName(e.target.value)} />
        <button
          onClick={() => {
            fetch(`/api/${repoName}/status`)
              .then((res) => res.json() as Promise<{ status: string }>)
              .then((data) => setRepoStatus(data.status));
          }}
          aria-label="get name"
        >
          {repoName} is {repoStatus}
        </button>
      </div>
    </>
  );
}

export default App;
