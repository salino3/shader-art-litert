import React, { useEffect, useRef, useState } from "react";
import "./reaction-diffusion-canvas.styles.scss";

// Canvas dimensions
const WIDTH: number = 700;
const HEIGHT: number = 600;
const WORKGROUP_SIZE: number = 8;

// --- 1. Compute Shader: Gray-Scott Reaction-Diffusion ---
const rdComputeShaderCode: string = `
    // Binding 0: Input Texture (Buffer A: Current State)
    @group(0) @binding(0) var inputTexture: texture_2d<f32>;

    // Binding 1: Output Texture (Buffer B: Next State)
    @group(0) @binding(1) var outputTexture: texture_storage_2d<rgba32float, write>; // <-- Using rgba32float here

    // Simulation constants for Gray-Scott (Patterns similar to the image)
    const DU: f32 = 0.16; // Increased Diffusion Rate of U (Faster spread)
    const DV: f32 = 0.08; // Increased Diffusion Rate of V (Faster spread)
    const F: f32 = 0.055; // Feed Rate (Maintain pattern type)
    const K: f32 = 0.062; // Kill Rate (Maintain pattern type)
    const DT: f32 = 1.4;  // Time step (Faster overall evolution)

    @compute
    @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE}, 1)
    fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
        let coords = vec2<i32>(global_id.xy); 
        let size = vec2<i32>(textureDimensions(inputTexture));
        
        if (coords.x >= size.x || coords.y >= size.y || coords.x < 0 || coords.y < 0) {
            return;
        }

        let u_current = textureLoad(inputTexture, coords, 0).r;
        let v_current = textureLoad(inputTexture, coords, 0).g;

        // --- 1. Calculate Laplacian (4-point neighbors) ---
        var sum_neighbors_u: f32 = 0.0;
        var sum_neighbors_v: f32 = 0.0;

        sum_neighbors_u += textureLoad(inputTexture, coords + vec2<i32>(-1, 0), 0).r;
        sum_neighbors_u += textureLoad(inputTexture, coords + vec2<i32>(1, 0), 0).r;
        sum_neighbors_u += textureLoad(inputTexture, coords + vec2<i32>(0, -1), 0).r;
        sum_neighbors_u += textureLoad(inputTexture, coords + vec2<i32>(0, 1), 0).r;
        let laplacian_u = sum_neighbors_u - 4.0 * u_current;
        
        sum_neighbors_v += textureLoad(inputTexture, coords + vec2<i32>(-1, 0), 0).g;
        sum_neighbors_v += textureLoad(inputTexture, coords + vec2<i32>(1, 0), 0).g;
        sum_neighbors_v += textureLoad(inputTexture, coords + vec2<i32>(0, -1), 0).g;
        sum_neighbors_v += textureLoad(inputTexture, coords + vec2<i32>(0, 1), 0).g;
        let laplacian_v = sum_neighbors_v - 4.0 * v_current;

        // --- 2. Calculate Reaction Terms (UVV and Feed/Kill) ---
        let uvv = u_current * v_current * v_current;
        
        // Rate of change for U: Diffusion - Reaction + Feed
        let du_dt = DU * laplacian_u - uvv + F * (1.0 - u_current);
        
        // Rate of change for V: Diffusion + Reaction - Kill
        let dv_dt = DV * laplacian_v + uvv - (F + K) * v_current;

        // --- 3. Euler Integration (Next State) ---
        let next_u = u_current + du_dt * DT;
        let next_v = v_current + dv_dt * DT;
        
        // Clamp values to stability range [0, 1]
        let clamped_u = clamp(next_u, 0.0, 1.0);
        let clamped_v = clamp(next_v, 0.0, 1.0);

        // Write result (U to R, V to G)
        textureStore(outputTexture, coords, vec4<f32>(clamped_u, clamped_v, 0.0, 1.0));
    }
`;

