import React from "react";
import { ShaderCanvas } from "../../components";
import "./home.styles.scss";

export const Home: React.FC = () => {
  return (
    <div className="rootHome">
      <details>
        <summary>WebGPU Wave Simulator</summary>
        <ShaderCanvas />
      </details>
    </div>
  );
};
