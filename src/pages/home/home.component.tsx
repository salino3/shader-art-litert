import React from "react";
import { ShaderCanvas } from "../../components";
import "./home.styles.scss";

export const Home: React.FC = () => {
  return (
    <div className="rootHome">
      <ShaderCanvas />
    </div>
  );
};
