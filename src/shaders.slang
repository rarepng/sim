struct SimParams {
    float timeScale;
    uint subSteps;
    uint solver;
    uint count;
    int4 gravity;
    int4 wind;
    float mass;
    float stiffness;
    float damping;
    float simDt;
    float emission;
    float transmission;
    float ior;
    float scale;
    float global_damping;
    uint scount;
    uint acount;
    uint useTicks;
    float3 rayo;
    float isClick;
    float3 rayd;
    float _pad;
};

struct Motion {
    float4 velocities;
    float4 oldPositions;
    float4 accelerations;
};

[[vk::binding(0, 0)]] ConstantBuffer<SimParams> params;
[[vk::binding(1, 0)]] RWStructuredBuffer<float4> positions_read;
[[vk::binding(2, 0)]] RWStructuredBuffer<float4> positions_write;
[[vk::binding(3, 0)]] RWStructuredBuffer<Motion> motions;
[[vk::binding(4, 0)]] RWStructuredBuffer<float> pinned;

[shader("compute")]
[[numthreads(64, 1, 1)]]
void cxextra(uint3 tid: SV_DispatchThreadID) {
    if (tid.x >= params.count) return;

    uint idx = tid.x;
    float sub_dt = params.simDt / float(params.subSteps);

    float3 pos = positions_read[idx].xyz;
    float3 vel = motions[idx].velocities.xyz;

    for (uint i = 0; i < params.subSteps; i++) {

        if (params.solver == 7) {
            integrate_velocity_verlet_pass1(idx, sub_dt);
            solve_constraints(idx);
            apply_forces(idx);
            solve_springs(idx, sub_dt);
            integrate_velocity_verlet_pass2(idx, sub_dt);
            continue;
        }

        apply_forces(idx);
        solve_springs(idx, sub_dt);

        switch (params.solver) {
        case 0: integrate_explicit_euler(idx, sub_dt); break;
        case 1: integrate_symplectic_euler(idx, sub_dt); break;
        case 2: integrate_verlet(idx, sub_dt); break;
        case 3: integrate_tc_verlet(idx, sub_dt); break;
        case 4: integrate_rk2(idx, sub_dt); break;
        case 5: integrate_rk4(idx, sub_dt); break;
        case 6: integrate_symplectic_euler(idx, sub_dt); break;
        }

        if (params.solver != 4 && params.solver != 5) {
            solve_constraints(idx);
        }
    }
}
float3 get_advanced_force(float3 pos, float3 rayo, float3 rayd, float3 vel) {

    float3 toPoint = pos - rayo;
    float proj = dot(toPoint, rayd);
    float3 pointOnRay = rayo + (rayd * (proj-20.0));

    float dist = length(pos - pointOnRay);
    float radius = 200.0;

    if (dist < radius) {

        float falloff = 1.0 - (dist / radius);
        falloff = falloff * falloff;
        float3 delta = pointOnRay - pos;

        float stiffness = 9000.0;
        float3 springForce = delta * stiffness * falloff;

        float3 dampingForce = -vel * 20.0 * falloff;

        return springForce + dampingForce;
    }

    return float3(0, 0, 0);
}
float3 get_plane_force(float3 pos, float3 rayo, float3 rayd) {
    float3 toPoint = pos - rayo;
    float proj = dot(toPoint, rayd);
    float3 pointOnRay = rayo + (rayd * proj);
    float distToRay = length(pos - pointOnRay);

    if (distToRay < 15.0) {

        float targetDistance = 50.0;
        float currentDistance = proj;

        float delta = targetDistance - currentDistance;

        return rayd * delta * 1000.0;
    }

    return float3(0, 0, 0);
}
float3 calculate_spring_force(uint myIdx, uint neighborIdx, float3 myPos, float3 myVel) {
    if (neighborIdx >= params.count) return float3(0, 0, 0);

    float3 otherPos = positions_read[neighborIdx].xyz;
    float3 otherVel = motions[neighborIdx].velocities.xyz;

    float3 delta = myPos - otherPos;
    float len = length(delta);

    if (len < 0.0001) return float3(0, 0, 0);

    float rest_len = 2.0 * params.scale;

    float spring_force = (len - rest_len) * params.stiffness;

    float3 dir = delta * (1.0 / len);

    float3 rel_vel = myVel - otherVel;
    float vel_along_spring = dot(rel_vel, dir);
    float damp_force = vel_along_spring * params.damping;

    float total_mag = spring_force + damp_force;

    return dir * total_mag;
}

