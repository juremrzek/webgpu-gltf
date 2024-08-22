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

@group(0) @binding(0) var<uniform> projection: Mat4Uniform;
@group(0) @binding(1) var<uniform> view: Mat4Uniform;
@group(0) @binding(2) var<uniform> light_view_projection: Mat4Uniform;
@group(1) @binding(0) var<uniform> model: Mat4Uniform;
@group(1) @binding(2) var<uniform> node_id: u32;

@vertex
fn third_vertex_main(vin: VertexInput) -> VertexOutput {
    var vout: VertexOutput;
    vout.position = light_view_projection.m * model.m * float4(vin.position, 1.0);
    return vout;
}