alias float2 = vec2<f32>;
alias float3 = vec3<f32>;
alias float4 = vec4<f32>;
alias float = f32;

struct Mat4Uniform {
    m: mat4x4<f32>
}

@group(0) @binding(0) var<uniform> inverseTranspose: Mat4Uniform;
@group(0) @binding(1) var<storage, read> positions: array<f32>;
@group(0) @binding(2) var<storage, read> indices: array<u32>;
@group(0) @binding(3) var<storage, read_write> outputVertices: array<f32>; 
@group(0) @binding(4) var<storage, read_write> outputIndices: array<u32>;

fn getPosition(index: u32) -> float3 {
  let offset = index * 3;
  return vec3f(positions[offset + 0],
               positions[offset + 1],
               positions[offset + 2]);
}

fn setPosition(index: u32, value: float4) {
  let offset = index * 4;
  outputVertices[offset + 0] = value.x;
  outputVertices[offset + 1] = value.y;
  outputVertices[offset + 2] = value.z;
  outputVertices[offset + 3] = value.w;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id : vec3<u32>) {
    let index = global_id.x * 3;
    let vertex_index = index * 3;

    let l_dir = normalize(float3(-5, -10, 5));

    var v0 = float4(getPosition(indices[index + 0]), 1);
    var v1 = float4(getPosition(indices[index + 1]), 1);
    var v2 = float4(getPosition(indices[index + 2]), 1);

    let normal = normalize(cross(v1.xyz - v0.xyz, v2.xyz - v0.xyz));
    let transformed_normal = normalize((inverseTranspose.m * float4(normal, 1)).xyz);

    var facing_light = false;
    if dot(transformed_normal, l_dir.xyz) > 0.0 {
        facing_light = true;
    }

    var v_0 = v0;
    var v_1 = v1;
    var infinite_vertex = vec4(l_dir, 0);
    if(facing_light) {
        v_0 = v1;
        v_1 = v0;
    }

    setPosition(vertex_index + 3, v_0);
    setPosition(vertex_index + 4, v_1);
    setPosition(vertex_index + 5, infinite_vertex);

    v_0 = v1;
    v_1 = v2;
    if(facing_light) {
        v_0 = v2;
        v_1 = v1;
    }
    
    setPosition(vertex_index + 6, v_0);
    setPosition(vertex_index + 7, v_1);
    setPosition(vertex_index + 8, infinite_vertex);

    v_0 = v2;
    v_1 = v0;
    if(facing_light) {
        v_0 = v0;
        v_1 = v2;
    }
    
    setPosition(vertex_index + 9, v_0);
    setPosition(vertex_index + 10, v_1);
    setPosition(vertex_index + 11, infinite_vertex);

    for (var i = 0u; i <= 9u; i = i+1u) {
       outputIndices[vertex_index + i] = vertex_index + i; 
    }
}