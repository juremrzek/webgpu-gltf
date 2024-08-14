import {mat4} from "gl-matrix";

let a = 2;

const GLTFRenderMode = {
    POINTS: 0,
    LINE: 1,
    LINE_LOOP: 2,
    LINE_STRIP: 3,
    TRIANGLES: 4,
    TRIANGLE_STRIP: 5,
    TRIANGLE_FAN: 6,
};

const GLTFComponentType = {
    BYTE: 5120,
    UNSIGNED_BYTE: 5121,
    SHORT: 5122,
    UNSIGNED_SHORT: 5123,
    INT: 5124,
    UNSIGNED_INT: 5125,
    FLOAT: 5126,
    DOUBLE: 5130,
};

function alignTo(val, align) {
    return Math.floor((val + align - 1) / align) * align;
}

function gltfTypeNumComponents(type) {
    switch (type) {
        case 'SCALAR':
            return 1;
        case 'VEC2':
            return 2;
        case 'VEC3':
            return 3;
        case 'VEC4':
            return 4;
        default:
            alert('Unhandled glTF Type ' + type);
            return null;
    }
}

function gltfTypeSize(componentType, type) {
    let typeSize = 0;
    switch (componentType) {
        case GLTFComponentType.BYTE:
            typeSize = 1;
            break;
        case GLTFComponentType.UNSIGNED_BYTE:
            typeSize = 1;
            break;
        case GLTFComponentType.SHORT:
            typeSize = 2;
            break;
        case GLTFComponentType.UNSIGNED_SHORT:
            typeSize = 2;
            break;
        case GLTFComponentType.INT:
            typeSize = 4;
            break;
        case GLTFComponentType.UNSIGNED_INT:
            typeSize = 4;
            break;
        case GLTFComponentType.FLOAT:
            typeSize = 4;
            break;
        case GLTFComponentType.DOUBLE:
            typeSize = 4;
            break;
        default:
            alert('Unrecognized GLTF Component Type?');
    }
    return gltfTypeNumComponents(type) * typeSize;
}

export class GLTFBuffer {
    constructor(buffer, size, offset) {
        this.arrayBuffer = buffer;
        this.size = size;
        this.byteOffset = offset;
    }
}

export class GLTFBufferView {
    constructor(buffer, view) {
        this.length = view.byteLength;
        this.byteOffset = buffer.byteOffset;
        if (view.byteOffset !== undefined) {
            this.byteOffset += view.byteOffset;
        }
        this.byteStride = 0;
        if (view.byteStride !== undefined) {
            this.byteStride = view.byteStride;
        }
        this.buffer = new Uint8Array(buffer.arrayBuffer, this.byteOffset, this.length);

        this.gpuBuffer = null;
        this.usage = 0;
    }

    addUsage(usage) {
        this.usage = this.usage | usage;
    }

    upload(device) {
        // Note: must align to 4 byte size when mapped at creation is true
        let buf = device.createBuffer({
            size: alignTo(this.buffer.byteLength, 4),
            usage: this.usage,
            mappedAtCreation: true
        });
        new (this.buffer.constructor)(buf.getMappedRange()).set(this.buffer);
        buf.unmap();
        this.gpuBuffer = buf;
    }
}

export class GLTFAccessor {
    constructor(view, accessor) {
        this.count = accessor.count;
        this.componentType = accessor.componentType;
        this.gltfType = accessor.type;
        this.numComponents = gltfTypeNumComponents(accessor.type);
        this.numScalars = this.count * this.numComponents;
        this.view = view;
        this.byteOffset = 0;
        if (accessor.byteOffset !== undefined) {
            this.byteOffset = accessor.byteOffset;
        }
    }

    get byteStride() {
        let elementSize = gltfTypeSize(this.componentType, this.gltfType);
        return Math.max(elementSize, this.view.byteStride);
    }
}

export class GLTFPrimitive {
    constructor(indices, positions, normals, material) {
        this.indices = indices;
        this.positions = positions;
        this.normals = normals;
        this.material = material;
    }

