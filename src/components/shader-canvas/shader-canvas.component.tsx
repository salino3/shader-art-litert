import React, { useEffect, useRef, useState } from "react";

// Canvas dimensions
const WIDTH: number = 700;
const HEIGHT: number = 450;

const WORKGROUP_SIZE: number = 8;

// --- 1. Compute Shader: Wave Propagation (Simplified) ---
// Calculates the next waveform state by reading from the current state (inputTexture).
// --- 1. Compute Shader: Wave Propagation (CORREGIDO: Tipos i32 para coordenadas) ---
const waveComputeShaderCode: string = `
    // Binding 0: Input Texture (Buffer A: Current State)
    @group(0) @binding(0) var inputTexture: texture_2d<f32>;

    // Binding 1: Output Texture (Buffer B: Next State)
    @group(0) @binding(1) var outputTexture: texture_storage_2d<rgba16float, write>;

    // Simulation constants
    const DAMPING: f32 = 0.99;
    const STRENGTH: f32 = 0.5;

    @compute
    @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE}, 1)
    fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
        // CORRECCIÓN A: Usar i32 para las coordenadas para poder restar
        let coords = vec2<i32>(global_id.xy); 
        
        let size = vec2<i32>(textureDimensions(inputTexture));

        // La comprobación de límites también debe usar coords de tipo i32 (la función size devuelve i32)
        if (coords.x >= size.x || coords.y >= size.y || coords.x < 0 || coords.y < 0) {
            return;
        }

        // Load current wave value (Red component)
        let current_val = textureLoad(inputTexture, coords, 0).r;
        // Load previous wave value (Green component, for velocity/previous height)
        let prev_val = textureLoad(inputTexture, coords, 0).g;

        // Calculate Laplacian (average difference from neighbors)
        var sum_neighbors: f32 = 0.0;
        
        // Sum the 4 direct neighbors
        // CORRECCIÓN B: Los vectores de desplazamiento también usan i32
        sum_neighbors += textureLoad(inputTexture, coords + vec2<i32>(-1, 0), 0).r;
        sum_neighbors += textureLoad(inputTexture, coords + vec2<i32>(1, 0), 0).r;
        sum_neighbors += textureLoad(inputTexture, coords + vec2<i32>(0, -1), 0).r;
        sum_neighbors += textureLoad(inputTexture, coords + vec2<i32>(0, 1), 0).r;
        
        let laplacian = sum_neighbors - 4.0 * current_val;
        
        // Simplified wave equation (using previous state for velocity)
        let new_val = 2.0 * current_val - prev_val + laplacian * STRENGTH;
        let damped_new_val = new_val * DAMPING;

        // Write result to Buffer B (Next State)
        textureStore(outputTexture, coords, vec4<f32>(damped_new_val, current_val, 0.0, 1.0));
    }
`;

// --- 2. Render Shader: Read Texture and Color ---
// Draw the quad and read the simulation texture to color the pixels.
// --- 2. Render Shader: Read Texture and Color (CORREGIDO: Usa textureLoad) ---
const renderShaderCode: string = `
    // Binding 0: Simulation Texture (Buffer A) - Now we read the height without filtering.
    // La declaramos como texture_2d<f32>
    @group(0) @binding(0) 
    var simulationTexture: texture_2d<f32>; 
    
    // Binding 1: Sampler (Muestreador) - ELIMINADO

    // Vertex Shader: Full-screen quad
    @vertex
    fn vs_main(@builtin(vertex_index) vertex_index: u32) -> @builtin(position) vec4<f32> {
        var pos = array<vec2<f32>, 6>(
            vec2<f32>( 1.0,  1.0), vec2<f32>( 1.0, -1.0), vec2<f32>(-1.0, -1.0),
            vec2<f32>( 1.0,  1.0), vec2<f32>(-1.0, -1.0), vec2<f32>(-1.0,  1.0)
        );
        return vec4<f32>(pos[vertex_index], 0.0, 1.0);
    }

    // Fragment Shader: Color based on wave height
    @fragment
    fn fs_main(@builtin(position) frag_coord: vec4<f32>) -> @location(0) vec4<f32> {
        // 1. Get integer pixel coordinates (i32)
        let coords = vec2<i32>(frag_coord.xy); 
        
        // 2. Read the waveform value directly using textureLoad (without sampling)
        // textureLoad(textura, coordenadas, nivel_mipmap).r
        let waveValue = textureLoad(simulationTexture, coords, 0).r; 

        let amplifiedValue = waveValue * 5.0;
        // Map the wave value [0, 1] to a color (e.g., dark blue to white)
        let clampedValue = clamp(amplifiedValue, 0.0, 1.0);

        let color = mix(vec3<f32>(0.0, 0.2, 0.8), vec3<f32>(1.0, 1.0, 1.0), clampedValue);
        
        return vec4<f32>(color, 1.0);
    }
`;

