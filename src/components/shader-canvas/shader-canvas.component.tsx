import React, { useEffect, useRef, useState } from "react";

const WIDTH = 800;
const HEIGHT = 600;

export const ShaderCanvas: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState("Initializing WebGPU...");

  useEffect(() => {
    const initializeWebGPU = async () => {
      const canvasElement = canvasRef.current;
      if (!canvasElement) return;

      // 1. Check for native WebGPU support
      if (!("gpu" in navigator)) {
        setStatus(
          "❌ Error: WebGPU is not available. Requires recent Chrome/Edge."
        );
        return;
      }

      try {
        // 2. Request the GPU adapter (a representation of the GPU hardware)
        // navigator.gpu is now properly typed thanks to @webgpu/types.
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
          setStatus("❌ Error: Could not get the GPU adapter.");
          return;
        }

        // 3. Request the logical GPU device (the main object for WebGPU calls)
        const device = await adapter.requestDevice();

        // 4. Get the WebGPU canvas context
        const context = canvasElement.getContext("webgpu");
        if (!context) {
          setStatus("❌ Error: Could not get the 'webgpu' context.");
          return;
        }

        // 5. Determine the preferred color format for the canvas
        // This is typically bgra8unorm or rgba8unorm
        const presentationFormat = navigator.gpu.getPreferredCanvasFormat();

        // 6. Configure the canvas context
        context.configure({
          device: device,
          format: presentationFormat,
          alphaMode: "opaque", // Set to 'opaque' as we'll handle the background fully
        });

        setStatus(`✅ WebGPU initialized. Adapter: ${adapter.name}`);

        // --- NEXT STEP: CREATING SHADERS AND BUFFERS ---
        // 'device', 'context', and 'presentationFormat' are the key objects needed.
        // We'll proceed with creating Compute Shaders (WGSL) for the simulation.
        // -----------------------------------------------
      } catch (error) {
        console.error("WebGPU Initialization Error:", error);
        setStatus("❌ Error accessing GPU device. Check console for details.");
      }
    };

    initializeWebGPU();
  }, []); // Empty array ensures this runs only once on mount

  return (
    <div
      style={{ display: "flex", flexDirection: "column", alignItems: "center" }}
    >
      <h2>WebGPU Wave Simulator (Native)</h2>
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        style={{ border: "1px solid #ccc" }}
      />
      <p>Status: **{status}**</p>
    </div>
  );
};
