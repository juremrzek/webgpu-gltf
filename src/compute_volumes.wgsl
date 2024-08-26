alias float2 = vec2<f32>;
alias float3 = vec3<f32>;
alias float4 = vec4<f32>;
alias float = f32;

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

@group(0) @binding(0) var<uniform> modelMatrix: Mat4Uniform;
@group(0) @binding(1) var<uniform> viewMatrix: Mat4Uniform;
@group(0) @binding(2) var<storage, read> positions: array<vec3<f32>>;
@group(0) @binding(3) var<storage, read> normals: array<vec3<f32>>;
@group(0) @binding(4) var<storage, read> indices: array<u32>;
@group(0) @binding(5) var<storage, read_write> outputVertices: array<vec3<f32>>; 
@group(0) @binding(6) var<storage, read_write> outputVertexCount: atomic<u32>;
@group(0) @binding(7) var<storage, read_write> outputIndices: array<u32>;

@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) global_id : vec3<u32>) {
    let global_index = global_id.x;
    
    outputVertices[global_index] = positions[global_index];
    outputIndices[global_index] = indices[global_index];
}
