import {ArcballCamera} from "arcball_camera";
import {Controller} from "ez_canvas_controller";
import {mat4, vec3} from "gl-matrix";

import {uploadGLBModel} from "./glb_import.js";
import firstShaders from './first_shaders.wgsl';
import computeShaders from './compute_volumes.wgsl';
import secondShaders from './second_shaders.wgsl';
import thirdShaders from './third_shaders.wgsl';
import computeIndicesShaders from './compute_32bit_indices.wgsl';

function get_shadow_matrix(n, l ,x) {
    const d = - (n[0] * x[0] + n[1] * x[1] + n[2] * x[2]);
    const dotNL = n[0] * l[0] + n[1] * l[1] + n[2] * l[2];

    return new Float32Array([
        dotNL - n[0] * l[0] + d, -n[0] * l[1], -n[0] * l[2], -n[0],
        -n[1] * l[0], dotNL + d - n[1] * l[1], -n[1] * l[2], -n[1],
        -n[2] * l[0], -n[2] * l[1], dotNL - n[2] * l[2] - d, -n[2],
        -d * l[0], d * l[1], -d * l[2], dotNL
    ]);
}

(async () => {
    if (navigator.gpu === undefined) return;
    const adapter = await navigator.gpu.requestAdapter();

    if (!adapter) return;
    const device = await adapter.requestDevice();
    const glbFile = await fetch(
            "assets/scene_brazier.glb")
            .then(res => res.arrayBuffer().then(async (buf) => await uploadGLBModel(buf, device)));

    console.log(glbFile);
    const canvas = document.getElementById("webgpu-canvas");
    const context = canvas.getContext("webgpu");
    const swapChainFormat = "bgra8unorm";
    context.configure(
        {device: device, format: swapChainFormat, usage: GPUTextureUsage.RENDER_ATTACHMENT});

    const firstDepthTexture = device.createTexture({
        size: {width: canvas.width, height: canvas.height, depthOrArrayLayers: 1},
        format: "depth24plus-stencil8",
        usage: GPUTextureUsage.RENDER_ATTACHMENT
    });
    const firstDepthTextureView = firstDepthTexture.createView();
    //const thirdDepthTextureView = firstDepthTexture.createView();

    const secondDepthTexture = device.createTexture({
        size: {width: canvas.width, height: canvas.height, depthOrArrayLayers: 1},
        format: "depth24plus-stencil8",
        usage: GPUTextureUsage.RENDER_ATTACHMENT
    });
    const secondDepthTextureView = secondDepthTexture.createView();

    const viewParamsLayout = device.createBindGroupLayout({
        entries: [
            {binding: 0, visibility: GPUShaderStage.VERTEX, buffer: {type: "uniform"}},
            {binding: 1, visibility: GPUShaderStage.VERTEX, buffer: {type: "uniform"}},
            {binding: 2, visibility: GPUShaderStage.VERTEX, buffer: {type: "uniform"}},
        ]
    });
    const nodeParamsLayout = device.createBindGroupLayout({
        entries: [
            {binding: 0, visibility: GPUShaderStage.VERTEX, buffer: {type: 'uniform'}},
            {binding: 1, visibility: GPUShaderStage.VERTEX, buffer: {type: 'uniform'}},
            {binding: 2, visibility: GPUShaderStage.VERTEX, buffer: {type: 'uniform'}}
        ]
    });
    const materialBindGroupLayout = device.createBindGroupLayout({
        entries: [
            {binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: {type: 'uniform'}}
        ]
    });

    const projectionBuffer = device.createBuffer(
        {size: 4 * 4 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
    const viewBuffer = device.createBuffer(
        {size: 4 * 4 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
    const modelBuffer = device.createBuffer({
        size: 4 * 4 * 4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const viewParamsBindGroup = device.createBindGroup(
        {layout: viewParamsLayout, entries: [
            {binding: 0, resource: {buffer: projectionBuffer}},
            {binding: 1, resource: {buffer:viewBuffer}},
            {binding: 2, resource: {buffer:modelBuffer}},
        ]}
    );

    const vertexBuffers = [{
        arrayStride: 12, 
        attributes: [{format: 'float32x3', offset: 0, shaderLocation: 0}]
    }];
    vertexBuffers.push({
        arrayStride: 12,
        attributes: [{format: 'float32x3', offset: 0, shaderLocation: 1}]
    });

    const firstShaderModule = device.createShaderModule({code: firstShaders});
    const computeIndicesShadersModule = device.createShaderModule({code: computeIndicesShaders});
    const computeShadersModule = device.createShaderModule({code: computeShaders});
    const secondShaderModule = device.createShaderModule({code: secondShaders});
    const thirdShaderModule = device.createShaderModule({code: thirdShaders});

    const tempCommandEncoder = device.createCommandEncoder();

    const firstRenderPassDesc = {
        colorAttachments: [{
            view: undefined,
            loadOp: "clear",
            clearValue: [0.3, 0.3, 0.3, 1],
            storeOp: "store"
        }],
        depthStencilAttachment: {
            view: firstDepthTextureView,
            depthLoadOp: 'clear',
            depthClearValue: 1,
            depthStoreOp: 'store',
            stencilLoadOp: 'clear',
            stencilClearValue: 0,
            stencilStoreOp: 'store',
        }
    };
     
    const firstPipelineLayout = device.createPipelineLayout({
        bindGroupLayouts:
            [viewParamsLayout, nodeParamsLayout, materialBindGroupLayout]
    });

    const firstPipelineDescriptor = {
        label: "First Pipeline",
        layout: firstPipelineLayout,
        vertex: {
            module: firstShaderModule,
            entryPoint: 'first_vertex_main',
            buffers: vertexBuffers
        },
        fragment: {
            module: firstShaderModule,
            entryPoint: 'first_fragment_main',
            targets:[{
                format: swapChainFormat,
                blend: {
                    color: {
                        srcFactor: 'src-alpha',
                        dstFactor: 'one-minus-src-alpha',
                        operation: 'add'
                    },
                    alpha: {
                        srcFactor: 'one',
                        dstFactor: 'one-minus-src-alpha',
                        operation: 'add'
                    }
                },
            }],
            writeMask: GPUColorWrite.ALL
        },
        primitive: {
            topology: 'triangle-list',
            cullMode: 'back'
        },
        depthStencil: {
            format: 'depth24plus-stencil8',
            depthWriteEnabled: true,
            depthCompare: 'less-equal',
            stencilFront: null,
            stencilBack: null
        },
    };

    const firstRenderPipeline = device.createRenderPipeline(firstPipelineDescriptor);

    const firstRenderBundles = glbFile.buildRenderBundles(
        device, viewParamsLayout, viewParamsBindGroup, null, null, firstRenderPipeline, swapChainFormat);

    const positions = glbFile.nodes[1].mesh.primitives[0].positions;
    const positionsData = glbFile.nodes[1].mesh.primitives[0].positions.view.gpuBuffer
    const normalsData = glbFile.nodes[1].mesh.primitives[0].normals.view.gpuBuffer
    const indicesData = glbFile.nodes[1].mesh.primitives[0].indices.view.gpuBuffer
    const modelMatrixData = glbFile.nodes[1].modelMatrix;

    const positionsBuffer = device.createBuffer({
        label: "positions for volumes",
        size: positionsData.size,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.VERTEX |  GPUBufferUsage.COPY_SRC,
    });
    const normalsBuffer = device.createBuffer({
        label: "normals for volumes",
        size: normalsData.size,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const indicesBuffer = device.createBuffer({
        label: "indices for volumes",
        size: indicesData.size,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.INDEX
    });
    const inverse_transpose = mat4.create();
    mat4.invert(inverse_transpose, modelMatrixData);
    mat4.transpose(inverse_transpose, inverse_transpose);

    const inverseTransposeBuffer = device.createBuffer(
        {size: 4 * 4 * 4, usage: GPUBufferUsage.UNIFORM, mappedAtCreation: true});
    new Float32Array(inverseTransposeBuffer.getMappedRange()).set(inverse_transpose);
    inverseTransposeBuffer.unmap();

    // Copy data from the original buffer to the new buffer
    tempCommandEncoder.copyBufferToBuffer(
        positionsData, // Source buffer
        0,               // Source offset
        positionsBuffer,       // Destination buffer
        0,               // Destination offset
        positionsData.size       // Size of the data to copy
    );

    tempCommandEncoder.copyBufferToBuffer(
        normalsData, // Source buffer
        0,               // Source offset
        normalsBuffer,       // Destination buffer
        0,               // Destination offset
        normalsData.size       // Size of the data to copy
    );

    tempCommandEncoder.copyBufferToBuffer(
        indicesData, // Source buffer
        0,               // Source offset
        indicesBuffer,       // Destination buffer
        0,               // Destination offset
        indicesData.size       // Size of the data to copy
    );

    tempCommandEncoder.copyBufferToBuffer(
        modelMatrixData, // Source buffer
        0,               // Source offset
        modelBuffer,       // Destination buffer
        0,               // Destination offset
        modelMatrixData.size       // Size of the data to copy
    );

    // Submit the command encoder to the GPU queue
    const commands = tempCommandEncoder.finish();
    device.queue.submit([commands]);






    const computeIndicesBindGroupLayout = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
            { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, 
        ],
    });

    const computeIndicesBuffer = device.createBuffer({
        size: indicesBuffer.size * 2, // 4x the size to account for extruded vertices
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });

    const computeIndicesBindGroup = device.createBindGroup({
        layout: computeIndicesBindGroupLayout,
        entries: [
            { binding: 0, resource: { buffer: indicesBuffer } },
            { binding: 1, resource: { buffer: computeIndicesBuffer } },
        ],
    });

    const computeIndicesPipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [computeIndicesBindGroupLayout]
    });
    const computeIndicesPipeline = device.createComputePipeline({
        label: "generate indices",
        layout: computeIndicesPipelineLayout,
        compute: {
            module: computeIndicesShadersModule,
            entryPoint: "main"
        }
    });
    
    const commandEncoderIndices = device.createCommandEncoder();

    const computeIndicesPass = commandEncoderIndices.beginComputePass();
    computeIndicesPass.setPipeline(computeIndicesPipeline);
    computeIndicesPass.setBindGroup(0, computeIndicesBindGroup);
    const numTriangles = positions.count * 7;
    computeIndicesPass.dispatchWorkgroups(numTriangles, 1, 1);

    computeIndicesPass.end();

    device.queue.submit([commandEncoderIndices.finish()]);




    const shadowVolumePositionsBuffer = device.createBuffer({
        size: positionsData.size * 8,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });

    const shadowVolumeCountBuffer = device.createBuffer({
        size: 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        mappedAtCreation: true,
    });
    new Uint32Array(shadowVolumeCountBuffer.getMappedRange())[0] = 0;
    shadowVolumeCountBuffer.unmap();

    const shadowVolumeIndicesBuffer = device.createBuffer({
        size: computeIndicesBuffer.size * 6,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });


    const computeBindGroupLayout = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } }, // model
            { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } }, // view
            { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } }, // inverse_transpose
            { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // positions buffer (input)
            { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // normals buffer (input)
            { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // index buffer (input)
            { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // Shadow volume vertices buffer (output)
            { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // Atomic shadow volume vertex count buffer
            { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, 
        ],
    });

    const computeBindGroup = device.createBindGroup({
        layout: computeBindGroupLayout,
        entries: [
            { binding: 0, resource: { buffer: modelBuffer } },
            { binding: 1, resource: { buffer: viewBuffer } },
            { binding: 2, resource: { buffer: inverseTransposeBuffer } },
            { binding: 3, resource: { buffer: positionsBuffer } },
            { binding: 4, resource: { buffer: normalsBuffer } },
            { binding: 5, resource: { buffer: computeIndicesBuffer } },
            { binding: 6, resource: { buffer: shadowVolumePositionsBuffer } },
            { binding: 7, resource: { buffer: shadowVolumeCountBuffer } },
            { binding: 8, resource: { buffer: shadowVolumeIndicesBuffer } },
        ],
    });

    const computePipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [computeBindGroupLayout]
    });
    const computePipeline = device.createComputePipeline({
        label: "generate volumes",
        layout: computePipelineLayout,
        compute: {
            module: computeShadersModule,
            entryPoint: "main"
        }
    });

    const secondProjectionBuffer = device.createBuffer(
        {size: 4 * 4 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});

    const secondViewParamsLayout = device.createBindGroupLayout({
        entries: [
            {binding: 0, visibility: GPUShaderStage.VERTEX, buffer: {type: "uniform"}},
            {binding: 1, visibility: GPUShaderStage.VERTEX, buffer: {type: "uniform"}},
            {binding: 2, visibility: GPUShaderStage.VERTEX, buffer: {type: "uniform"}},
        ]
    });
    const secondViewParamsBindGroup = device.createBindGroup(
        {layout: viewParamsLayout, entries: [
            {binding: 0, resource: {buffer: secondProjectionBuffer}},
            {binding: 1, resource: {buffer: viewBuffer}},
            {binding: 2, resource: {buffer: modelBuffer}},
        ]}
    );

    const secondPipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [secondViewParamsLayout]
    });
    const volumeVertexBuffers = [{
        arrayStride: 16,
        attributes: [{format: 'float32x4', offset: 0, shaderLocation: 0}]
    }];
    const secondPipelineDescriptor = {
        label: 'Second Pipeline',
        layout: secondPipelineLayout,
        vertex: {
            module: secondShaderModule,
            entryPoint: 'second_vertex_main',
            buffers: volumeVertexBuffers
        },
        fragment: {
            module: secondShaderModule,
            entryPoint: 'second_fragment_main',
            targets: [{
                format: swapChainFormat,
                blend: {
                    color: {
                        srcFactor: 'src-alpha',
                        dstFactor: 'one-minus-src-alpha',
                        operation: 'add',
                    },
                    alpha: {
                        srcFactor: 'one',
                        dstFactor: 'one-minus-src-alpha',
                        operation: 'add',
                    },
                    writeMask: GPUColorWrite.ALL,
                }
            }],
        },
        primitive: {
            cullMode: 'none'
        },
        depthStencil: {
            depthWriteEnabled: false, // Don't write to depth buffer
            depthCompare: 'greater', // But do use depth test
            format: 'depth24plus-stencil8',
            stencilFront: {
                compare: 'always',
                failOp: 'keep',
                depthFailOp: 'increment-wrap',
                passOp: 'keep',
            },
            stencilBack: {
                compare: 'always',
                failOp: 'keep',
                depthFailOp: 'decrement-wrap',
                passOp: 'keep',
            },
            stencilReadMask: 0xFF,
            stencilWriteMask: 0xFF,
        },
    };
    const secondRenderPipeline = device.createRenderPipeline(secondPipelineDescriptor);

    const secondRenderPassDesc = {
        colorAttachments: [{
            loadOp: 'load',
            storeOp: 'store'
        }],
        depthStencilAttachment: {
            view: firstDepthTextureView,
            depthLoadOp: 'load',
            depthStoreOp: 'store',
            stencilLoadOp: 'clear',
            stencilClearValue: 0,
            stencilStoreOp: 'store',
        }
    };
    
    const vertexCount = new Uint32Array(1);

    const shadowVolumeVertexCountReadBuffer = device.createBuffer({
        size: vertexCount.byteLength,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    
    const secondBundleEncoder = device.createRenderBundleEncoder({
        colorFormats: [swapChainFormat],
        depthStencilFormat: 'depth24plus-stencil8',
    });
    secondBundleEncoder.setPipeline(secondRenderPipeline);
    secondBundleEncoder.setVertexBuffer(0, shadowVolumePositionsBuffer);
    secondBundleEncoder.setBindGroup(0, secondViewParamsBindGroup);

    // Draw the new triangle
    secondBundleEncoder.setIndexBuffer(shadowVolumeIndicesBuffer,
        'uint32',
        0);
    secondBundleEncoder.drawIndexed(positions.count * 6);
    //bundleEncoder.draw(positions.count * 7);
    const secondRenderBundles = [secondBundleEncoder.finish()];

    const thirdRenderPassDesc = {
        colorAttachments: [{
            loadOp: 'load',
            storeOp: 'store',
        }],
        depthStencilAttachment: {
            view: firstDepthTextureView,
            depthLoadOp: 'load',
            depthStoreOp: 'store',
            stencilLoadOp: 'load',
            stencilStoreOp: 'store',
        },
    }

    const thirdPipelineLayout = device.createPipelineLayout({
        bindGroupLayouts:
            [viewParamsLayout, nodeParamsLayout, materialBindGroupLayout]
    });

    const thirdPipelineDescriptor = {
        label: "Third Pipeline",
        layout: thirdPipelineLayout,
        vertex: {
            module: thirdShaderModule,
            entryPoint: 'third_vertex_main',
            buffers: vertexBuffers
        },
        fragment: {
            module: thirdShaderModule,
            entryPoint: 'third_fragment_main',
            targets: [{
                format: swapChainFormat, 
                blend: {
                    color: {
                        srcFactor: 'src-alpha',
                        dstFactor: 'one-minus-src-alpha',
                        operation: 'add'
                    },
                    alpha: {
                        srcFactor: 'one',
                        dstFactor: 'one-minus-src-alpha',
                        operation: 'add'
                    }
                },
            }],
            writeMask: GPUColorWrite.ALL,
        },
        primitive: {
            topology: 'triangle-list',
            cullMode: 'back',
        },
        depthStencil: {
            format: 'depth24plus-stencil8',
            depthWriteEnabled: false,
            depthCompare: 'less-equal',
            stencilFront: {
                compare: 'equal',
                failOp: 'keep',
                depthFailOp: 'keep',
                passOp: 'keep',
            },
            stencilReadMask: 0xFF,
            stencilWriteMask: 0xFF,
        },
    }

    const thirdRenderPipeline = device.createRenderPipeline(thirdPipelineDescriptor);
    const thirdRenderBundles = glbFile.buildRenderBundles(
            device, viewParamsLayout, viewParamsBindGroup, null, null, thirdRenderPipeline, swapChainFormat);

    const defaultEye = vec3.set(vec3.create(), 3.0, 4.0, 8.0);
    const center = vec3.set(vec3.create(), -5.0, -3.0, 0.0);
    const up = vec3.set(vec3.create(), 0.0, 1.0, 0.0);
    const camera = new ArcballCamera(defaultEye, center, up, 2, [canvas.width, canvas.height]);
    const projection_matrix = mat4.perspective(
        mat4.create(), 50 * Math.PI / 180.0, canvas.width / canvas.height, 0.1, 1000);
    const left = -10;
    const right = 10;
    const bottom = -10;
    const top = 10;
    const near = -1000000;
    const ortho_matrix = mat4.ortho(mat4.create(), left, right, bottom, top, near, null);

    const controller = new Controller();
    controller.mousemove = function (prev, cur, evt) {
        if (evt.buttons == 1) {
            camera.rotate(prev, cur);

        } else if (evt.buttons == 2) {
            camera.pan([cur[0] - prev[0], prev[1] - cur[1]]);
        }
    };
    controller.wheel = function (amt) {
        camera.zoom(amt * 0.5);
    };
    controller.pinch = controller.wheel;
    controller.twoFingerDrag = function (drag) {
        camera.pan(drag);
    };
    camera.pan([-250, -70]);
    camera.rotate([0, 0], [-200, 0]);
    controller.registerForCanvas(canvas);

    const n = [0, 1, 0, 0]
    const l = [10, 10, 0];
    const x = [0, -0.01, 0]
    const shadow_matrix = get_shadow_matrix(n, l, x);

    const fov = (2 * Math.PI) / 5;
    const aspect = 1.0;
    //const near = -200;
    //const far = 30;
    

    const fpsDisplay = document.getElementById("fps");
    let numFrames = 0;
    let totalTimeMS = 0;
    let t = 1;
    const render = async () => {        
        const commandEncoder = device.createCommandEncoder();

        const start = performance.now();
        const colorTextureView = context.getCurrentTexture().createView();
        firstRenderPassDesc.colorAttachments[0].view = colorTextureView;
        secondRenderPassDesc.colorAttachments[0].view = colorTextureView
        thirdRenderPassDesc.colorAttachments[0].view = colorTextureView;

        const view_matrix = camera.camera;
        device.queue.writeBuffer(projectionBuffer, 0, projection_matrix);
        device.queue.writeBuffer(viewBuffer, 0, view_matrix);
        device.queue.writeBuffer(secondProjectionBuffer, 0, projection_matrix);

        const firstRenderPass = commandEncoder.beginRenderPass(firstRenderPassDesc);
        firstRenderPass.executeBundles(firstRenderBundles);
        firstRenderPass.end();

        const computePass = commandEncoder.beginComputePass();
        computePass.setPipeline(computePipeline);
        computePass.setBindGroup(0, computeBindGroup);
        const numTriangles = positions.count * 6;
        computePass.dispatchWorkgroups(numTriangles, 1, 1);

        computePass.end();

        const secondRenderPass = commandEncoder.beginRenderPass(secondRenderPassDesc);
        secondRenderPass.executeBundles(secondRenderBundles);
        secondRenderPass.end();

        const thirdRenderPass = commandEncoder.beginRenderPass(thirdRenderPassDesc);
        thirdRenderPass.setStencilReference(0);
        thirdRenderPass.executeBundles(thirdRenderBundles);
        thirdRenderPass.end();

        device.queue.submit([commandEncoder.finish()]);
        await device.queue.onSubmittedWorkDone();


        const computeCommandEncoder = device.createCommandEncoder();
        computeCommandEncoder.copyBufferToBuffer(
            shadowVolumeCountBuffer, 0, shadowVolumeVertexCountReadBuffer, 0, vertexCount.byteLength
        );    
        device.queue.submit([computeCommandEncoder.finish()]);
        await shadowVolumeVertexCountReadBuffer.mapAsync(GPUMapMode.READ);
        shadowVolumeVertexCountReadBuffer.unmap();

        

        const end = performance.now();
        numFrames += 1;
        totalTimeMS += end - start;
        fpsDisplay.innerHTML = `Avg. FPS ${Math.round(1000.0 * numFrames / totalTimeMS)}`;
        requestAnimationFrame(render);
    };
    requestAnimationFrame(render);
})();