    // Build the primitive render commands into the bundle
    buildRenderBundle(
        device, bindGroupLayouts, bundleEncoder, renderPipeline, swapChainFormat, depthFormat) {
        console.log(renderPipeline)

        bundleEncoder.setBindGroup(3, this.material.bindGroup);
        bundleEncoder.setPipeline(renderPipeline);
        bundleEncoder.setVertexBuffer(0,
            this.positions.view.gpuBuffer,
            this.positions.byteOffset,
            this.positions.length);
        if (this.normals) {
            bundleEncoder.setVertexBuffer(
                1, this.normals.view.gpuBuffer, this.normals.byteOffset, this.normals.length);
        }
        if (this.indices) {
            let indexFormat = this.indices.componentType == GLTFComponentType.UNSIGNED_SHORT
                ? 'uint16'
                : 'uint32';
            bundleEncoder.setIndexBuffer(this.indices.view.gpuBuffer,
                indexFormat,
                this.indices.byteOffset,
                this.indices.length);
            bundleEncoder.drawIndexed(this.indices.count);
        } else {
            bundleEncoder.draw(this.positions.count);
        }
    }
}

export class GLTFMesh {
    constructor(name, primitives) {
        this.name = name;
        this.primitives = primitives;
    }
}

export class GLTFNode {
    constructor(name, mesh, transform) {
        this.name = name;
        this.mesh = mesh;
        this.transform = transform;

        this.modelMatrix = null;
        this.bindGroup = null;
    }

    upload(device, node_id) {
        let modelMatrixBuffer = device.createBuffer(
            {size: 4 * 4 * 4, usage: GPUBufferUsage.UNIFORM, mappedAtCreation: true});
        new Float32Array(modelMatrixBuffer.getMappedRange()).set(this.transform);
        modelMatrixBuffer.unmap();
        this.modelMatrix = modelMatrixBuffer;
        let inverse_transpose = mat4.create();
        mat4.invert(inverse_transpose, this.transform);
        mat4.transpose(inverse_transpose, inverse_transpose);

        let inverse_transpose_buffer = device.createBuffer(
            {size: 4 * 4 * 4, usage: GPUBufferUsage.UNIFORM, mappedAtCreation: true});

        new Float32Array(inverse_transpose_buffer.getMappedRange()).set(inverse_transpose);
        inverse_transpose_buffer.unmap();
        this.inverse_transpose_uniform = inverse_transpose_buffer;
        console.log("node id:", node_id)
        let node_id_buffer = device.createBuffer(
            {size: 4, usage: GPUBufferUsage.UNIFORM, mappedAtCreation: true});

        new Uint32Array(node_id_buffer.getMappedRange())[0] = node_id;
        node_id_buffer.unmap();
        this.node_id_uniform = node_id_buffer;
    }

    buildRenderBundle(device,
        viewParamsLayout,
        viewParamsBindGroup,
        shadowParamsLayout,
        shadowParamsBindGroup,
        renderPipeline,
        swapChainFormat,
        depthFormat) {
        let nodeParamsLayout = device.createBindGroupLayout({
            entries: [
                {binding: 0, visibility: GPUShaderStage.VERTEX, buffer: {type: 'uniform'}},
                {binding: 1, visibility: GPUShaderStage.VERTEX, buffer: {type: 'uniform'}},
                {binding: 2, visibility: GPUShaderStage.VERTEX, buffer: {type: 'uniform'}}
            ]
        });

        this.bindGroup = device.createBindGroup({
            layout: nodeParamsLayout,
            entries: [
                {binding: 0, resource: {buffer: this.modelMatrix}},
                {binding: 1, resource: {buffer: this.inverse_transpose_uniform}},
                {binding: 2, resource: {buffer: this.node_id_uniform}}
            ]
        });

        let bindGroupLayouts = [viewParamsLayout, nodeParamsLayout, shadowParamsLayout];

        // Create the render bundle encoder with the correct formats
        let bundleEncoder = device.createRenderBundleEncoder({
            colorFormats: [swapChainFormat],
            depthStencilFormat: depthFormat,
        });

        bundleEncoder.setBindGroup(0, viewParamsBindGroup);
        bundleEncoder.setBindGroup(1, this.bindGroup); //node bind group
        bundleEncoder.setBindGroup(2, shadowParamsBindGroup);

        for (let i = 0; i < this.mesh.primitives.length; ++i) {
            this.mesh.primitives[i].buildRenderBundle(device,
                bindGroupLayouts,
                bundleEncoder,
                renderPipeline,
                swapChainFormat,
                depthFormat);
        }

        this.renderBundle = bundleEncoder.finish();
        return this.renderBundle;
    }

