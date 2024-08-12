alias float2 = vec2<f32>;
alias float3 = vec3<f32>;
alias float4 = vec4<f32>;
alias float = f32;

struct VertexInput {
    @location(0) position: float3,
    @location(1) normal: float3
}
struct VertexOutput {
    @builtin(position) position: float4,
    @location(1) normal: float3,
    @location(2) brightness: float
}
struct Mat4Uniform {
     m: mat4x4<f32>
}

@group(0) @binding(0) var<uniform> projection: Mat4Uniform;
@group(0) @binding(1) var<uniform> view: Mat4Uniform;
@group(1) @binding(0) var<uniform> model: Mat4Uniform;
@group(1) @binding(1) var<uniform> inverse_transpose: Mat4Uniform;
@group(2) @binding(0) var<uniform> shadow_transform: Mat4Uniform;

@vertex
fn vertex_main(vin: VertexInput) -> VertexOutput {
    var vout: VertexOutput;
    vout.position = projection.m * view.m * model.m * float4(vin.position, 1.0);

    var light_direction = float4(normalize(float3(1, 1, 0)), 1);
    var normal_tmp = normalize(inverse_transpose.m * float4(vin.normal, 1.0));
    vout.brightness = max(dot(light_direction, normal_tmp), 0.0);
    vout.normal = float3(normal_tmp.xyz);
    return vout;
}

struct MaterialParams {
    base_color_factor: float4,
    emissive_factor: float4,
    metallic_factor: f32,
    roughness_factor: f32,
};

@group(3) @binding(0) var<uniform> material: MaterialParams;

@fragment
fn fragment_main(fin: VertexOutput) -> @location(0) float4 {
    var color = material.base_color_factor.xyz;
    return float4((color * 0.3) + (color * fin.brightness * 0.7), 1);
}