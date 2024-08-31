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

fn setPosition(index: u32, value: float4) {
  let offset = index * 4;
  outputVertices[offset + 0] = value.x;
  outputVertices[offset + 1] = value.y;
  outputVertices[offset + 2] = value.z;
  outputVertices[offset + 3] = value.w;
}

fn extrudeVertex(vertex: vec4f, light_pos: vec4f) -> vec4f {
    let direction = normalize(vertex - light_pos);
    let out = vertex - direction * 100;
    return out/out.w;
}

@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) global_id : vec3<u32>) {
    let index = global_id.x * 3;
    let vertex_index = index * 4;

    let l_dir = float4(-100, -100, 50, 1);

    let v0 = float4(getPosition(indices[index + 0]), 1);
    let v1 = float4(getPosition(indices[index + 1]), 1);
    let v2 = float4(getPosition(indices[index + 2]), 1);

    //render shadow caps

    setPosition(vertex_index + 0, v0);
    setPosition(vertex_index + 1, v1);
    setPosition(vertex_index + 2, v2);

    //render sillhouettes
    let render_sillhouettes = true;
    let infinite_vertex = float4(l_dir.xyz, 0);
    if (render_sillhouettes) {
        var v_0 = viewMatrix.m * modelMatrix.m * v0;
        var v_1 = viewMatrix.m * modelMatrix.m * v1;
        var v_2 = viewMatrix.m * modelMatrix.m * infinite_vertex;

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

    for (var i = 0u; i <= 20u; i = i+1u) {
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