import {ArcballCamera} from "arcball_camera";
import {Controller} from "ez_canvas_controller";
import {mat4, vec3} from "gl-matrix";

import {uploadGLBModel} from "./glb_import.js";
import basicShaders from './basic_shaders.wgsl';
import shadowShaders from './shadow_shaders.wgsl';

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
    let glbModel;
    const glbFile = await fetch(
            "assets/scene_dungeon_fixed.glb")
            .then(res => res.arrayBuffer().then(async (buf) => glbModel = await uploadGLBModel(buf, device)));

    const canvas = document.getElementById("webgpu-canvas");
    const context = canvas.getContext("webgpu");
    const swapChainFormat = "bgra8unorm";
    context.configure(
        {device: device, format: swapChainFormat, usage: GPUTextureUsage.RENDER_ATTACHMENT});

    const depthTexture = device.createTexture({
        size: {width: canvas.width, height: canvas.height, depthOrArrayLayers: 1},
        format: "depth24plus-stencil8",
        usage: GPUTextureUsage.RENDER_ATTACHMENT
    });
    const depthTextureView = depthTexture.createView();

    const viewParamsLayout = device.createBindGroupLayout({
        entries: [
            {binding: 0, visibility: GPUShaderStage.VERTEX, buffer: {type: "uniform"}},
            {binding: 1, visibility: GPUShaderStage.VERTEX, buffer: {type: "uniform"}},
        ]
    });
    const nodeParamsLayout = device.createBindGroupLayout({
        entries: [
            {binding: 0, visibility: GPUShaderStage.VERTEX, buffer: {type: 'uniform'}},
            {binding: 1, visibility: GPUShaderStage.VERTEX, buffer: {type: 'uniform'}},
            {binding: 2, visibility: GPUShaderStage.VERTEX, buffer: {type: 'uniform'}}
        ]
    });
    const shadowParamsLayout = device.createBindGroupLayout({
        entries: [{binding: 0, visibility: GPUShaderStage.VERTEX, buffer: {type: "uniform"}}]
    });

    const projectionBuffer = device.createBuffer(
        {size: 4 * 4 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
    const viewBuffer = device.createBuffer(
        {size: 4 * 4 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
    const viewParamsBindGroup = device.createBindGroup(
        {layout: viewParamsLayout, entries: [
            {binding: 0, resource: {buffer: projectionBuffer}},
            {binding: 1, resource: {buffer:viewBuffer}}
        ]}
    );

    const shadowParamsBuf = device.createBuffer(
        {size: 4 * 4 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
    const shadowParamsBindGroup = device.createBindGroup(
        {layout: shadowParamsLayout, entries: [{binding: 0, resource: {buffer: shadowParamsBuf}}]});
    

    const layoutEntries = [{binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: {type: 'uniform'}}]
    const materialBindGroupLayout = device.createBindGroupLayout({entries: layoutEntries});

    const primitive = {topology: 'triangle-list'};
    const shaderModule = device.createShaderModule({code: basicShaders});
    const vertexBuffers = [{
        arrayStride: 12, 
        attributes: [{format: 'float32x3', offset: 0, shaderLocation: 0}]
    }];
    vertexBuffers.push({
        arrayStride: 12,
        attributes: [{format: 'float32x3', offset: 0, shaderLocation: 1}]
    });
    const pipelineLayout = device.createPipelineLayout({
        bindGroupLayouts:
            [viewParamsLayout, nodeParamsLayout, shadowParamsLayout, materialBindGroupLayout]
    });
    const pipelineDescriptor = {
        label: 'Basic Pipeline',
        layout: pipelineLayout,
        vertex: {
            module: shaderModule,
            entryPoint: 'vertex_main',
            buffers: vertexBuffers
        },
        fragment: {
            module: shaderModule,
            entryPoint: 'fragment_main',
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
                }
            }]
        },
        primitive: primitive,
        depthStencil: {
            format: depthTexture.format,
            depthWriteEnabled: true,
            depthCompare: 'less'
        }
    };
    const renderPipeline = device.createRenderPipeline(pipelineDescriptor);

    const renderPassDesc = {
        colorAttachments: [{
            loadOp: "clear",
            clearValue: [0.3, 0.3, 0.3, 1],
            storeOp: "store"
        }],
        depthStencilAttachment: {
            view: depthTextureView,
            depthLoadOp: "clear",
            depthClearValue: 1,
            depthStoreOp: "store",
            stencilLoadOp: "clear",
            stencilClearValue: 0,
            stencilStoreOp: "store"
        }
    };

    const renderBundles = glbFile.buildRenderBundles(
        device, viewParamsLayout, viewParamsBindGroup, shadowParamsLayout, shadowParamsBindGroup, renderPipeline, swapChainFormat);
    
    const shadowRenderPassDesc = {
        colorAttachments: [{
            loadOp: "load",
            storeOp: "store"
        }],
        depthStencilAttachment: {
            view: depthTextureView,
            depthLoadOp: "load",
            depthStoreOp: "store",
            stencilLoadOp: "load",
            stencilStoreOp: "store"
        }
    };

     
    const shadowShaderModule = device.createShaderModule({
        code: shadowShaders,
    });
    const shadowPipelineLayout = device.createPipelineLayout({
        bindGroupLayouts:
            [viewParamsLayout, nodeParamsLayout, shadowParamsLayout]
    });

    const shadowPipelineDescriptor = {
        label: 'Shadow Pipeline',
        layout: shadowPipelineLayout,
        vertex: {
            module: shadowShaderModule,
            entryPoint: 'shadow_vertex_main',
            buffers: vertexBuffers
        },
        fragment: {
            module: shadowShaderModule,
            entryPoint: 'shadow_fragment_main',
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
            topology: 'triangle-list',
        },
        depthStencil: {
            format: depthTexture.format,
            depthWriteEnabled: true,
            depthCompare: 'less'}
    }

    const shadowRenderPipeline = device.createRenderPipeline(shadowPipelineDescriptor);

    const shadowRenderBundles = glbFile.buildRenderBundles(
        device, viewParamsLayout, viewParamsBindGroup, shadowParamsLayout, shadowParamsBindGroup, shadowRenderPipeline, swapChainFormat);


    const defaultEye = vec3.set(vec3.create(), 3.0, 4.0, 8.0);
    const center = vec3.set(vec3.create(), -5.0, -3.0, 0.0);
    const up = vec3.set(vec3.create(), 0.0, 1.0, 0.0);
    const camera = new ArcballCamera(defaultEye, center, up, 2, [canvas.width, canvas.height]);
    const projection_matrix = mat4.perspective(
        mat4.create(), 50 * Math.PI / 180.0, canvas.width / canvas.height, 0.1, 1000);
    console.log(projection_matrix)
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
    controller.registerForCanvas(canvas);

    const fpsDisplay = document.getElementById("fps");
    let numFrames = 0;
    let totalTimeMS = 0;
    const render = async () => {
        let start = performance.now();
        const colorTextureView = context.getCurrentTexture().createView();
        renderPassDesc.colorAttachments[0].view = colorTextureView
        shadowRenderPassDesc.colorAttachments[0].view = colorTextureView;

        const commandEncoder = device.createCommandEncoder();

        const n = [0, 1, 0, 0]
        const l = [100, 100, 0, 1];
        const x = [0, -0.01, 0, 0]
        const shadow_matrix = get_shadow_matrix(n, l, x);

        const view_matrix = camera.camera;
        device.queue.writeBuffer(projectionBuffer, 0, projection_matrix);
        device.queue.writeBuffer(viewBuffer, 0, view_matrix);
        device.queue.writeBuffer(shadowParamsBuf, 0, shadow_matrix);

        const renderPass = commandEncoder.beginRenderPass(renderPassDesc);
        renderPass.executeBundles(renderBundles);
        renderPass.end();

        const shadowRenderPass = commandEncoder.beginRenderPass(shadowRenderPassDesc);
        shadowRenderPass.executeBundles(shadowRenderBundles);
        shadowRenderPass.end();

        device.queue.submit([commandEncoder.finish()]);
        await device.queue.onSubmittedWorkDone();

        const end = performance.now();
        numFrames += 1;
        totalTimeMS += end - start;
        fpsDisplay.innerHTML = `Avg. FPS ${Math.round(1000.0 * numFrames / totalTimeMS)}`;
        requestAnimationFrame(render);
    };
    requestAnimationFrame(render);
})();

