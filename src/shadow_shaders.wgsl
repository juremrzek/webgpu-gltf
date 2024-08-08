alias float2 = vec2<f32>;
alias float3 = vec3<f32>;
alias float4 = vec4<f32>;
alias float = f32;

struct VertexInput {
    @location(0) position: float3,
}
struct VertexOutput {
    @builtin(position) position: float4,
}
struct Mat4Uniform {
    m: mat4x4<f32>
}

@group(0) @binding(0) var<uniform> view_proj: Mat4Uniform;
@group(1) @binding(0) var<uniform> node_transform: Mat4Uniform;
@group(2) @binding(0) var<uniform> shadow_transform: Mat4Uniform;
@group(1) @binding(2) var<uniform> node_id: u32;

@vertex
fn shadow_vertex_main(vin: VertexInput) -> VertexOutput {
    var vout: VertexOutput;
    var shadow_position = float4(vin.position, 1.0);
    if (node_id != 1u) {
        shadow_position = float4(0, 0, 0, 1);
    }
    else {
        shadow_position = shadow_transform.m * shadow_position;
    }
    vout.position = view_proj.m * node_transform.m * shadow_position;
    return vout;
}

@fragment
fn shadow_fragment_main(fin: VertexOutput) -> @location(0) float4 {
    return (vec4(0.0, 1.0, 1.0, 1.0));
}