void apply_forces(uint idx) {
    if (pinned[idx] > 0.5) return;

    float3 globalF = float3(params.gravity.xyz) + float3(params.wind.xyz);

    if (params.isClick > 0.5) {

            float3 pos = positions_read[idx].xyz;
            float3 vel = motions[idx].velocities.xyz;

            float3 mouseForce = get_advanced_force(pos, params.rayo, params.rayd, vel);

            motions[idx].accelerations.xyz += mouseForce * (1.0 / params.mass);

            if (length(mouseForce) > 1.0) {
                motions[idx].velocities.xyz *= 0.9;
            }
    }

    motions[idx].accelerations.xyz += globalF;
}

float3 get_acceleration(uint idx, float3 pos, float3 vel) {
    float3 total_force = float3(params.gravity.xyz) + float3(params.wind.xyz);
    total_force -= vel * params.global_damping;

    if (params.isClick > 0.5) {
        float3 pos = positions_read[idx].xyz;
        float3 vel = motions[idx].velocities.xyz;

        float3 mouseForce = get_advanced_force(pos, params.rayo, params.rayd, vel);

        motions[idx].accelerations.xyz += mouseForce * (1.0 / params.mass);

        if (length(mouseForce) > 1.0) {
            motions[idx].velocities.xyz *= 0.9;
        }
    }

    uint w = uint(sqrt(float(params.count)));
    uint gx = idx % w;
    uint gy = idx / w;

    if (gx < w - 1) total_force -= calculate_spring_force(idx, idx + 1, pos, vel);
    if (gx > 0) total_force -= calculate_spring_force(idx, idx - 1, pos, vel);
    if (gy > 0) total_force -= calculate_spring_force(idx, idx - w, pos, vel);
    if (gy < w - 1) total_force -= calculate_spring_force(idx, idx + w, pos, vel);

    return total_force * (1.0 / params.mass);
}
void solve_springs(uint idx, float dt) {
    float3 pos = positions_read[idx].xyz;
    float3 vel = motions[idx].velocities.xyz;

    uint w = uint(sqrt(float(params.count)));
    uint gx = idx % w;
    uint gy = idx / w;

    float3 totalForce = float3(0, 0, 0);

    if (gx < w - 1) totalForce += calculate_spring_force(idx, idx + 1, pos, vel);
    if (gx > 0) totalForce += calculate_spring_force(idx, idx - 1, pos, vel);
    if (gy > 0) totalForce += calculate_spring_force(idx, idx - w, pos, vel);
    if (gy < w - 1) totalForce += calculate_spring_force(idx, idx + w, pos, vel);

    
    
    if (pinned[idx] < 0.5) {
        motions[idx].accelerations.xyz -= totalForce * (1.0 / params.mass);
    }
}

void solve_constraints(uint idx) {
    float3 pos = positions_write[idx].xyz;

    
    if (pos.y < -100.0) {
        pos.y = -100.0;

        
        float3 vel = motions[idx].velocities.xyz;
        vel.y = -vel.y * 0.5;
        vel.x *= 0.9;
        vel.z *= 0.9;

        motions[idx].velocities.xyz = vel;

        
        float3 oldPos = motions[idx].oldPositions.xyz;
        oldPos.y = -100.0;
        motions[idx].oldPositions.xyz = oldPos;
    }

    positions_write[idx] = float4(pos, 1.0);
}



void integrate_verlet(uint idx, float dt) {
    if (pinned[idx] > 0.5) return;

    float dt_sq = dt * dt;
    float3 p_pos = positions_read[idx].xyz;
    float3 p_old_pos = motions[idx].oldPositions.xyz;
    float3 p_acc = motions[idx].accelerations.xyz;

    float3 temp_pos = p_pos;

    float3 vel_vec = (p_pos - p_old_pos) * params.global_damping;
    float3 new_pos = p_pos + vel_vec + p_acc * dt_sq;

    motions[idx].oldPositions.xyz = temp_pos;
    positions_write[idx] = float4(new_pos, 1.0);

    
    motions[idx].velocities.xyz = (new_pos - temp_pos) * (1.0 / dt);
    motions[idx].accelerations.xyz = float3(0, 0, 0);
}

void integrate_tc_verlet(uint idx, float dt) {
    if (pinned[idx] > 0.5) return;

    
    
    
    float dt_prev = dt;

    float3 p_pos = positions_read[idx].xyz;
    float3 p_old_pos = motions[idx].oldPositions.xyz;
    float3 p_acc = motions[idx].accelerations.xyz;

    float3 expansion = (p_pos - p_old_pos) * (dt / dt_prev) * params.global_damping;
    float3 new_pos = p_pos + expansion + p_acc * (dt * (dt + dt_prev) * 0.5);

    motions[idx].oldPositions.xyz = p_pos;
    positions_write[idx] = float4(new_pos, 1.0);
    motions[idx].velocities.xyz = (new_pos - p_pos) * (1.0 / dt);
    motions[idx].accelerations.xyz = float3(0, 0, 0);
}

