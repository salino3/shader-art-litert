declare global {
  interface GPUDevice extends EventTarget {
    label: string;
    createCommandEncoder(descriptor?: any): any;
    queue: any;
  }
  interface GPUCanvasContext extends EventTarget {
    label: string;
    getCurrentTexture(): any;
  }
  interface GPUTexture extends EventTarget {
    label: string;
  }
  interface GPUBindGroup extends EventTarget {
    label: string;
  }
  interface GPUComputePipeline extends EventTarget {
    label: string;
  }
  interface GPURenderPipeline extends EventTarget {
    label: string;
  }
  interface GPUSampler extends EventTarget {
    label: string;
  }
  interface GPUTextureFormat extends EventTarget {
    label: string;
  }

  interface GPUAdapter {}
}

export {};
