alias float2 = vec2<f32>;
alias float3 = vec3<f32>;
alias float4 = vec4<f32>;
alias float = f32;

struct VertexInput {
    @location(0) position: float4,
    //@location(1) normal: float3,
}
struct VertexOutput {
    @builtin(position) position: float4,
}
struct Mat4Uniform {
     m: mat4x4<f32>
}
@group(0) @binding(0) var<uniform> projection: Mat4Uniform;
@group(0) @binding(1) var<uniform> view: Mat4Uniform;
@group(0) @binding(2) var<uniform> model: Mat4Uniform;

@vertex
fn second_vertex_main(vin: VertexInput) -> VertexOutput {
    var vout: VertexOutput;
    vout.position = projection.m * vin.position;
    return vout;
}

@fragment
fn second_fragment_main(fin: VertexOutput) -> @location(0) float4 {
    return float4(1, 1, 0, 1);
}