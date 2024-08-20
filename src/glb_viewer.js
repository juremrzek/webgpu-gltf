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
            "assets/scene_cube_no_walls.glb")
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

    let shadowDepthTexture = device.createTexture({
        size: {width: 4096, height: 4096, depthOrArrayLayers: 1},
        format: "depth32float",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    })
    const shadowDepthTextureView = shadowDepthTexture.createView();

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

    const mapRenderLayout = device.createBindGroupLayout({
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
    });

    const lightViewProjBuffer = device.createBuffer(
        {size: 4 * 4 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
    const mapBindGroup = device.createBindGroup({
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
                resource: shadowDepthTextureView,
            },
            {
                binding: 2,
                resource: device.createSampler({
                    compare: 'less',
                }),
            },
            ],
        }
    );

    const projectionBuffer = device.createBuffer(
        {size: 4 * 4 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
    const viewBuffer = device.createBuffer(
        {size: 4 * 4 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
    const viewParamsBindGroup = device.createBindGroup(
        {layout: viewParamsLayout, entries: [
            {binding: 0, resource: {buffer: projectionBuffer}},
            {binding: 1, resource: {buffer:viewBuffer}},
            {binding: 2, resource: {buffer:lightViewProjBuffer}},
        ]}
    );

    const primitive = {
        topology: 'triangle-list',
    };
      
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
            [viewParamsLayout, nodeParamsLayout, mapRenderLayout, materialBindGroupLayout]
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
            format: 'depth24plus-stencil8',
            depthWriteEnabled: true,
            depthCompare: 'less'
        }
    };
    const renderPipeline = device.createRenderPipeline(pipelineDescriptor);

    const renderPassDesc = {
        colorAttachments: [{
            view: undefined,
            loadOp: "clear",
            clearValue: [0.3, 0.3, 0.3, 1], storeOp: "store"
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
        device, viewParamsLayout, viewParamsBindGroup, mapRenderLayout, mapBindGroup, renderPipeline, swapChainFormat);
    
    const shadowRenderPassDesc = {
        colorAttachments: [],
        depthStencilAttachment: {
            view: shadowDepthTextureView,
            depthLoadOp: "clear",
            depthClearValue: 1,
            depthStoreOp: "store",
        }
    };

     
    const shadowShaderModule = device.createShaderModule({
        code: shadowShaders,
    });
    const shadowPipelineLayout = device.createPipelineLayout({
        bindGroupLayouts:
            [viewParamsLayout, nodeParamsLayout, materialBindGroupLayout]
    });

    const shadowPipelineDescriptor = {
        label: 'Shadow Pipeline',
        layout: shadowPipelineLayout,
        vertex: {
            module: shadowShaderModule,
            entryPoint: 'shadow_vertex_main',
            buffers: vertexBuffers
        },
        primitive: {
            topology: 'triangle-list',
        },
        depthStencil: {
            format: 'depth32float',
            depthWriteEnabled: true,
            depthCompare: 'less'}
    }

    const shadowRenderPipeline = device.createRenderPipeline(shadowPipelineDescriptor);

    const shadowRenderBundles = glbFile.buildRenderBundles(
        device, viewParamsLayout, viewParamsBindGroup, mapRenderLayout, mapBindGroup, shadowRenderPipeline, swapChainFormat);


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
        //ORTHO
        const left = -40;
        const right = 40;
        const bottom = -40;
        const top = 40;
        const near = -500;
        const far = 200;
        mat4.ortho(light_projection_matrix, left, right, bottom, top, near, far);
        const light_view_projection_matrix = mat4.multiply(mat4.create(), light_projection_matrix, light_view_matrix);


        let start = performance.now();
        const colorTextureView = context.getCurrentTexture().createView();
        renderPassDesc.colorAttachments[0].view = colorTextureView

        const commandEncoder = device.createCommandEncoder();

        const view_matrix = camera.camera;
        device.queue.writeBuffer(projectionBuffer, 0, projection_matrix);
        device.queue.writeBuffer(viewBuffer, 0, view_matrix);
        device.queue.writeBuffer(lightViewProjBuffer, 0, light_view_projection_matrix);

        const shadowRenderPass = commandEncoder.beginRenderPass(shadowRenderPassDesc);
        shadowRenderPass.executeBundles(shadowRenderBundles);
        shadowRenderPass.end();

        const renderPass = commandEncoder.beginRenderPass(renderPassDesc);
        renderPass.executeBundles(renderBundles);
        renderPass.end();

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

