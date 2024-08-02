import {ArcballCamera} from "arcball_camera";
import {Controller} from "ez_canvas_controller";
import {mat4, vec3} from "gl-matrix";

import {uploadGLBModel} from "./glb_import.js";
import {GLBShaderCache} from "./glb_shader_cache.js";

(async () => {
    if (navigator.gpu === undefined) {
        document.getElementById("webgpu-canvas").setAttribute("style", "display:none;");
        document.getElementById("no-webgpu").setAttribute("style", "display:block;");
        return;
    }

    var adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
        document.getElementById("webgpu-canvas").setAttribute("style", "display:none;");
        document.getElementById("no-webgpu").setAttribute("style", "display:block;");
        return;
    }
    var device = await adapter.requestDevice();

    var glbFile =
        await fetch(
            "https://cdn.willusher.io/glb/DamagedHelmet.glb")
            .then(res => res.arrayBuffer().then(buf => uploadGLBModel(buf, device)));

    var canvas = document.getElementById("webgpu-canvas");
    var context = canvas.getContext("webgpu");
    var swapChainFormat = "bgra8unorm";
    context.configure(
        {device: device, format: swapChainFormat, usage: GPUTextureUsage.RENDER_ATTACHMENT});

    var depthTexture = device.createTexture({
        size: {width: canvas.width, height: canvas.height, depthOrArrayLayers: 1},
        format: "depth24plus-stencil8",
        usage: GPUTextureUsage.RENDER_ATTACHMENT
    });

    var renderPassDesc = {
        colorAttachments: [{view: undefined, loadOp: "clear", clearValue: [0.3, 0.3, 0.3, 1], storeOp: "store"}],
        depthStencilAttachment: {
            view: depthTexture.createView(),
            depthLoadOp: "clear",
            depthClearValue: 1,
            depthStoreOp: "store",
            stencilLoadOp: "clear",
            stencilClearValue: 0,
            stencilStoreOp: "store"
        }
    };

    var viewParamsLayout = device.createBindGroupLayout({
        entries: [{binding: 0, visibility: GPUShaderStage.VERTEX, buffer: {type: "uniform"}}]
    });
    var shadowParamsLayout = device.createBindGroupLayout({
        entries: [{binding: 0, visibility: GPUShaderStage.VERTEX, buffer: {type: "uniform"}}]
    });

    var viewParamBuf = device.createBuffer(
        {size: 4 * 4 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
    var viewParamsBindGroup = device.createBindGroup(
        {layout: viewParamsLayout, entries: [{binding: 0, resource: {buffer: viewParamBuf}}]});

    var shadowParamsBuf = device.createBuffer(
        {size: 4 * 4 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
    var shadowParamsBindGroup = device.createBindGroup(
        {layout: shadowParamsLayout, entries: [{binding: 0, resource: {buffer: shadowParamsBuf}}]});

    var shaderCache = new GLBShaderCache(device);

    var renderBundles = glbFile.buildRenderBundles(
        device, shaderCache, viewParamsLayout, viewParamsBindGroup, shadowParamsLayout, shadowParamsBindGroup, swapChainFormat);

    const defaultEye = vec3.set(vec3.create(), 3.0, 4.0, 8.0);
    const center = vec3.set(vec3.create(), -5.0, -3.0, 0.0);
    const up = vec3.set(vec3.create(), 0.0, 1.0, 0.0);
    var camera = new ArcballCamera(defaultEye, center, up, 2, [canvas.width, canvas.height]);
    var proj = mat4.perspective(
        mat4.create(), 50 * Math.PI / 180.0, canvas.width / canvas.height, 0.1, 1000);
    var projView = mat4.create();

    var controller = new Controller();
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

    // Setup onchange listener for file uploads
    var glbBuffer = null;
    document.getElementById("uploadGLB").onchange =
        function uploadGLB() {
            document.getElementById("loading-text").hidden = false;
            var reader = new FileReader();
            reader.onerror = function () {
                alert("error reading GLB file");
            };
            reader.onload = function () {
                glbBuffer = reader.result;
            };
            reader.readAsArrayBuffer(this.files[0]);
        }

    var fpsDisplay = document.getElementById("fps");
    var numFrames = 0;
    var totalTimeMS = 0;
    const render = async () => {
        if (glbBuffer != null) {
            glbFile = await uploadGLBModel(glbBuffer, device);
            renderBundles = glbFile.buildRenderBundles(
                device, shaderCache, viewParamsLayout, viewParamsBindGroup,
                shadowParamsLayout, shadowParamsBindGroup, swapChainFormat);
            camera =
                new ArcballCamera(defaultEye, center, up, 2, [canvas.width, canvas.height]);
            glbBuffer = null;
        }

        var start = performance.now();
        renderPassDesc.colorAttachments[0].view = context.getCurrentTexture().createView();

        var commandEncoder = device.createCommandEncoder();

        // Send shadow matrix to shaders


        // Define vectors n and l, and scalar d
        const n = [0, 1, 0]
        const l = [1, 0, 0];
        const x = [0, 0, 0]
        const d = - (n[0] * x[0] + n[1] * x[1] + n[2] * x[2]);

        const dotNL = n[0] * l[0] + n[1] * l[1] + n[2] * l[2];

        // Define the matrix elements
        const shadow_matrix = new Float32Array([
            dotNL + d - n[0] * l[0], -n[1] * l[0], -n[2] * l[0], -d * l[0],
            -n[0] * l[1], dotNL + d - n[1] * l[1], -n[2] * l[1], -d * l[1],
            -n[0] * l[2], -n[1] * l[2], dotNL + d - n[2] * l[2], -d * l[2],
            -n[0], -n[1], -n[2], dotNL
        ]);

        // Send projection matrix to shader*/
        projView = mat4.mul(projView, proj, camera.camera);
        var proj_mat_upload = device.createBuffer({
            size: 4 * 4 * 4,
            usage: GPUBufferUsage.MAP_WRITE | GPUBufferUsage.COPY_SRC,
            mappedAtCreation: true
        });
        new Float32Array(proj_mat_upload.getMappedRange()).set(projView);
        proj_mat_upload.unmap();

        commandEncoder.copyBufferToBuffer(
            proj_mat_upload, 0, 
            viewParamBuf, 0, 
            4 * 4 * 4
        );

        device.queue.writeBuffer(shadowParamsBuf, 0, shadow_matrix);

        var renderPass = commandEncoder.beginRenderPass(renderPassDesc);
        renderPass.executeBundles(renderBundles);

        renderPass.end();
        device.queue.submit([commandEncoder.finish()]);
        await device.queue.onSubmittedWorkDone();

        var end = performance.now();
        numFrames += 1;
        totalTimeMS += end - start;
        fpsDisplay.innerHTML = `Avg. FPS ${Math.round(1000.0 * numFrames / totalTimeMS)}`;
        requestAnimationFrame(render);
        proj_mat_upload.destroy();
    };
    requestAnimationFrame(render);
})();

