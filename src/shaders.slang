
struct Particle {
    float3 pos, old_pos, acc;
    float3 vel={ 0, 0, 0 };
    float mass = 1.0f;
    float is_pinned = 0.0f;
    float prev_dt = 1.0f / 60.0f;
    float padding;
};
struct simParams {
    float timeScale = 1.0;
    uint subSteps = 8;
    int gravity = 100;
    // float metalness = 0.5;
    // float roughness = 0.5;
    float mass = 1.0;
    uint stiffness = 1200;
    float damping = 5.0;
    uint solver = 2;
    float simDt = 0.016;
    bool useTicks = true;
    float emission = 0.0;
    float transmission = 0.0;
    float ior = 1.5;
    float scale = 1.0;
    // vec4 colorPinned = '#ff00aa';
    // vec4 colorDefault = '#ffaa00';
    // bool useHeatmap = false;       // wip
};

[[vk::binding(0, 0)]] RWStructuredBuffer<Particle> particles;
[[vk::binding(1, 0)]] ConstantBuffer<simParams> params;

// [shader("compute")]
// [numthreads(64, 1, 1)]
// void computeMain(uint3 id : SV_DispatchThreadID) {
//     if (id.x >= params.count) return;

//     // Your familiar syntax
//     Particle p = particles[id.x];
//     p.vel += float3(0, -9.81, 0) * params.dt;
//     p.pos += p.vel * params.dt;

//     particles[id.x] = p;
// }

struct Uniforms
{
    float2 dimensions;
    float time;
    float _pad;
};
[[vk::binding(0, 0)]]
RWStructuredBuffer<float4> output;
[[vk::binding(1, 0)]]
ConstantBuffer<Uniforms> uniforms;

[shader("compute")]
[[numthreads(8, 8, 1)]]
void cxmain(uint3 tid: SV_DispatchThreadID)
{
    float width = uniforms.dimensions.x;
    float height = uniforms.dimensions.y;

    if (tid.x >= width || tid.y >= height)
    {
        return;
    }

    int idx = tid.y * uint(width) + tid.x;

    float x = float(tid.x) / float(width);
    float y = float(tid.y) / float(height);

    float r = sin(x * 10.0 + uniforms.time) * 0.5 + 0.5;
    float g = cos(y * 10.0 + uniforms.time) * 0.5 + 0.5;
    float b = sin((x + y) * 5.0 + uniforms.time) * 0.5 + 0.5;

    output[idx] = float4(r, g, b, 1.0);
}

[shader("vertex")]
float4 vxmain(uint i: SV_VertexID) : SV_Position
{
    var pos : float2[6] = {
        float2(-1.0, -1.0), float2(1.0, -1.0), float2(-1.0, 1.0),
        float2(-1.0, 1.0), float2(1.0, -1.0), float2(1.0, 1.0)
    };
    return float4(pos[i], 0.0, 1.0);
}

[shader("pixel")]
float4 pxmain(float4 pos: SV_Position) : SV_Target
{
    float width = uniforms.dimensions.x;
    uint idx = uint(pos.y) * uint(width) + uint(pos.x);
    return output[idx];
}
