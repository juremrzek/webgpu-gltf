import {ArcballCamera} from "arcball_camera";
import {Controller} from "ez_canvas_controller";
import {mat4, vec3} from "gl-matrix";

import {uploadGLBModel} from "./glb_import.js";
import firstShaders from './first_shaders.wgsl';
import computeShaders from './compute_volumes.wgsl';
import secondShaders from './second_shaders.wgsl';
import thirdShaders from './third_shaders.wgsl';

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
            "assets/scene_cube_no_walls.glb")
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

    /*const mapRenderLayout = device.createBindGroupLayout({
        entries: [
            {
                binding: 0, 
                visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                buffer: { type: 'uniform' }
            },
            {
                binding: 1,
                visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                texture: { sampleType: 'depth'},
            },
            {
                binding: 2,
                visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                sampler: { type: 'comparison' },
            }
        ]
    });*/

    const lightViewProjBuffer = device.createBuffer(
        {size: 4 * 4 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
    /*const mapBindGroup = device.createBindGroup({
        layout: mapRenderLayout, 
        entries: [
            {
                binding: 0,
                resource: {
                buffer: lightViewProjBuffer,
                },
            },
            {
                binding: 1,
                resource: firstDepthTextureView,
            },
            {
                binding: 2,
                resource: device.createSampler({
                    compare: 'less',
                }),
            },
            ],
        }
    );*/

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

    const primitive = {
        topology: 'triangle-list',
    };

    const vertexBuffers = [{
        arrayStride: 12, 
        attributes: [{format: 'float32x3', offset: 0, shaderLocation: 0}]
    }];
    vertexBuffers.push({
        arrayStride: 12,
        attributes: [{format: 'float32x3', offset: 0, shaderLocation: 1}]
    });

    const firstShaderModule = device.createShaderModule({code: firstShaders});
    const computeShadersModule = device.createShaderModule({code: computeShaders});
    const secondShaderModule = device.createShaderModule({code: secondShaders});
    const thirdShaderModule = device.createShaderModule({code: thirdShaders});

    const commandEncoder = device.createCommandEncoder();
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
            stencilLoadValue: 0,
            stencilStoreOp: 'discard',
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
            depthCompare: 'less-equal'
        },
    };

    const firstRenderPipeline = device.createRenderPipeline(firstPipelineDescriptor);

    const firstRenderBundles = glbFile.buildRenderBundles(
        device, viewParamsLayout, viewParamsBindGroup, null, null, firstRenderPipeline, swapChainFormat);

    const positionsData = glbFile.nodes[1].mesh.primitives[1].positions.view.gpuBuffer
    const normalsData = glbFile.nodes[1].mesh.primitives[1].normals.view.gpuBuffer
    const indicesData = glbFile.nodes[1].mesh.primitives[1].indices.view.gpuBuffer
    const modelMatrixData = glbFile.nodes[1].modelMatrix;

    const positionsBuffer = device.createBuffer({
        label: "positions for volumes",
        size: positionsData.size,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const normalsBuffer = device.createBuffer({
        label: "normals for volumes",
        size: normalsData.size,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const indicesBuffer = device.createBuffer({
        label: "indices for volumes",
        size: indicesData.size,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

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

    const shadowVolumeBuffer = device.createBuffer({
        size: positionsBuffer.size * 4, // 4x the size to account for extruded vertices
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX,
    });

    const shadowVolumeCountBuffer = device.createBuffer({
        size: 4, // 4x the size to account for extruded vertices
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        mappedAtCreation: true,
    });
    new Uint32Array(shadowVolumeCountBuffer.getMappedRange())[0] = 0;
    shadowVolumeCountBuffer.unmap();

    console.log("normals buffer:");
    console.log(normalsBuffer);

    console.log("poiitons buffer:");
    console.log(positionsBuffer);

    console.log("shadow volume buffer:")
    console.log(shadowVolumeBuffer);

    console.log("shadow volume count buffer:")
    console.log(shadowVolumeCountBuffer);

    const computeBindGroupLayout = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } }, // model
            { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } }, // view
            { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // positions buffer (input)
            { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // normals buffer (input)
            { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // index buffer (input)
            { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // Shadow volume vertices buffer (output)
            { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // Atomic shadow volume vertex count buffer
        ],
    });

    const computeBindGroup = device.createBindGroup({
        layout: computeBindGroupLayout,
        entries: [
            { binding: 0, resource: { buffer: modelBuffer } },
            { binding: 1, resource: { buffer: viewBuffer } },
            { binding: 2, resource: { buffer: positionsBuffer } },
            { binding: 3, resource: { buffer: normalsBuffer } },
            { binding: 4, resource: { buffer: indicesBuffer } },
            { binding: 5, resource: { buffer: shadowVolumeBuffer } },
            { binding: 6, resource: { buffer: shadowVolumeCountBuffer } },
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

    const volumeVertexBuffers = [{
        arrayStride: 12,
        attributes: [{format: 'float32x3', offset: 0, shaderLocation: 0}]
    }];

    const secondPipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [viewParamsLayout]
    });
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
        },
        primitive: {
            cullMode: 'none',
        },
        depthStencil: {
            depthWriteEnabled: false, // Don't write to depth buffer
            depthCompare: 'always', // But do use depth test
            format: 'depth24plus-stencil8',
            stencilFront: {
                compare: 'always',
                failOp: 'keep',
                depthFailOp: 'decrement-wrap',
                passOp: 'keep',
            },
            stencilBack: {
                compare: 'always',
                failOp: 'keep',
                depthFailOp: 'increment-wrap',
                passOp: 'keep',
            },
            stencilReadMask: 0xff,
            stencilWriteMask: 0x00, // Do no writing to stencil buffer in this pass
        },
    };
    const secondRenderPipeline = device.createRenderPipeline(secondPipelineDescriptor);

    const secondRenderPassDesc = {
        colorAttachments: [{
            view: undefined,
            loadOp: "load",
            storeOp: "store"
        }],
        depthStencilAttachment: {
            view: secondDepthTextureView,
            depthLoadOp: "load",
            depthLoadValue: 1.0,
            depthStoreOp: "store",
            stencilLoadOp: "load",
            stencilLoadValue: 0,
            stencilStoreOp: 'store',
        }
    };
    
    //const secondRenderBundles = glbFile.buildRenderBundles(
    //        device, viewParamsLayout, viewParamsBindGroup, null, null, secondRenderPipeline, swapChainFormat);
    //const secondRenderBundles = glbFile.buildVolumeRenderBundles(
        //device, viewParamsLayout, viewParamsBindGroup, secondRenderPipeline, swapChainFormat);
    //const secondRenderBundles = glbFile.getRenderBundle(device, viewParamsLayout, viewParamsBindGroup, secondRenderPipeline, swapChainFormat);

    const vertexCount = new Uint32Array(1);

    const shadowVolumeVertexCountReadBuffer = device.createBuffer({
        size: vertexCount.byteLength,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    
    const bundleEncoder = device.createRenderBundleEncoder({
        colorFormats: [swapChainFormat],
        depthStencilFormat: 'depth24plus-stencil8',
    });
    bundleEncoder.setPipeline(secondRenderPipeline);
    bundleEncoder.setVertexBuffer(0, shadowVolumeBuffer);
    bundleEncoder.setBindGroup(0, viewParamsBindGroup);

    // Draw the new triangle
    bundleEncoder.draw(72);
    const secondRenderBundles = [bundleEncoder.finish()];

    /*const thirdRenderPassDesc = {
        colorAttachments: [{
            view: colorTextureView,
            loadOp: 'load',
            storeOp: 'store',
        }],
        depthStencilAttachment: {
            view: depthStencilTextureView,
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
        vertex: {
            module: thirdShaderModule,
            entryPoint: 'third_vertex_main',
        },
        fragment: {
            module: thirdShaderModule,
            entryPoint: 'third_fragment_main',
            targets: [{
                format: 'bgra8unorm', // Assume the format of the color attachment
                writeMask: GPUColorWrite.ALL, // Enable writing to the color buffer
            }],
        },
        primitive: {
            cullMode: 'back', // Enable back-face culling
        },
        depthStencil: {
            depthWriteEnabled: false, // Don't write to depth buffer
            depthCompare: 'less-equal', // Use depth test
            stencilFront: {
                compare: 'not-equal', // Stencil test: fragment is in shadow if stencil value is not zero
                failOp: 'keep',
                depthFailOp: 'keep',
                passOp: 'keep',
            },
            stencilBack: {
                compare: 'not-equal', // Stencil test: fragment is in shadow if stencil value is not zero
                failOp: 'keep',
                depthFailOp: 'keep',
                passOp: 'keep',
            },
            stencilReadMask: 0xff,
            stencilWriteMask: 0x00, // Do no writing to stencil buffer in this pass
        },
    }*/

    const defaultEye = vec3.set(vec3.create(), 3.0, 4.0, 8.0);
    const center = vec3.set(vec3.create(), -5.0, -3.0, 0.0);
    const up = vec3.set(vec3.create(), 0.0, 1.0, 0.0);
    const camera = new ArcballCamera(defaultEye, center, up, 2, [canvas.width, canvas.height]);
    const projection_matrix = mat4.perspective(
        mat4.create(), 50 * Math.PI / 180.0, canvas.width / canvas.height, 0.1, 1000);
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
    let t = -100;
    const render = async () => {
        //t += 0.1;
        const light_projection_matrix = mat4.create();
        const light_view_matrix = mat4.lookAt(mat4.create(), vec3.fromValues(50, 100, t), [0, 0, 0], [0, 1, 0]);
        var fovy = Math.PI / 2
        var aspect = canvas.width / canvas.height;
        var near = 0.01
        var f = 1.0 / Math.tan(fovy / 2)
        var out = []
        var eps = 1.0
        mat4.perspective(projection_matrix, fovy, aspect, near, null);


        const light_view_projection_matrix = mat4.multiply(mat4.create(), light_projection_matrix, light_view_matrix);

        
        const commandEncoder = device.createCommandEncoder();

        let start = performance.now();
        const colorTextureView = context.getCurrentTexture().createView();
        firstRenderPassDesc.colorAttachments[0].view = colorTextureView
        secondRenderPassDesc.colorAttachments[0].view = colorTextureView

        const view_matrix = camera.camera;
        device.queue.writeBuffer(projectionBuffer, 0, projection_matrix);
        device.queue.writeBuffer(viewBuffer, 0, view_matrix);
        //device.queue.writeBuffer(lightViewProjBuffer, 0, light_view_projection_matrix);

        const firstRenderPass = commandEncoder.beginRenderPass(firstRenderPassDesc);
        firstRenderPass.executeBundles(firstRenderBundles);
        firstRenderPass.end();

        const computePass = commandEncoder.beginComputePass();
        computePass.setPipeline(computePipeline);
        computePass.setBindGroup(0, computeBindGroup);
        const numTriangles = positionsBuffer.size / (3 * 3); // Assuming 3 vertices per triangle
        computePass.dispatchWorkgroups(numTriangles); // Adjust workgroup size if necessary

        computePass.end();

        //shadowVolumeBuffer should be updated






        const secondRenderPass = commandEncoder.beginRenderPass(secondRenderPassDesc);
        secondRenderPass.executeBundles(secondRenderBundles);
        secondRenderPass.end();

        device.queue.submit([commandEncoder.finish()]);
        await device.queue.onSubmittedWorkDone();


        const computeCommandEncoder = device.createCommandEncoder();
        computeCommandEncoder.copyBufferToBuffer(
            shadowVolumeCountBuffer, 0, shadowVolumeVertexCountReadBuffer, 0, vertexCount.byteLength
        );    
        device.queue.submit([computeCommandEncoder.finish()]);
        await shadowVolumeVertexCountReadBuffer.mapAsync(GPUMapMode.READ);
        const vertexCountArray = new Uint32Array(shadowVolumeVertexCountReadBuffer.getMappedRange());
        const shadowVolumeVertexCount = vertexCountArray[0];
        shadowVolumeVertexCountReadBuffer.unmap();
    
        //console.log("shadow volume vertex count:")
        //console.log(shadowVolumeVertexCount);
        //console.log(numTriangles)





        const end = performance.now();
        numFrames += 1;
        totalTimeMS += end - start;
        fpsDisplay.innerHTML = `Avg. FPS ${Math.round(1000.0 * numFrames / totalTimeMS)}`;
        requestAnimationFrame(render);
    };
    requestAnimationFrame(render);
})();