export const ShaderCanvas: React.FC = () => {
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
    sampler: GPUSampler | null;
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
    sampler: null,
    frameIndex: 0,
    presentationFormat: "rgba8unorm",
    animationFrameId: 0,
  });

  const [status, setStatus] = useState("Initializing WebGPU...");

  // --- 3. Animation Loop (Draw Frame) ---
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

    // Ping-pong indices: [0] is current (read), [1] is next (write)
    const currentBufferIndex = state.frameIndex % 2;
    // TODO: delete? const nextBufferIndex = (state.frameIndex + 1) % 2;

    // --- A. Compute Pass (Simulation: Read Current, Write Next) ---
    const computeEncoder = state.device.createCommandEncoder();
    const computePass = computeEncoder.beginComputePass();
    computePass.setPipeline(state.computePipeline);

    // Use the Bind Group that reads the current buffer and writes to the next buffer
    // BindGroup[0][currentBufferIndex] reads current/writes next
    computePass.setBindGroup(0, state.bindGroups[0][currentBufferIndex]);

    // Dispatch: Launch one workgroup for every 8x8 block of pixels
    const workgroupCountX = Math.ceil(WIDTH / WORKGROUP_SIZE);
    const workgroupCountY = Math.ceil(HEIGHT / WORKGROUP_SIZE);
    computePass.dispatchWorkgroups(workgroupCountX, workgroupCountY);

    computePass.end();
    // @ts-ignore
    state.device.queue.submit([computeEncoder.finish()]);

    // --- B. Render Pass (Display: Read Current Buffer) ---
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

    // Use the Render Bind Group that reads the CURRENT buffer
    // BindGroup[1][currentBufferIndex] reads current
    renderPass.setBindGroup(0, state.bindGroups[1][currentBufferIndex]);
    renderPass.draw(6); // Draw the full-screen quad
    renderPass.end();

    state.device.queue.submit([renderEncoder.finish()]);

    // --- C. Ping-Pong and Loop ---
    state.frameIndex++;
    state.animationFrameId = requestAnimationFrame(drawFrame);
  };

  // --- 4. WebGPU Initialization ---
  useEffect(() => {
    const initializeWebGPU = async () => {
      const canvasElement = canvasRef.current;
      if (!canvasElement) return;

      // ... (1 to 6: Adapter, Device, Context configuration - same as before) ...
      if (!("gpu" in navigator)) {
        setStatus("❌ Error: WebGPU is not available.");
        return;
      }

      try {
        // @ts-ignore
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
          setStatus("❌ Error: Could not get the GPU adapter.");
          return;
        }

        const device = await adapter.requestDevice();
        const context = canvasElement.getContext("webgpu");
        if (!context) {
          setStatus("❌ Error: Could not get the 'webgpu' context.");
          return;
        }
        // @ts-ignore
        const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
        // @ts-ignore
        context.configure({
          device: device,
          format: presentationFormat,
          alphaMode: "opaque",
        });

        // Store state objects
        gpuState.current.device = device;
        // @ts-ignore
        gpuState.current.context = context;
        gpuState.current.presentationFormat = presentationFormat;

        // --- 7. Create Textures and Sampler (Double Buffer) ---

        // @ts-ignore
        const textureDescriptor: GPUTextureDescriptor = {
          size: { width: WIDTH, height: HEIGHT },
          format: "rgba16float", // High precision for simulation
          usage:
            // @ts-ignore
            GPUTextureUsage.RENDER_ATTACHMENT | // Can be a render target (optional)
            // @ts-ignore
            GPUTextureUsage.TEXTURE_BINDING | // Can be read by shaders
            // @ts-ignore
            GPUTextureUsage.STORAGE_BINDING | // Can be written by compute shaders
            // @ts-ignore
            GPUTextureUsage.COPY_DST, // Can be written from the CPU
        };

        // Texture A and Texture B
        const textureA = device.createTexture(textureDescriptor);
        const textureB = device.createTexture(textureDescriptor);
        gpuState.current.textures = [textureA, textureB];

        // --- 8. Create Pipelines ---

        // 8.1 Compute Pipeline
        const computeModule = device.createShaderModule({
          code: waveComputeShaderCode,
        });
        gpuState.current.computePipeline = device.createComputePipeline({
          layout: "auto",
          compute: { module: computeModule, entryPoint: "main" },
        });

        // 8.2 Render Pipeline
        const renderModule = device.createShaderModule({
          code: renderShaderCode,
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

        // --- 9. Create Bind Groups (Connecting Textures to Pipelines) ---

        // Compute Bind Groups (reads A -> writes B) AND (reads B -> writes A)
        // ... (The Compute Bind Group code is correct, leaving it as is)
        const computeBindGroupA = device.createBindGroup({
          // Reads A, Writes B
          // @ts-ignore
          layout: gpuState.current.computePipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: textureA.createView() },
            { binding: 1, resource: textureB.createView() },
          ],
        });
        const computeBindGroupB = device.createBindGroup({
          // Reads B, Writes A
          // @ts-ignore
          layout: gpuState.current.computePipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: textureB.createView() },
            { binding: 1, resource: textureA.createView() },
          ],
        });
        gpuState.current.bindGroups[0] = [computeBindGroupA, computeBindGroupB];

        // Render Bind Groups (Reads A) AND (Reads B)

        const renderBindGroupA = device.createBindGroup({
          // Reads A
          // @ts-ignore
          layout: gpuState.current.renderPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: textureA.createView() }, // Texture View Only
          ],
        });
        const renderBindGroupB = device.createBindGroup({
          // Reads B
          // @ts-ignore
          layout: gpuState.current.renderPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: textureB.createView() }, // Texture View Only
          ],
        });
        gpuState.current.bindGroups[1] = [renderBindGroupA, renderBindGroupB];

        // --- 10. Start the Simulation Loop ---
        setStatus(`✅ WebGPU Initialized. Starting Wave Simulation...`);
        gpuState.current.animationFrameId = requestAnimationFrame(drawFrame);
      } catch (error) {
        console.error("WebGPU Initialization Error:", error);
        setStatus("❌ Error accessing GPU device. Check console for details.");
      }
    };

    initializeWebGPU();

    // Cleanup function when the component unmounts
    return () => {
      cancelAnimationFrame(gpuState.current.animationFrameId);
      // Optionally: destroy device and textures if necessary
    };
  }, []);

  // --- 5. User Interaction (Mouse Click to Drop Wave) ---
  const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const state = gpuState.current;
    if (!state.device || !state.context) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.floor(event.clientX - rect.left);
    const y = Math.floor(event.clientY - rect.top);

    // Data to "drop" the wave (a small impulse)
    // [R=Impulse_Height, G=Previous_Height, B=0, A=1]
    const impulseValue = 1.0;
    const dropData = new Float32Array([impulseValue, 0.0, 0.0, 1.0]);

    // Determine which texture is currently the "next" buffer
    const currentBufferIndex = state.frameIndex % 2;
    const writeTexture = state.textures[currentBufferIndex];

    // Write the impulse data directly to the texture
    state.device.queue.writeTexture(
      { texture: writeTexture, origin: { x, y } }, // Destination
      dropData, // Data source
      { bytesPerRow: 8, rowsPerImage: 1 }, // Layout (4 bytes/f32 * 4 components = 16)
      { width: 1, height: 1, depthOrArrayLayers: 1 } // Size of data to copy
    );
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-start",
      }}
    >
      <h2>WebGPU Wave Simulator (Native)</h2>
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        style={{ border: "1px solid #ccc", cursor: "pointer" }}
        onClick={handleCanvasClick}
      />
      <p>Status: **{status}**</p>
      <p style={{ marginTop: "10px" }}>
        **Click on the canvas to create a wave.**
      </p>
    </div>
  );
};
