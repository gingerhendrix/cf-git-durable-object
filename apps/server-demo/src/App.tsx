import { Route, Switch } from "wouter";
import "./App.css";
import { HomePage } from "./pages/home";
import { RepoPage } from "./pages/repo";

function App() {
  return (
    <Switch>
      <Route path="/" component={HomePage} />

      <Route path="/repo/:org/:name">
        {(params) => <RepoPage repo={`${params.org}/${params.name}`} />}
      </Route>

      {/* Default route in a switch */}
      <Route>404: No such page!</Route>
    </Switch>
  );
}

export default App;