    buildShadowRenderBundle(device,
        viewParamsLayout,
        viewParamsBindGroup,
        shadowParamsLayout,
        shadowParamsBindGroup,
        renderPipeline,
        swapChainFormat,
        depthFormat){

        let nodeParamsLayout = device.createBindGroupLayout({
            entries: [
                {binding: 0, visibility: GPUShaderStage.VERTEX, buffer: {type: 'uniform'}},
            ]
        });

        this.bindGroup = device.createBindGroup({
            layout: nodeParamsLayout,
            entries: [
                {binding: 0, resource: {buffer: this.modelMatrix}},
            ]
        });

        let bindGroupLayouts = [viewParamsLayout, nodeParamsLayout, shadowParamsLayout];

        let bundleEncoder = device.createRenderBundleEncoder({
            colorFormats: [swapChainFormat],
            depthStencilFormat: depthFormat,
        });

        bundleEncoder.setBindGroup(0, viewParamsBindGroup);
        bundleEncoder.setBindGroup(1, this.bindGroup);
        bundleEncoder.setBindGroup(2, shadowParamsBindGroup);


    }
}

function readNodeTransform(node) {
    if (node.matrix) {
        return node.matrix;
    } else {
        let scale = [1, 1, 1];
        let rotation = [0, 0, 0, 1];
        let translation = [0, 0, 0];
        if (node.scale) {
            scale = node.scale;
        }
        if (node.rotation) {
            rotation = node.rotation;
        }
        if (node.translation) {
            translation = node.translation;
        }
        let m = mat4.create();
        return mat4.fromRotationTranslationScale(m, rotation, translation, scale);
    }
}

function flattenGLTFChildren(nodes, node, parent_transform) {
    let tfm = readNodeTransform(node);
    tfm = mat4.mul(tfm, parent_transform, tfm);
    node.matrix = tfm;
    node.scale = undefined;
    node.rotation = undefined;
    node.translation = undefined;
    if (node.children) {
        for (let i = 0; i < node.children.length; ++i) {
            flattenGLTFChildren(nodes, nodes[node.children[i]], tfm);
        }
        node.children = [];
    }
}

function makeGLTFSingleLevel(nodes) {
    let rootTfm = mat4.create();
    for (let i = 0; i < nodes.length; ++i) {
        flattenGLTFChildren(nodes, nodes[i], rootTfm);
    }
    return nodes;
}

export class GLTFMaterial {
    constructor(material) {
        this.baseColorFactor = [1, 1, 1, 1];
        this.emissiveFactor = [0, 0, 0, 1];
        this.metallicFactor = 1.0;
        this.roughnessFactor = 1.0;
  
        if (material.pbrMetallicRoughness !== undefined) {
            let pbr = material.pbrMetallicRoughness;
            if (pbr.baseColorFactor !== undefined) {
                this.baseColorFactor = pbr.baseColorFactor;
            }
            if (pbr.metallicFactor !== undefined) {
                this.metallicFactor = pbr.metallicFactor;
            }
            if (pbr.roughnessFactor !== undefined) {
                this.roughnessFactor = pbr.roughnessFactor;
            }
        }
        if (material.emissiveFactor !== undefined) {
            this.emissiveFactor[0] = material.emissiveFactor[0];
            this.emissiveFactor[1] = material.emissiveFactor[1];
            this.emissiveFactor[2] = material.emissiveFactor[2];
        }
  
        this.gpuBuffer = null;
        this.bindGroupLayout = null;
        this.bindGroup = null;
    }

    upload(device) {
        let buf = device.createBuffer(
            {size: 3 * 4 * 4, usage: GPUBufferUsage.UNIFORM, mappedAtCreation: true});
        let mappingView = new Float32Array(buf.getMappedRange());
        mappingView.set(this.baseColorFactor);
        mappingView.set(this.emissiveFactor, 4);
        mappingView.set([this.metallicFactor, this.roughnessFactor], 8);
        buf.unmap();
        this.gpuBuffer = buf;

        let layoutEntries =
            [{binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: {type: 'uniform'}}];
        let bindGroupEntries = [{
            binding: 0,
            resource: {
                buffer: this.gpuBuffer,
            }
        }];

        this.bindGroupLayout = device.createBindGroupLayout({entries: layoutEntries});

        this.bindGroup = device.createBindGroup({
            layout: this.bindGroupLayout,
            entries: bindGroupEntries,
        });
    }
}

export class GLBModel {
    constructor(nodes) {
        this.nodes = nodes;
    }

