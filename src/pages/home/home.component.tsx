import React from "react";
import { ReactionDiffusionCanvas, ShaderCanvas } from "../../components";
import "./home.styles.scss";

export const Home: React.FC = () => {
  return (
    <div className="rootHome">
      <h1 className="homeTitle">Shader Art LiteRT</h1>
      <details>
        <summary>WebGPU Wave Simulator</summary>
        <ShaderCanvas />
      </details>
      <br />
      <details>
        <summary>Reaction Diffusion Canvas</summary>
        <ReactionDiffusionCanvas />
      </details>
    </div>
  );
};
