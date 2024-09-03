alias float2 = vec2<f32>;
alias float3 = vec3<f32>;
alias float4 = vec4<f32>;
alias float = f32;

struct VertexInput {
    @location(0) position: float3,
    @location(1) normal: float3,
}
struct VertexOutput {
    @builtin(position) position: float4,
}
struct Mat4Uniform {
    m: mat4x4<f32>
}

@group(0) @binding(0) var<uniform> projection: Mat4Uniform;
@group(0) @binding(1) var<uniform> view: Mat4Uniform;
@group(1) @binding(0) var<uniform> model: Mat4Uniform;

@vertex
fn first_vertex_main(vin: VertexInput) -> VertexOutput {
    var vout: VertexOutput;
    vout.position = projection.m * view.m * model.m * float4(vin.position, 1);
    return vout;
}

struct MaterialParams {
    base_color_factor: float4,
    emissive_factor: float4,
    metallic_factor: f32,
    roughness_factor: f32,
};

@group(2) @binding(0) var<uniform> material: MaterialParams;

@fragment
fn first_fragment_main(fin: VertexOutput) -> @location(0) float4 {
    return float4(material.base_color_factor.xyz * 0.3, 1);
}

