import { useState } from "react";
import viteLogo from "/vite.svg";
import { Home } from "./components";
import "./App.scss";

function App() {
  const [count, setCount] = useState(0);

  return (
    <>
      <div>
        <a href="https://vite.dev" target="_blank">
          <img src={viteLogo} className="logo" alt="Vite logo" />
        </a>
      </div>
      <h1>Vite + React</h1>
      <Home />
    </>
  );
}

export default App;