// --- 2. Render Shader: Read U and V and Color Map ---
const rdRenderShaderCode: string = `
    // Binding 0: Simulation Texture (Reads U in R, V in G)
    @group(0) @binding(0) 
    var simulationTexture: texture_2d<f32>; 
    
    // Vertex Shader: Full-screen quad
    @vertex
    fn vs_main(@builtin(vertex_index) vertex_index: u32) -> @builtin(position) vec4<f32> {
        var pos = array<vec2<f32>, 6>(
            vec2<f32>( 1.0,  1.0), vec2<f32>( 1.0, -1.0), vec2<f32>(-1.0, -1.0),
            vec2<f32>( 1.0,  1.0), vec2<f32>(-1.0, -1.0), vec2<f32>(-1.0,  1.0)
        );
        return vec4<f32>(pos[vertex_index], 0.0, 1.0);
    }

    // Fragment Shader: Color based on V concentration (which forms the pattern)
    @fragment
    fn fs_main(@builtin(position) frag_coord: vec4<f32>) -> @location(0) vec4<f32> {
        let coords = vec2<i32>(frag_coord.xy); 
        
        // Read U (R) and V (G) concentrations
        let uv_values = textureLoad(simulationTexture, coords, 0); 
        let u = uv_values.r;
        let v = uv_values.g;
        
        // Color mapping based on V (the substance that forms the patterns)
        // Using U concentration to smooth the transition.
        
        let color_base = vec3<f32>(0.2, 0.4, 0.6);      // Dark blue background (High U)
        let color_mid = vec3<f32>(0.5, 0.7, 0.8);       // Light blue (Young pattern)
        let color_peak = vec3<f32>(0.8, 0.7, 0.3);      // Brown/Yellow (Mature pattern - High V)

        // Simple linear interpolation based on V concentration
        var final_color: vec3<f32>;
        let factor = clamp(v * 4.0, 0.0, 1.0); // Amplify V for better contrast
        
        if (factor < 0.25) {
            // Background (U)
            final_color = color_base;
        } else if (factor < 0.75) {
            // Transition to Pattern
            final_color = mix(color_base, color_mid, (factor - 0.25) * 2.0);
        } else {
            // Pattern Peak
            final_color = mix(color_mid, color_peak, (factor - 0.75) * 4.0);
        }
        
        // We can also use U to modulate luminosity
        final_color *= (u * 0.5 + 0.5); 

        return vec4<f32>(final_color, 1.0);
    }
`;

