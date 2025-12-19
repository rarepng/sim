#include <vector>
#include <cmath>
#include <algorithm>
#include <emscripten/bind.h>

struct Vec3 {
    float x, y, z;
    constexpr Vec3 operator+(Vec3 o) const { return {x+o.x, y+o.y, z+o.z}; }
    constexpr Vec3 operator-(Vec3 o) const { return {x-o.x, y-o.y, z-o.z}; }
    constexpr Vec3 operator*(float s) const { return {x*s, y*s, z*s}; }
    [[nodiscard]] float length() const { return std::sqrt(x*x + y*y + z*z); }
};

struct Particle {
    Vec3 pos, old_pos, acc;
float mass = 1.0f;
    float is_pinned = 0.0f;
};

struct Spring {
    int p1, p2;
    float rest_len, k, damp;
};

class PhysicsWorld {
    std::vector<Particle> particles;
    std::vector<Spring> springs;
    
    Vec3 gravity{0.0f, 1000.0f, 0.0f};
    Vec3 wind{0.0f, 0.0f, 0.0f};
    
    float global_damping = 0.99f;
    int sub_steps = 8;

public:
    PhysicsWorld() { particles.reserve(1000); springs.reserve(3000); }

    // --- Core Physics ---
    void update(float dt) {
        // Divide the time step for stability
        float sub_dt = dt / sub_steps;
        
        for (int i = 0; i < sub_steps; ++i) {
            apply_forces();
            solve_springs();
            integrate(sub_dt);
            solve_constraints();
        }
    }

    // --- Setters for Parametrization ---
    void set_gravity(float x, float y, float z) { gravity = {x, y, z}; }
    void set_wind(float x, float y, float z) { wind = {x, y, z}; }
    void set_damping(float d) { global_damping = d; }
    void set_sub_steps(int steps) { sub_steps = std::max(1, steps); }
    
    void set_spring_params(float k, float damp) {
        for(auto& s : springs) { s.k = k; s.damp = damp; }
    }

    // --- Standard Setup & Helpers ---
    void add_particle(float x, float y, float z, float m, bool pin) {
        particles.push_back({ {x,y,z}, {x,y,z}, {0,0,0}, m, pin ? 1.0f : 0.0f });
    }
    
    void create_cloth(float sx, float sy, float sz, int w, int h, float sep, float k, float damp) {
        int start = particles.size();
        for(int y=0; y<h; ++y) {
            for(int x=0; x<w; ++x) {
                bool pin = (y==0); // Pin top row
                add_particle(sx + x*sep, sy + y*sep, sz, 1.0f, pin);
            }
        }
        for(int y=0; y<h; ++y) {
            for(int x=0; x<w; ++x) {
                int i = start + y*w + x;
                if(x>0) springs.push_back({i, i-1, sep, k, damp});
                if(y>0) springs.push_back({i, i-w, sep, k, damp});
            }
        }
    }

    // Expose memory
    auto get_p_ptr() const -> uintptr_t { return (uintptr_t)particles.data(); }
    auto get_s_ptr() const -> uintptr_t { return (uintptr_t)springs.data(); }
    auto get_p_count() const -> int { return particles.size(); }
    auto get_s_count() const -> int { return springs.size(); }
    
    // JS Helper to manipulate particles directly
    void set_particle_pos(int i, float x, float y, float z) {
        if(i < particles.size()) {
            particles[i].pos = {x,y,z};
            particles[i].old_pos = {x,y,z}; // Reset velocity
        }
    }

private:
    void apply_forces() {
        for(auto& p : particles) {
            if(p.is_pinned > 0.5f) continue;
            p.acc = p.acc + gravity + wind;
        }
    }

    void solve_springs() {
        for(const auto& s : springs) {
            auto& p1 = particles[s.p1];
            auto& p2 = particles[s.p2];
            Vec3 delta = p1.pos - p2.pos;
            float len = delta.length();
            if(len < 0.001f) continue;

            float force = (len - s.rest_len) * s.k;
            // Simple damping implementation
            Vec3 dir = delta * (1.0f/len);
            Vec3 vel = (p1.pos - p1.old_pos) - (p2.pos - p2.old_pos);
            float d_force = (vel.x*dir.x + vel.y*dir.y + vel.z*dir.z) * s.damp;

            Vec3 total = dir * (force + d_force);
            if(p1.is_pinned < 0.5f) p1.acc = p1.acc - total;
            if(p2.is_pinned < 0.5f) p2.acc = p2.acc + total;
        }
    }

    void integrate(float dt) {
        float dt_sq = dt * dt;
        for(auto& p : particles) {
            if(p.is_pinned > 0.5f) continue;
            Vec3 vel = (p.pos - p.old_pos) * global_damping;
            p.old_pos = p.pos;
            p.pos = p.pos + vel + p.acc * dt_sq;
            p.acc = {0,0,0};
        }
    }

    void solve_constraints() {
        // Floor at Y = 800
        for(auto& p : particles) {
            if(p.pos.y > 800) { p.pos.y = 800; p.old_pos.y = 800; }
        }
    }
};

EMSCRIPTEN_BINDINGS(my_module) {
    emscripten::class_<PhysicsWorld>("PhysicsWorld")
        .constructor()
        .function("update", &PhysicsWorld::update)
        .function("createCloth", &PhysicsWorld::create_cloth)
        .function("getPPtr", &PhysicsWorld::get_p_ptr)
        .function("getSPtr", &PhysicsWorld::get_s_ptr)
        .function("getPCount", &PhysicsWorld::get_p_count)
        .function("getSCount", &PhysicsWorld::get_s_count)
        .function("setParticlePos", &PhysicsWorld::set_particle_pos)
        // Setters
        .function("setGravity", &PhysicsWorld::set_gravity)
        .function("setWind", &PhysicsWorld::set_wind)
        .function("setDamping", &PhysicsWorld::set_damping)
        .function("setSubSteps", &PhysicsWorld::set_sub_steps)
        .function("setSpringParams", &PhysicsWorld::set_spring_params);
}