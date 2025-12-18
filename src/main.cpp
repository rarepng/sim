// simulation.cpp
#include <vector>
#include <cmath>
#include <algorithm>
#include <numbers>
#include <emscripten/bind.h>

// C++23: Use standard library math constants
using std::numbers::pi;

// Feature: Simple 2D Vector struct with modern operator overloading
struct Vec2 {
    float x, y;

    constexpr Vec2 operator+(Vec2 other) const { return {x + other.x, y + other.y}; }
    constexpr Vec2 operator-(Vec2 other) const { return {x - other.x, y - other.y}; }
    constexpr Vec2 operator*(float s) const { return {x * s, y * s}; }
    
    // C++23: Auto-deduced return types and methods for magnitude
    [[nodiscard]] auto length_sq() const -> float { return x * x + y * y; }
    [[nodiscard]] auto length() const -> float { return std::sqrt(length_sq()); }
};

struct Particle {
    Vec2 pos;
    Vec2 old_pos;
    Vec2 acceleration;
    float radius;
    int id;
};

// The Simulation Engine Class
class PhysicsWorld {
private:
    std::vector<Particle> particles;
    Vec2 gravity{0.0f, 1000.0f};
    Vec2 world_size;

public:
    // C++20/23: Designated initializers allowed in constructor logic
    PhysicsWorld(float width, float height) : world_size{width, height} {
        particles.reserve(100);
    }

    void add_particle(float x, float y, float r) {
        // Emplace back with direct initialization
        particles.emplace_back(Particle{
            .pos = {x, y},
            .old_pos = {x, y}, // Start stationary
            .acceleration = {0, 0},
            .radius = r,
            .id = static_cast<int>(particles.size())
        });
    }

    void update(float dt) {
        const float sub_steps = 8; // Sub-stepping for stability
        const float sub_dt = dt / sub_steps;

        for (int i = 0; i < sub_steps; ++i) {
            apply_gravity();
            apply_constraints();
            solve_collisions();
            update_positions(sub_dt);
        }
    }

    // Expose raw memory pointer to JavaScript for zero-copy rendering
    // This is crucial for high performance.
    auto get_particles_ptr() const -> uintptr_t {
        return reinterpret_cast<uintptr_t>(particles.data());
    }

    auto get_particle_count() const -> int {
        return static_cast<int>(particles.size());
    }

private:
    void apply_gravity() {
        for (auto& p : particles) {
            p.acceleration = gravity;
        }
    }

    void update_positions(float dt) {
        for (auto& p : particles) {
            Vec2 velocity = p.pos - p.old_pos;
            p.old_pos = p.pos;
            // Verlet integration formula
            p.pos = p.pos + velocity + p.acceleration * (dt * dt);
            p.acceleration = {0, 0}; // Reset acceleration
        }
    }

    void apply_constraints() {
        // Keep particles inside the "box"
        for (auto& p : particles) {
            if (p.pos.x < p.radius) p.pos.x = p.radius;
            if (p.pos.x > world_size.x - p.radius) p.pos.x = world_size.x - p.radius;
            if (p.pos.y < p.radius) p.pos.y = p.radius;
            if (p.pos.y > world_size.y - p.radius) p.pos.y = world_size.y - p.radius;
        }
    }

    void solve_collisions() {
        // Naive O(N^2) for simplicity; good enough for <1000 particles
        // Modern C++: range-based loops are cleaner
        size_t count = particles.size();
        for (size_t i = 0; i < count; ++i) {
            for (size_t j = i + 1; j < count; ++j) {
                Particle& p1 = particles[i];
                Particle& p2 = particles[j];

                Vec2 collision_axis = p1.pos - p2.pos;
                float dist_sq = collision_axis.length_sq();
                float min_dist = p1.radius + p2.radius;

                if (dist_sq < min_dist * min_dist) {
                    float dist = std::sqrt(dist_sq);
                    Vec2 n = collision_axis * (1.0f / dist);
                    float delta = min_dist - dist;
                    
                    // Push particles apart
                    p1.pos = p1.pos + n * (0.5f * delta);
                    p2.pos = p2.pos - n * (0.5f * delta);
                }
            }
        }
    }
};

// Emscripten Binding Code
EMSCRIPTEN_BINDINGS(physics_module) {
    emscripten::class_<PhysicsWorld>("PhysicsWorld")
        .constructor<float, float>()
        .function("addParticle", &PhysicsWorld::add_particle)
        .function("update", &PhysicsWorld::update)
        // We expose the memory address (pointer) directly
        .function("getParticlesPtr", &PhysicsWorld::get_particles_ptr)
        .function("getParticleCount", &PhysicsWorld::get_particle_count);
}