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
    const depthTextureView = firstDepthTexture.createView();

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
            view: depthTextureView,
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
            cullMode: 'none'
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
        device, viewParamsBindGroup, firstRenderPipeline, swapChainFormat);

    const positions = glbFile.nodes[1].mesh.primitives[0].positions;
    const positionsBuffer = glbFile.nodes[1].mesh.primitives[0].positions.view.gpuBuffer
    const indicesBuffer = glbFile.nodes[1].mesh.primitives[0].indices.view.gpuBuffer
    const modelMatrixData = glbFile.nodes[1].modelMatrix;

    const inverse_transpose = mat4.create();
    mat4.invert(inverse_transpose, modelMatrixData);
    mat4.transpose(inverse_transpose, inverse_transpose);

    const inverseTransposeBuffer = device.createBuffer(
        {size: 4 * 4 * 4, usage: GPUBufferUsage.UNIFORM, mappedAtCreation: true});
    new Float32Array(inverseTransposeBuffer.getMappedRange()).set(inverse_transpose);
    inverseTransposeBuffer.unmap();

    tempCommandEncoder.copyBufferToBuffer(
        modelMatrixData,
        0,
        modelBuffer,
        0,
        modelMatrixData.size 
    );
    const commands = tempCommandEncoder.finish();
    device.queue.submit([commands]);


    // Convert indicies from 16-bit to 32-bit
    for (let i=0; i<glbFile.nodes.length; i++){
        let primitives = glbFile.nodes[i].mesh.primitives;
        for (let j=0; j<primitives.length; j++) {
            primitives[j].buildComputeIndicesBuffer(device, computeIndicesShadersModule);
        }
    }

    const computeBindGroupLayout = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } }, // inverse_transpose
            { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // positions buffer (input)
            { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // index buffer (input)
            { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // Shadow volume vertices buffer (output)
            { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // Shadow volume indices buffer (out)
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

    glbFile.buildComputeBindGroups(device, computePipeline, computeBindGroupLayout);

    const secondViewParamsLayout = device.createBindGroupLayout({
        entries: [
            {binding: 0, visibility: GPUShaderStage.VERTEX, buffer: {type: "uniform"}},
            {binding: 1, visibility: GPUShaderStage.VERTEX, buffer: {type: "uniform"}},
            {binding: 2, visibility: GPUShaderStage.VERTEX, buffer: {type: "uniform"}},
        ]
    });
    const secondViewParamsBindGroup = device.createBindGroup(
        {layout: viewParamsLayout, entries: [
            {binding: 0, resource: {buffer: projectionBuffer}},
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
        },
    };
    const secondRenderPipeline = device.createRenderPipeline(secondPipelineDescriptor);

    const secondRenderPassDesc = {
        colorAttachments: [{
            loadOp: 'load',
            storeOp: 'store'
        }],
        depthStencilAttachment: {
            view: depthTextureView,
            depthLoadOp: 'load',
            depthStoreOp: 'store',
            stencilLoadOp: 'clear',
            stencilClearValue: 0,
            stencilStoreOp: 'store',
        }
    };
    
    const secondBundleEncoder = device.createRenderBundleEncoder({
        colorFormats: [swapChainFormat],
        depthStencilFormat: 'depth24plus-stencil8',
    });
    secondBundleEncoder.setPipeline(secondRenderPipeline);
    secondBundleEncoder.setVertexBuffer(0, glbFile.nodes[1].mesh.primitives[0].shadowVolumePositionsBuffer);
    secondBundleEncoder.setBindGroup(0, secondViewParamsBindGroup);

    // Draw the new triangle
    secondBundleEncoder.setIndexBuffer(glbFile.nodes[1].mesh.primitives[0].shadowVolumeIndicesBuffer,
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
            view: depthTextureView,
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
            cullMode: 'none',
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
        },
    }

    const thirdRenderPipeline = device.createRenderPipeline(thirdPipelineDescriptor);
    const thirdRenderBundles = glbFile.buildRenderBundles(
            device, viewParamsBindGroup, thirdRenderPipeline, swapChainFormat);

    const defaultEye = vec3.set(vec3.create(), 3.0, 4.0, 8.0);
    const center = vec3.set(vec3.create(), -5.0, -3.0, 0.0);
    const up = vec3.set(vec3.create(), 0.0, 1.0, 0.0);
    const camera = new ArcballCamera(defaultEye, center, up, 2, [canvas.width, canvas.height]);
    const projection_matrix = mat4.perspective(
        mat4.create(), 50 * Math.PI / 180.0, canvas.width / canvas.height, 0.1, null);
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

        const firstRenderPass = commandEncoder.beginRenderPass(firstRenderPassDesc);
        firstRenderPass.executeBundles(firstRenderBundles);
        firstRenderPass.end();

        for (let i=0; i<glbFile.nodes.length; i++){
            let primitives = glbFile.nodes[i].mesh.primitives;
            for (let j=0; j<primitives.length; j++) {
                const computePass = commandEncoder.beginComputePass();
                computePass.setPipeline(computePipeline);
                computePass.setBindGroup(0, glbFile.nodes[i].mesh.primitives[j].computeBindGroup);
                const numTriangles = positionsBuffer.size * 2;
                computePass.dispatchWorkgroups(numTriangles, 1, 1);

                computePass.end();
            }
        }

        const secondRenderPass = commandEncoder.beginRenderPass(secondRenderPassDesc);
        secondRenderPass.executeBundles(secondRenderBundles);
        secondRenderPass.end();

        const thirdRenderPass = commandEncoder.beginRenderPass(thirdRenderPassDesc);
        thirdRenderPass.setStencilReference(0);
        thirdRenderPass.executeBundles(thirdRenderBundles);
        thirdRenderPass.end();

        device.queue.submit([commandEncoder.finish()]);
        await device.queue.onSubmittedWorkDone();

        const end = performance.now();
        numFrames += 1;
        totalTimeMS += end - start;
        fpsDisplay.innerHTML = `Avg. FPS ${Math.round(1000.0 * numFrames / totalTimeMS)}`;
        //requestAnimationFrame(render);
    };
    requestAnimationFrame(render);
})();

