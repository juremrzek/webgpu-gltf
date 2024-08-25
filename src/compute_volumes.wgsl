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

struct Uniforms {
    lightPosition: vec4<f32>,
};

//@group(0) @binding(0) var<uniform> l_pos: vec4<f32>; // Light position in eye space

//@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(0) var<storage, read_write> positions: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> normals: array<vec3<f32>>;
@group(0) @binding(2) var<storage, read_write> shadowVolumeVertices: array<Vertex>; // Output vertices for shadow volume
@group(0) @binding(3) var<storage, read_write> shadowVolumeVertexCount: atomic<u32>; // Counter for shadow volume vertices

// Compute shader entry point
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let triIndex = global_id.x; // Get the triangle index
    let l_pos = vec4<f32>(20, -20, 0, 1);

    //atomicStore(&shadowVolumeVertexCount, triIndex);

    // Fetch triangle vertices
    let tri = Triangle(
        Vertex(positions[triIndex * 3 + 0], normals[triIndex * 3 + 0]),
        Vertex(positions[triIndex * 3 + 1], normals[triIndex * 3 + 1]),
        Vertex(positions[triIndex * 3 + 2], normals[triIndex * 3 + 2])
    );

    // Compute normal at each vertex
    //let ns0 = cross(tri.v1.pos.xyz - tri.v0.pos.xyz, tri.v2.pos.xyz - tri.v0.pos.xyz);
    //let ns1 = cross(tri.v2.pos.xyz - tri.v1.pos.xyz, tri.v0.pos.xyz - tri.v1.pos.xyz);
    //let ns2 = cross(tri.v0.pos.xyz - tri.v2.pos.xyz, tri.v1.pos.xyz - tri.v2.pos.xyz);
    let ns0 = tri.v1.normal;
    let ns1 = tri.v2.normal;
    let ns2 = tri.v2.normal;

    // Compute direction from vertices to light
    let d0 = l_pos.xyz - l_pos.w * tri.v0.pos.xyz;
    let d1 = l_pos.xyz - l_pos.w * tri.v1.pos.xyz;
    let d2 = l_pos.xyz - l_pos.w * tri.v2.pos.xyz;

    // Check if the triangle faces the light
    var faces_light = true;
    if !(dot(ns0, d0) > 0.0 || dot(ns1, d1) > 0.0 || dot(ns2, d2) > 0.0) {
        // Not facing the light and not robust, skip this triangle
        /*if robust == 0 {
            return;
        }*/
        // Otherwise, flip the triangle winding order
        faces_light = false;
    }

    if (faces_light) {
        //atomicAdd(&shadowVolumeVertexCount, 1);
    }

    // Z-pass: Generate caps and extrusions for shadow volume
    if (false) { //if this is true, use z-fail, if false use z-pass
        // Near cap: simply add the triangle
        addShadowVolumeTriangle(tri.v0, tri.v1, tri.v2);

        // Far cap: extrude the triangle to infinity
        let v0_ext = Vertex(vec4<f32>(l_pos.w * tri.v0.pos.xyz - l_pos.xyz, 0.0), vec3<f32>(0.0));
        let v1_ext = Vertex(vec4<f32>(l_pos.w * tri.v1.pos.xyz - l_pos.xyz, 0.0), vec3<f32>(0.0));
        let v2_ext = Vertex(vec4<f32>(l_pos.w * tri.v2.pos.xyz - l_pos.xyz, 0.0), vec3<f32>(0.0));

        addShadowVolumeTriangle(v0_ext, v1_ext, v2_ext);
    }

    // Loop over all edges of the triangle and extrude if necessary
    for (var i = 0; i < 3; i = i + 1) {
        let v0 = i;
        let nb = (i + 1) % 3;
        let v1 = (i + 2) % 3;

        // Fetch vertices
        let p0 = tri.v0.pos;
        let p1 = tri.v1.pos;
        let p2 = tri.v2.pos;

        // Recompute normals and directions for the extruded edges
        let ns0 = cross(p1.xyz - p0.xyz, p2.xyz - p0.xyz);
        let d0 = l_pos.xyz - l_pos.w * p0.xyz;

        // Extrude the edge if it's a silhouette or does not have a neighbor
        if faces_light != (dot(ns0, d0) > 0.0) {
            var i0 = v1;
            var i1 = v0;
            if(faces_light){
                i0 = v0;
                i1 = v1;
            }

            let v0_ext = Vertex(p0, vec3<f32>(0.0));
            let v1_ext = Vertex(vec4<f32>(l_pos.w * p0.xyz - l_pos.xyz, 0.0), vec3<f32>(0.0));
            let v2_ext = Vertex(p1, vec3<f32>(0.0));
            let v3_ext = Vertex(vec4<f32>(l_pos.w * p1.xyz - l_pos.xyz, 0.0),  vec3<f32>(0.0));

            //addShadowVolumeQuad(v0_ext, v1_ext, p1, vec4<f32>(l_pos.w * p1.xyz - l_pos.xyz, 0.0));
            addShadowVolumeQuad(v0_ext, v1_ext, v2_ext, v3_ext);
        }
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
