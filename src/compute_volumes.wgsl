// Shader for Shadow Volume Generation in WebGPU using Compute Shader
// Equivalent to the OpenGL Geometry Shader.

struct Vertex {
    pos: vec4<f32>,
    normal: vec3<f32>,
};

struct Triangle {
    v0: Vertex,
    v1: Vertex,
    v2: Vertex
};

struct Mat4Uniform {
    m: mat4x4<f32>
}

//@group(0) @binding(0) var<uniform> l_pos: vec4<f32>; // Light position in eye space

//@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(0) var<uniform> modelMatrix: Mat4Uniform;
@group(0) @binding(1) var<uniform> viewMatrix: Mat4Uniform;
@group(0) @binding(2) var<storage, read_write> positions: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> normals: array<vec3<f32>>;
@group(0) @binding(4) var<storage, read_write> indices: array<u32>;
@group(0) @binding(5) var<storage, read_write> shadowVolumeVertices: array<Vertex>; // Output vertices for shadow volume
@group(0) @binding(6) var<storage, read_write> shadowVolumeVertexCount: atomic<u32>; // Counter for shadow volume vertices


@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let triIndex = global_id.x; // Get the triangle index
    let l_pos = vec4<f32>(0, 0, 200, 1);

    // Fetch triangle vertices
    let tri = Triangle(
        Vertex(viewMatrix.m * modelMatrix.m * positions[indices[triIndex * 3 + 0]], normals[indices[triIndex * 3 + 0]]),
        Vertex(viewMatrix.m * modelMatrix.m * positions[indices[triIndex * 3 + 1]], normals[indices[triIndex * 3 + 1]]),
        Vertex(viewMatrix.m * modelMatrix.m * positions[indices[triIndex * 3 + 2]], normals[indices[triIndex * 3 + 2]])
    );

    // Determine if the triangle is front-facing or back-facing relative to the light source
    let lightDir = normalize(l_pos.xyz - tri.v0.pos.xyz);
    let normal = normalize(cross(tri.v1.pos.xyz - tri.v0.pos.xyz, tri.v2.pos.xyz - tri.v0.pos.xyz));
    let facing = dot(normal, lightDir) > 0.0;

    if (true) {
        // Add the front-facing triangle to the shadow volume
        //addShadowVolumeTriangle(tri.v0, tri.v1, tri.v2);

        // Extrude the vertices away from the light source
        let extrudedV0 = Vertex(tri.v0.pos - vec4<f32>(lightDir * 10300.0, 0.0), tri.v0.normal);
        let extrudedV1 = Vertex(tri.v1.pos - vec4<f32>(lightDir * 10300.0, 0.0), tri.v1.normal);
        let extrudedV2 = Vertex(tri.v2.pos - vec4<f32>(lightDir * 10300.0, 0.0), tri.v2.normal);

        // Add the extruded triangle to the shadow volume
        addShadowVolumeTriangle(extrudedV0, extrudedV1, extrudedV2);

        // Add the side faces of the shadow volume
        addShadowVolumeTriangle(tri.v0, tri.v1, extrudedV1);
        addShadowVolumeTriangle(tri.v0, extrudedV1, extrudedV0);
        addShadowVolumeTriangle(tri.v1, tri.v2, extrudedV2);
        addShadowVolumeTriangle(tri.v1, extrudedV2, extrudedV1);
        addShadowVolumeTriangle(tri.v2, tri.v0, extrudedV0);
        addShadowVolumeTriangle(tri.v2, extrudedV0, extrudedV2);
    }
}


// Helper function to add a triangle to the shadow volume
fn addShadowVolumeTriangle(v0: Vertex, v1: Vertex, v2: Vertex) {
    let index = atomicAdd(&shadowVolumeVertexCount, 3);
    shadowVolumeVertices[index + 0] = v0;
    shadowVolumeVertices[index + 1] = v1;
    shadowVolumeVertices[index + 2] = v2;
}

// Helper function to add a quad to the shadow volume (as a triangle strip)
fn addShadowVolumeQuad(v0: Vertex, v1: Vertex, v2: Vertex, v3: Vertex) {
    let index = atomicAdd(&shadowVolumeVertexCount, 4);
    shadowVolumeVertices[index + 0] = v0;
    shadowVolumeVertices[index + 1] = v1;
    shadowVolumeVertices[index + 2] = v2;
    shadowVolumeVertices[index + 3] = v3;
}