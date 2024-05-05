import glbShaders from './glb_shaders.wgsl';

export class GLBShaderCache {
    constructor(device) {
        this.device = device;
        this.shaderCache = {};
    }

    getShader(hasNormals, hasUVs, hasColorTexture) {
        return this.device.createShaderModule({code: glbShaders});
    }
}