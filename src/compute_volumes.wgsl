alias float2 = vec2<f32>;
alias float3 = vec3<f32>;
alias float4 = vec4<f32>;
alias float = f32;

struct Mat4Uniform {
    m: mat4x4<f32>
}

@group(0) @binding(0) var<uniform> modelMatrix: Mat4Uniform;
@group(0) @binding(1) var<uniform> viewMatrix: Mat4Uniform;
@group(0) @binding(2) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> normals: array<vec3<f32>>;
@group(0) @binding(4) var<storage, read> indices: array<u32>;
@group(0) @binding(5) var<storage, read_write> outputVertices: array<vec4<f32>>; 
@group(0) @binding(6) var<storage, read_write> outputVertexCount: atomic<u32>;
@group(0) @binding(7) var<storage, read_write> outputIndices: array<u32>;

@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) global_id : vec3<u32>) {
    let index = global_id.x * 3;
    

    outputIndices[index + 0] = indices[index + 0];
    outputIndices[index + 1] = indices[index + 1];
    outputIndices[index + 2] = indices[index + 2];

    let v0 = positions[index + 0];
    let v1 = positions[index + 1];
    let v2 = positions[index + 2];

    let l_pos = float3(100, 100, 100);

    outputVertices[index + 0] = v0;
    outputVertices[index + 1] = v1;
    outputVertices[index + 2] = v2;
    //outputVertices[index + 3] = v3;

    /*let ns0 = cross(v1 - v0, v2 - v0);
    let ns1 = cross(v2 - v1, v0 - v1);
    let ns2 = cross(v0 - v2, v1 - v2);

    let d0 = l_pos - v0;
    let d1 = l_pos - v1;
    let d2 = l_pos - v2;

    var faces_light = true;*/

    /*if(!(dot(ns0, d0) > 0 || dot(ns1, d1) > 0 || dot(ns2, d2) > 0)) {

    }*/

    /*for (int i = 0; i < 3; i++){
        int v0 = i * 2;
        int nb = (i * 2 + 1);
        int v1 = (i * 2 + 2) % 3;

        let 
    }*/
    
}