    buildRenderBundles(
        device, viewParamsLayout, viewParamsBindGroup, shadowParamsLayout, shadowParamsBindGroup, renderPipeline, swapChainFormat) {
        let renderBundles = [];
        for (let i = 0; i < this.nodes.length; ++i) {
            console.log(i)
            let n = this.nodes[i];
            let bundle = n.buildRenderBundle(device,
                viewParamsLayout,
                viewParamsBindGroup,
                shadowParamsLayout,
                shadowParamsBindGroup,
                renderPipeline,
                swapChainFormat,
                'depth24plus-stencil8');
            renderBundles.push(bundle);
        }
        return renderBundles;
    }
};

// Upload a GLB model and return it
export async function uploadGLBModel(buffer, device) {
    document.getElementById("loading-text").hidden = false;
    // The file header and chunk 0 header
    // TODO: It sounds like the spec does allow for multiple binary chunks,
    // so then how do you know which chunk a buffer exists in? Maybe the buffer
    // id corresponds to the binary chunk ID? Would have to find info in the
    // spec or an example file to check this
    let header = new Uint32Array(buffer, 0, 5);
    if (header[0] != 0x46546C67) {
        alert('This does not appear to be a glb file?');
        return;
    }
    let glbJsonData =
        JSON.parse(new TextDecoder('utf-8').decode(new Uint8Array(buffer, 20, header[3])));

    let binaryHeader = new Uint32Array(buffer, 20 + header[3], 2);
    let glbBuffer = new GLTFBuffer(buffer, binaryHeader[0], 28 + header[3]);

    if (28 + header[3] + binaryHeader[0] != buffer.byteLength) {
        console.log('TODO: Multiple binary chunks in file');
    }

    // TODO: Later could look at merging buffers and actually using the starting
    // offsets, but want to avoid uploading the entire buffer since it may
    // contain packed images
    let bufferViews = [];
    for (let i = 0; i < glbJsonData.bufferViews.length; ++i) {
        bufferViews.push(new GLTFBufferView(glbBuffer, glbJsonData.bufferViews[i]));
    }

    let defaultMaterial = new GLTFMaterial({});
    let materials = [];
    for (let i = 0; i < glbJsonData.materials.length; ++i) {
        materials.push(new GLTFMaterial(glbJsonData.materials[i]));
    }

    let meshes = [];
    for (let i = 0; i < glbJsonData.meshes.length; ++i) {
        let mesh = glbJsonData.meshes[i];

        let primitives = [];
        for (let j = 0; j < mesh.primitives.length; ++j) {
            let primitive = mesh.primitives[j];

            let indices = null;
            if (glbJsonData.accessors[primitive.indices] !== undefined) {
                let accessor = glbJsonData.accessors[primitive.indices];
                let viewID = accessor.bufferView;
                bufferViews[viewID].addUsage(GPUBufferUsage.INDEX);
                indices = new GLTFAccessor(bufferViews[viewID], accessor);
            }
            
            let positions = null;
            let normals = null;
            for (let attr in primitive.attributes) {
                let accessor = glbJsonData.accessors[primitive.attributes[attr]];
                let viewID = accessor.bufferView;
                bufferViews[viewID].addUsage(GPUBufferUsage.VERTEX);
                if (attr == 'POSITION') {
                    positions = new GLTFAccessor(bufferViews[viewID], accessor);
                } else if (attr == 'NORMAL') {
                    normals = new GLTFAccessor(bufferViews[viewID], accessor);
                }
            }

            let material = null;
            if (primitive.material !== undefined) {
                material = materials[primitive.material];
            } else {
                material = defaultMaterial;
            }

            let gltfPrim =
                new GLTFPrimitive(indices, positions, normals, material);
            primitives.push(gltfPrim);
        }
        meshes.push(new GLTFMesh(mesh.name, primitives));
    }

    // Upload the different views used by meshes
    for (let i = 0; i < bufferViews.length; ++i) {
        bufferViews[i].upload(device);
    }

    defaultMaterial.upload(device);
    for (let i = 0; i < materials.length; ++i) {
        materials[i].upload(device);
    }

    let nodes = [];
    let gltfNodes = makeGLTFSingleLevel(glbJsonData.nodes);
    for (let i = 0; i < gltfNodes.length; ++i) {
        let n = gltfNodes[i];
        if (n.mesh !== undefined) {
            let node = new GLTFNode(n.name, meshes[n.mesh], readNodeTransform(n));
            node.upload(device, i);
            nodes.push(node);
        }
    }
    document.getElementById("loading-text").hidden = true;
    return new GLBModel(nodes);
}
