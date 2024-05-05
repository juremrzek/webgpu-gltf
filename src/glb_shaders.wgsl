alias float2 = vec2<f32>;
alias float3 = vec3<f32>;
alias float4 = vec4<f32>;

struct VertexInput {
     @location(0) position: float3,
     @location(1) normal: float3
}
struct VertexOutput {
     @builtin(position) position: float4,
     @location(1) normal: float3
}
struct Mat4Uniform {
     m: mat4x4<f32>,
}

@group(0) @binding(0) var<uniform> view_proj: Mat4Uniform;
@group(1) @binding(0) var<uniform> node_transform: Mat4Uniform;

@vertex
fn vertex_main(vin: VertexInput) -> VertexOutput {
     var vout: VertexOutput;
     vout.position = view_proj.m * node_transform.m * float4(vin.position, 1.0);
     vout.normal = vin.normal;
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
fn fragment_main(fin: VertexOutput) -> @location(0) float4 {
     var color = float4(material.base_color_factor.xyz, 1.0);
     color.w = 1.0;
     return color;
}