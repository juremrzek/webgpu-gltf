alias float2 = vec2<f32>;
alias float3 = vec3<f32>;
alias float4 = vec4<f32>;
alias float = f32;

struct Mat4Uniform {
    m: mat4x4<f32>
}

struct Vertex {
    p: vec3<f32>,
    _padding: f32
}

@group(0) @binding(0) var<uniform> modelMatrix: Mat4Uniform;
@group(0) @binding(1) var<uniform> viewMatrix: Mat4Uniform;
@group(0) @binding(2) var<storage, read> positions: array<f32>;
@group(0) @binding(3) var<storage, read> normals: array<f32>;
@group(0) @binding(4) var<storage, read> indices: array<u32>;
@group(0) @binding(5) var<storage, read_write> outputVertices: array<f32>; 
@group(0) @binding(6) var<storage, read_write> outputVertexCount: atomic<u32>;
@group(0) @binding(7) var<storage, read_write> outputIndices: array<u32>;

fn getPosition(index: u32) -> float3 {
  let offset = index * 3;
  return vec3f(positions[offset + 0],
               positions[offset + 1],
               positions[offset + 2]);
}

fn getNormal(index: u32) -> float3 {
  let offset = index * 3;
  return vec3f(normals[offset + 0],
               normals[offset + 1],
               normals[offset + 2]);
}

fn setPosition(index: u32, value: float4) {
  let offset = index * 4;
  outputVertices[offset + 0] = value.x;
  outputVertices[offset + 1] = value.y;
  outputVertices[offset + 2] = value.z;
  outputVertices[offset + 3] = value.w;
}

@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) global_id : vec3<u32>) {
    let index = global_id.x * 3;
    let vertex_index = index * 3;

    let l_dir = float4(-100, -100, 50, 1);

    var v0 = viewMatrix.m * modelMatrix.m * float4(getPosition(indices[index + 0]), 1);
    var v1 = viewMatrix.m * modelMatrix.m * float4(getPosition(indices[index + 1]), 1);
    var v2 = viewMatrix.m * modelMatrix.m * float4(getPosition(indices[index + 2]), 1);
    let infinite_vertex = viewMatrix.m * modelMatrix.m * float4(l_dir.xyz, 0);

    let normal = normalize(cross(v1.xyz - v0.xyz, v2.xyz - v0.xyz));



    //render shadow caps



    //render sillhouettes
    let render_sillhouettes = true;
    if (render_sillhouettes) {
        var v_0 = v0;
        var v_1 = v1;
        var v_2 = infinite_vertex;

        setPosition(vertex_index + 3, v_0);
        setPosition(vertex_index + 4, v_1);
        setPosition(vertex_index + 5, v_2);

        v_0 = v1;
        v_1 = v2;
        v_2 = infinite_vertex;
        
        setPosition(vertex_index + 6, v_0);
        setPosition(vertex_index + 7, v_1);
        setPosition(vertex_index + 8, v_2);

        v_0 = v2;
        v_1 = v0;
        v_2 = infinite_vertex;
        
        setPosition(vertex_index + 9, v_0);
        setPosition(vertex_index + 10, v_1);
        setPosition(vertex_index + 11, v_2);
    }

    for (var i = 0u; i <= 9u; i = i+1u) {
       outputIndices[vertex_index + i] = vertex_index + i; 
    }

    //let ns0 = cross(v1 - v0, v2 - v0);
    //let ns1 = cross(v2 - v1, v0 - v1);
    //let ns2 = cross(v0 - v2, v1 - v2);

    //let d0 = l_pos - v0;
    //let d1 = l_pos - v1;
    //let d2 = l_pos - v2;



    /*for (var i = 0; i < 3; i = i+1){
        let v0 = i * 2;
        let nb = (i * 2 + 1);
        let v1 = (i * 2 + 2) % 3;
    }*/
    
}