export const ReactionDiffusionCanvas: React.FC = () => {
  // Persistent storage for WebGPU objects
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // @ts-ignore
  const gpuState = useRef<{
    device: GPUDevice | null;
    context: GPUCanvasContext | null;
    textures: GPUTexture[]; // [TextureA, TextureB]
    bindGroups: GPUBindGroup[][]; // [ [ComputeA, ComputeB], [RenderA, RenderB] ]
    computePipeline: GPUComputePipeline | null;
    renderPipeline: GPURenderPipeline | null;
    frameIndex: number; // 0 or 1 for ping-pong
    presentationFormat: GPUTextureFormat;
    animationFrameId: number;
  }>({
    device: null,
    context: null,
    textures: [],
    bindGroups: [[], []],
    computePipeline: null,
    renderPipeline: null,
    frameIndex: 0,
    presentationFormat: "rgba8unorm",
    animationFrameId: 0,
  });

  const [status, setStatus] = useState("Initializing WebGPU...");

  // ----------------------------------------------------------------------------------
  // --- 3. Animation Loop (Draw Frame) ---
  // ----------------------------------------------------------------------------------
  const drawFrame = () => {
    const state = gpuState.current;
    if (
      !state.device ||
      !state.context ||
      !state.computePipeline ||
      !state.renderPipeline
    ) {
      return;
    }

    // Ping-pong: currentBufferIndex is the buffer being read (Input), nextBufferIndex is the one being written (Output)
    const currentBufferIndex = state.frameIndex % 2;
    // const nextBufferIndex = (state.frameIndex + 1) % 2; // Not used directly here, only in the BindGroup

    // --- A. Compute Pass (Simulation: Read Current, Write Next) ---
    const computeEncoder = state.device.createCommandEncoder();
    const computePass = computeEncoder.beginComputePass();

    computePass.setPipeline(state.computePipeline);

    // BindGroup[0][currentBufferIndex]: Read A, Write B (if current=0), or Read B, Write A (if current=1)
    computePass.setBindGroup(0, state.bindGroups[0][currentBufferIndex]);

    const workgroupCountX = Math.ceil(WIDTH / WORKGROUP_SIZE);
    const workgroupCountY = Math.ceil(HEIGHT / WORKGROUP_SIZE);
    computePass.dispatchWorkgroups(workgroupCountX, workgroupCountY);

    computePass.end();
    state.device.queue.submit([computeEncoder.finish()]);

    // --- B. Render Pass (Display: Read Current Buffer) ---
    // Rendering always reads the state that was just INPUT (currentBufferIndex)
    const textureView = state.context.getCurrentTexture().createView();
    const renderEncoder = state.device.createCommandEncoder();

    const renderPass = renderEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: textureView,
          clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });

    renderPass.setPipeline(state.renderPipeline);

    // BindGroup[1][currentBufferIndex]: Reads the same buffer that was Input in the Compute Pass
    renderPass.setBindGroup(0, state.bindGroups[1][currentBufferIndex]);
    renderPass.draw(6); // Draw the full-screen quad
    renderPass.end();

    state.device.queue.submit([renderEncoder.finish()]);

    // --- C. Ping-Pong and Loop ---
    state.frameIndex++; // Changes "current" for the next iteration
    state.animationFrameId = requestAnimationFrame(drawFrame);
  };
  // ----------------------------------------------------------------------------------

  useEffect(() => {
    const initializeWebGPU = async () => {
      const canvasElement = canvasRef.current;
      if (!canvasElement) return;

      if (!("gpu" in navigator)) {
        setStatus("❌ Error: WebGPU is not available.");
        return;
      }

      try {
        // @ts-ignore
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) throw new Error("Could not get the GPU adapter.");

        const device = await adapter.requestDevice();
        const context = canvasElement.getContext("webgpu");
        if (!context) throw new Error("Could not get the 'webgpu' context.");
        // @ts-ignore
        const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
        // @ts-ignore
        context.configure({
          device: device,
          format: presentationFormat,
          alphaMode: "opaque",
        });

        gpuState.current.device = device;
        // @ts-ignore
        gpuState.current.context = context;
        gpuState.current.presentationFormat = presentationFormat;

        // --- 7. Create Textures (RGBA32Float) ---
        // @ts-ignore
        const textureDescriptor: GPUTextureDescriptor = {
          size: { width: WIDTH, height: HEIGHT },
          format: "rgba32float",
          usage:
            // @ts-ignore
            GPUTextureUsage.TEXTURE_BINDING |
            // @ts-ignore
            GPUTextureUsage.STORAGE_BINDING |
            // @ts-ignore
            GPUTextureUsage.COPY_DST,
        };

        const textureA = device.createTexture(textureDescriptor);
        const textureB = device.createTexture(textureDescriptor);
        gpuState.current.textures = [textureA, textureB];

        // **Initialize state (U=1.0, V=0.0)**
        const initialDataSize = WIDTH * HEIGHT * 4;
        const initialData = new Float32Array(initialDataSize).map(
          (_, index) => {
            if (index % 4 === 0) return 1.0; // R (U) = 1.0
            if (index % 4 === 3) return 1.0; // A = 1.0
            return 0.0; // G (V), B = 0.0
          }
        );

        const bytesPerRow = WIDTH * 4 * 4; // WIDTH * 16 bytes

        device.queue.writeTexture(
          { texture: textureA },
          initialData,
          { bytesPerRow: bytesPerRow, rowsPerImage: HEIGHT },
          { width: WIDTH, height: HEIGHT }
        );
        device.queue.writeTexture(
          { texture: textureB },
          initialData,
          { bytesPerRow: bytesPerRow, rowsPerImage: HEIGHT },
          { width: WIDTH, height: HEIGHT }
        );

        // --- 8. Create Pipelines (Using the new Shaders) ---
        const computeModule = device.createShaderModule({
          code: rdComputeShaderCode,
        });
        gpuState.current.computePipeline = device.createComputePipeline({
          layout: "auto",
          compute: { module: computeModule, entryPoint: "main" },
        });

        const renderModule = device.createShaderModule({
          code: rdRenderShaderCode,
        });
        gpuState.current.renderPipeline = device.createRenderPipeline({
          layout: "auto",
          vertex: { module: renderModule, entryPoint: "vs_main" },
          fragment: {
            module: renderModule,
            entryPoint: "fs_main",
            targets: [{ format: presentationFormat }],
          },
          primitive: { topology: "triangle-list" },
        });

        // --- 9. Create Bind Groups (Ping-Pong logic) ---
        const computeLayout =
          // @ts-ignore
          gpuState.current.computePipeline.getBindGroupLayout(0);
        const renderLayout =
          // @ts-ignore
          gpuState.current.renderPipeline.getBindGroupLayout(0);

        const computeBindGroupA = device.createBindGroup({
          layout: computeLayout,
          entries: [
            { binding: 0, resource: textureA.createView() }, // Input A
            { binding: 1, resource: textureB.createView() }, // Output B
          ],
        });
        const computeBindGroupB = device.createBindGroup({
          layout: computeLayout,
          entries: [
            { binding: 0, resource: textureB.createView() }, // Input B
            { binding: 1, resource: textureA.createView() }, // Output A
          ],
        });
        gpuState.current.bindGroups[0] = [computeBindGroupA, computeBindGroupB];

        const renderBindGroupA = device.createBindGroup({
          layout: renderLayout,
          entries: [{ binding: 0, resource: textureA.createView() }], // Read A
        });
        const renderBindGroupB = device.createBindGroup({
          layout: renderLayout,
          entries: [{ binding: 0, resource: textureB.createView() }], // Read B
        });
        gpuState.current.bindGroups[1] = [renderBindGroupA, renderBindGroupB];

        setStatus(`✅ WebGPU Initialized. Starting Reaction-Diffusion...`);
        // --- 10. Start the Simulation Loop ---
        gpuState.current.animationFrameId = requestAnimationFrame(drawFrame);
      } catch (error) {
        console.error("WebGPU Initialization Error:", error);
        setStatus("❌ Error accessing GPU device. Check console for details.");
      }
    };

    initializeWebGPU();
    // Cleanup function
    return () => {
      cancelAnimationFrame(gpuState.current.animationFrameId);
    };
  }, []);

  // --- 5. User Interaction (Mouse Click to Inject V) ---
  const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const state = gpuState.current;
    const canvasEl = event.currentTarget;
    if (!state.device || !state.context) return;

    const rect = canvasEl.getBoundingClientRect();
    const scaleX = canvasEl.width / rect.width;
    const scaleY = canvasEl.height / rect.height;
    const x = Math.min(
      canvasEl.width - 1,
      Math.floor((event.clientX - rect.left) * scaleX)
    );
    const y = Math.min(
      canvasEl.height - 1,
      Math.floor((event.clientY - rect.top) * scaleY)
    );

    const patchSize = 5; // 5x5 patch
    const impulse_V = 1.0;
    const impulse_U = 0.5;

    // **1. Create the full data array for the patch (5x5 pixels)**
    // (25 pixels * 4 components = 100 elements)
    const fullPatchData = new Float32Array(patchSize * patchSize * 4);

    // Fill the array with U and V values (uniform in the patch)
    for (let i = 0; i < patchSize * patchSize; i++) {
      const baseIndex = i * 4;
      fullPatchData[baseIndex] = impulse_U; // R (U)
      fullPatchData[baseIndex + 1] = impulse_V; // G (V)
      fullPatchData[baseIndex + 2] = 0.0; // B
      fullPatchData[baseIndex + 3] = 1.0; // A
    }

    const currentBufferIndex = state.frameIndex % 2;
    const writeTexture = state.textures[currentBufferIndex];

    // **2. Calculate CORRECT bytesPerRow**
    // 5 pixels wide * 16 bytes/pixel = 80 bytes
    const bytesPerRow = patchSize * 4 * 4;

    // **3. Write the full patch**
    state.device.queue.writeTexture(
      { texture: writeTexture, origin: { x: x - 2, y: y - 2 } }, // Start 2 pixels before
      fullPatchData, // Use the large array
      { bytesPerRow: bytesPerRow, rowsPerImage: patchSize }, // Indicate 5 rows
      { width: patchSize, height: patchSize } // Specify 5x5 to copy
    );
  };

  return (
    <div className="rootReactionDiffusionCanvas">
      <h2>WebGPU Gray-Scott Reaction-Diffusion</h2>
      <p className="pMargin0">
        Parameters: F=0.055, K=0.062 (Generates organic patterns)
      </p>
      <p className="pMargin0">Status: **{status}**</p>
      <p className="pMargin0" style={{ marginBottom: "10px" }}>
        **Click on the canvas to inject catalyst and start the reaction.**
      </p>
      <canvas
        ref={canvasRef}
        className="gpuCanvas"
        width={WIDTH}
        height={HEIGHT}
        onClick={handleCanvasClick}
      />
    </div>
  );
};
