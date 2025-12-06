import React, { useEffect, useRef, useState } from "react";

const WIDTH = 700;
const HEIGHT = 600;
// Define our first Compute Shader in WGSL
const computeShaderCode: string = `
    // Define Bind Group 0, which contains our data storage.
    @group(0) @binding(0) 
    // The 'data' buffer is our input/output array. 
    // 'storage' allows read and write access.
    var<storage, read_write> data: array<f32>;

    // The entry point for the compute program.
    // 'global_invocation_id' indicates which thread is running (like the index in the array).
    @compute
    fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
        // The x dimension of global_id is the index of the array element.
        let index = global_id.x; 

        // Simple operation: read the value, add 1, and write it back.
        data[index] = data[index] + 1.0; 
    }
`;

// Define the Render Shaders (Vertex and Fragment)
const renderShaderCode: string = `
    // The Vertex Shader runs once per vertex, defining its position.
    // This is a simple trick to draw a full-screen quad without supplying vertex data.
    @vertex
    fn vs_main(@builtin(vertex_index) vertex_index: u32) -> @builtin(position) vec4<f32> {
        var pos = array<vec2<f32>, 6>(
            vec2<f32>( 1.0,  1.0), 
            vec2<f32>( 1.0, -1.0), 
            vec2<f32>(-1.0, -1.0),
            vec2<f32>( 1.0,  1.0), 
            vec2<f32>(-1.0, -1.0), 
            vec2<f32>(-1.0,  1.0)
        );
        return vec4<f32>(pos[vertex_index], 0.0, 1.0);
    }

    // The Fragment Shader runs once per pixel, defining its color.
    @fragment
    fn fs_main(@builtin(position) frag_coord: vec4<f32>) -> @location(0) vec4<f32> {
        // Use the pixel coordinates to generate a color (e.g., gradient)
        let x = frag_coord.x / ${WIDTH}.0;
        let y = frag_coord.y / ${HEIGHT}.0;
        
        // Return a color: Red component based on X, Green on Y, Blue is 0.5, Alpha is 1.0
        return vec4<f32>(x, y, 0.5, 1.0);
    }
`;

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

        // --- 7. Setup Compute Shader ---

        // Input array of 4 numbers: [10, 20, 30, 40]
        const dataArray = new Float32Array([10.0, 20.0, 30.0, 40.0]);
        const bufferSize = dataArray.byteLength;
        const numElements = dataArray.length;

        // 7.1 Create a Storage Buffer on the GPU (Input/Output)
        const storageBuffer = device.createBuffer({
          size: bufferSize,
          // STORAGE: needed for the shader. COPY_SRC/DST: needed to transfer data.
          usage:
            GPUBufferUsage.STORAGE |
            GPUBufferUsage.COPY_SRC |
            GPUBufferUsage.COPY_DST,
          mappedAtCreation: true, // Map buffer for initial data writing
        });

        // Write initial data from the CPU (dataArray) to the GPU buffer
        new Float32Array(storageBuffer.getMappedRange()).set(dataArray);
        storageBuffer.unmap();

        // 7.2 Create the shader module from the WGSL code
        const shaderModule = device.createShaderModule({
          code: computeShaderCode,
        });

        // 7.3 Create the Compute Pipeline (defines the compute steps)
        const computePipeline = device.createComputePipeline({
          layout: "auto", // Automatically infer the layout from the shader
          compute: {
            module: shaderModule,
            entryPoint: "main", // The name of the WGSL entry function
          },
        });

        // 7.4 Create the Bind Group: Connects the 'storageBuffer' to the @binding(0)
        const bindGroup = device.createBindGroup({
          layout: computePipeline.getBindGroupLayout(0),
          entries: [
            {
              binding: 0,
              resource: {
                buffer: storageBuffer,
              },
            },
          ],
        });

        // --- 8. Execute Compute Shader ---

        // 8.1 Create a buffer to read the result back to the CPU (Read Buffer)
        const resultBuffer = device.createBuffer({
          size: bufferSize,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });

        // 8.2 Create the Command Encoder (used to record GPU commands)
        const commandEncoder = device.createCommandEncoder();

        // 8.3 Start the Compute Pass (where the shader runs)
        const passEncoder = commandEncoder.beginComputePass();
        passEncoder.setPipeline(computePipeline);
        passEncoder.setBindGroup(0, bindGroup);

        // Dispatch: Launch one thread for each element (4 threads in total).
        passEncoder.dispatchWorkgroups(numElements);

        passEncoder.end();

        // 8.4 Copy the result from the Storage Buffer to the Read Buffer
        commandEncoder.copyBufferToBuffer(
          storageBuffer,
          0,
          resultBuffer,
          0,
          bufferSize
        );

        // 8.5 Submit the recorded commands to the GPU queue for execution
        device.queue.submit([commandEncoder.finish()]);

        // --- 9. Read the result back to the CPU ---

        // Wait for the copy operation to finish and map the result buffer
        await resultBuffer.mapAsync(GPUMapMode.READ);
        const result = new Float32Array(resultBuffer.getMappedRange());

        console.log("Initial Array:", dataArray);
        console.log("Compute Shader Result (each value + 1):", result);
        // Expected output: [11, 21, 31, 41]

        // Clean up and finalize
        resultBuffer.unmap();

        setStatus(
          `✅ WebGPU Initialized and Compute Shader Executed. Result in console: ${result[0]}, ${result[1]}, ${result[2]}, ${result[3]}`
        );

        // --- 10. Setup Render Pipeline ---

        const renderPipeline = device.createRenderPipeline({
          layout: "auto",
          vertex: {
            module: device.createShaderModule({ code: renderShaderCode }),
            entryPoint: "vs_main",
          },
          fragment: {
            module: device.createShaderModule({ code: renderShaderCode }),
            entryPoint: "fs_main",
            targets: [
              {
                format: presentationFormat, // Use the same format configured for the canvas
              },
            ],
          },
          primitive: {
            topology: "triangle-list",
          },
        });

        // --- 11. Execute Render Pass (Draw the Gradient) ---

        // Get the texture that the canvas should draw to
        const textureView = context.getCurrentTexture().createView();

        const renderEncoder = device.createCommandEncoder();
        const renderPass = renderEncoder.beginRenderPass({
          colorAttachments: [
            {
              view: textureView,
              clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 }, // Clear canvas to black
              loadOp: "clear",
              storeOp: "store",
            },
          ],
        });

        // Draw the full-screen quad (6 vertices)
        renderPass.setPipeline(renderPipeline);
        renderPass.draw(6);
        renderPass.end();

        // Submit the render commands
        device.queue.submit([renderEncoder.finish()]);

        // ... update the status to reflect both compute and render completed
        setStatus(
          `✅ Initialized, Compute Test Passed, and Canvas Rendered (${adapter.name})`
        );

        // --- End of initializeWebGPU function ---

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