void integrate_explicit_euler(uint idx, float dt) {
    if (pinned[idx] > 0.5) return;

    float3 p_pos = positions_read[idx].xyz;
    float3 p_vel = motions[idx].velocities.xyz;
    float3 p_acc = motions[idx].accelerations.xyz;

    float3 new_pos = p_pos + p_vel * dt;
    float3 new_vel = p_vel + p_acc * dt;
    new_vel *= params.global_damping;

    motions[idx].oldPositions.xyz = p_pos;
    positions_write[idx] = float4(new_pos, 1.0);
    motions[idx].velocities.xyz = new_vel;
    motions[idx].accelerations.xyz = float3(0, 0, 0);
}

void integrate_symplectic_euler(uint idx, float dt) {
    if (pinned[idx] > 0.5) return;

    float3 p_pos = positions_read[idx].xyz;
    float3 p_vel = motions[idx].velocities.xyz;
    float3 p_acc = motions[idx].accelerations.xyz;

    p_vel += p_acc * dt;
    p_vel *= params.global_damping;

    float3 new_pos = p_pos + p_vel * dt;

    motions[idx].oldPositions.xyz = p_pos;
    positions_write[idx] = float4(new_pos, 1.0);
    motions[idx].velocities.xyz = p_vel;
    motions[idx].accelerations.xyz = float3(0, 0, 0);
}

void integrate_rk2(uint idx, float dt) {
    if (pinned[idx] > 0.5) return;

    float3 x0 = positions_read[idx].xyz;
    float3 v0 = motions[idx].velocities.xyz;

    float3 a1 = get_acceleration(idx, x0, v0);

    float3 x_mid = x0 + v0 * (dt * 0.5);
    float3 v_mid = v0 + a1 * (dt * 0.5);

    float3 a2 = get_acceleration(idx, x_mid, v_mid);

    float3 new_pos = x0 + v_mid * dt;
    float3 new_vel = v0 + a2 * dt;

    motions[idx].oldPositions.xyz = new_pos - new_vel * dt;
    positions_write[idx] = float4(new_pos, 1.0);
    motions[idx].velocities.xyz = new_vel;
    motions[idx].accelerations.xyz = float3(0, 0, 0);
}

void integrate_rk4(uint idx, float dt) {
    if (pinned[idx] > 0.5) return;

    float3 x = positions_read[idx].xyz;
    float3 v = motions[idx].velocities.xyz;

    float3 a1 = get_acceleration(idx, x, v);

    float3 x2 = x + v * (dt * 0.5);
    float3 v2 = v + a1 * (dt * 0.5);
    float3 a2 = get_acceleration(idx, x2, v2);

    float3 x3 = x + v2 * (dt * 0.5);
    float3 v3 = v + a2 * (dt * 0.5);
    float3 a3 = get_acceleration(idx, x3, v3);

    float3 x4 = x + v3 * dt;
    float3 v4 = v + a3 * dt;
    float3 a4 = get_acceleration(idx, x4, v4);

    float3 new_pos = x + (v + v2 * 2.0 + v3 * 2.0 + v4) * (dt / 6.0);
    float3 new_vel = v + (a1 + a2 * 2.0 + a3 * 2.0 + a4) * (dt / 6.0);

    motions[idx].oldPositions.xyz = new_pos - new_vel * dt;
    positions_write[idx] = float4(new_pos, 1.0);
    motions[idx].velocities.xyz = new_vel;
    motions[idx].accelerations.xyz = float3(0, 0, 0);
}

void integrate_velocity_verlet_pass1(uint idx, float dt) {
    if (pinned[idx] > 0.5) return;

    float3 pos = positions_read[idx].xyz;
    float3 vel = motions[idx].velocities.xyz;
    float3 acc = motions[idx].accelerations.xyz;

    vel += acc * (dt * 0.5);
    float3 new_pos = pos + vel * dt;

    motions[idx].oldPositions.xyz = pos;
    positions_write[idx] = float4(new_pos, 1.0);
    motions[idx].velocities.xyz = vel;
}

void integrate_velocity_verlet_pass2(uint idx, float dt) {
    if (pinned[idx] > 0.5) return;

    float3 vel = motions[idx].velocities.xyz;
    float3 acc = motions[idx].accelerations.xyz;

    vel += acc * (dt * 0.5);
    vel *= params.global_damping;

    motions[idx].velocities.xyz = vel;
    motions[idx].accelerations.xyz = float3(0, 0, 0);
}