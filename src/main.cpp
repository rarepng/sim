#include <algorithm>
#include <cmath>
#include <emscripten/bind.h>
#include <vector>

enum SolverType {
  SOLVER_EXPLICIT_EULER = 0,
  SOLVER_SYMPLECTIC_EULER = 1,
  SOLVER_VERLET = 2,
  SOLVER_TIME_CORRECTED_VERLET = 3,
  SOLVER_RK2 = 4,
  SOLVER_RK4 = 5,
  SOLVER_IMPLICIT_EULER = 6
};

struct Vec3 {
  float x, y, z;
  constexpr Vec3 operator+(Vec3 o) const { return {x + o.x, y + o.y, z + o.z}; }
  constexpr Vec3 operator-(Vec3 o) const { return {x - o.x, y - o.y, z - o.z}; }
  constexpr Vec3 operator*(float s) const { return {x * s, y * s, z * s}; }
  [[nodiscard]] float length() const {
    return std::sqrt(x * x + y * y + z * z);
  }
};

struct Particle {
  Vec3 pos, old_pos, acc;
  Vec3 vel{0, 0, 0};
  float mass = 1.0f;
  float is_pinned = 0.0f;
  float prev_dt = 1.0f / 60.0f;
};

struct Spring {
  int p1, p2;
  float rest_len, k, damp;
};

class PhysicsWorld {
  std::vector<Particle> particles;
  std::vector<Spring> springs;

  Vec3 gravity{0.0f, -9.81f, 0.0f};
  Vec3 wind{0.0f, 0.0f, 0.0f};

  float global_damping = 0.99f;
  int sub_steps = 8;

  SolverType current_solver = SOLVER_VERLET;

  float fixed_dt = 1.0f / 60.0f;
  float accumulator = 0.0f;

  float sim_dt = 1.0f / 60.0f;
  bool use_substeps = false;

public:
  PhysicsWorld() {
    particles.reserve(1000);
    springs.reserve(3000);
  }
  void set_sim_dt(float dt) { sim_dt = std::max(1e-5f, dt); }

  void set_fixed_dt(float dt) { fixed_dt = std::max(1e-4f, dt); }

  void set_solver(int type) { current_solver = static_cast<SolverType>(type); }

  void set_pinned(int i, bool pin) {
    if (i >= 0 && i < particles.size()) {
      particles[i].is_pinned = pin ? 1.0f : 0.0f;
      particles[i].old_pos = particles[i].pos;
    }
  }

  void set_use_substeps(bool v) { use_substeps = v; }

  // void update(float dt) {
  //   float sub_dt = dt / sub_steps;

  //   for (int i = 0; i < sub_steps; ++i) {
  //     apply_forces();
  //     solve_springs(sub_dt);

  //     if (current_solver == SOLVER_VERLET) {
  //       integrate_verlet(sub_dt);
  //     } else if (current_solver == SOLVER_EXPLICIT_EULER) {
  //       integrate_explicit_euler(sub_dt);
  //     } else if (current_solver == SOLVER_SYMPLECTIC_EULER) {
  //       integrate_symplectic_euler(sub_dt);
  //     }

  //     solve_constraints();
  //   }
  // }
void update(float frame_dt) {
  int ticks = static_cast<int>(frame_dt / sim_dt);
  ticks = std::max(1, ticks);

  for (int i = 0; i < ticks; ++i) {
    step(sim_dt);
  }
}

  // void update(float frame_dt) {
  //   accumulator += frame_dt;

  //   while (accumulator >= fixed_dt) {
  //     step(fixed_dt);
  //     accumulator -= fixed_dt;
  //   }
  // }
  
  void step(float dt) {

      if (!use_substeps) {
        apply_forces();
        solve_springs(dt);
      switch (current_solver) {
      case SOLVER_EXPLICIT_EULER:
        integrate_explicit_euler(dt);
        break;
      case SOLVER_SYMPLECTIC_EULER:
        integrate_symplectic_euler(dt);
        break;
      case SOLVER_VERLET:
        integrate_verlet(dt);
        break;
      case SOLVER_TIME_CORRECTED_VERLET:
        integrate_tc_verlet(dt);
        break;
      case SOLVER_RK2:
        integrate_rk2(dt);
        break;
      case SOLVER_RK4:
        integrate_rk4(dt);
        break;
      case SOLVER_IMPLICIT_EULER:
        integrate_implicit_euler(dt);
        break;
      }
        solve_constraints();
        return;
      }

    float sub_dt = dt / sub_steps;

    for (int i = 0; i < sub_steps; ++i) {
      apply_forces();
      solve_springs(sub_dt);
      switch (current_solver) {
      case SOLVER_EXPLICIT_EULER:
        integrate_explicit_euler(sub_dt);
        break;
      case SOLVER_SYMPLECTIC_EULER:
        integrate_symplectic_euler(sub_dt);
        break;
      case SOLVER_VERLET:
        integrate_verlet(sub_dt);
        break;
      case SOLVER_TIME_CORRECTED_VERLET:
        integrate_tc_verlet(sub_dt);
        break;
      case SOLVER_RK2:
        integrate_rk2(sub_dt);
        break;
      case SOLVER_RK4:
        integrate_rk4(sub_dt);
        break;
      case SOLVER_IMPLICIT_EULER:
        integrate_implicit_euler(sub_dt);
        break;
      }

      solve_constraints();
    }
  }

  void set_gravity(float x, float y, float z) { gravity = {x, y, z}; }
  void set_wind(float x, float y, float z) { wind = {x, y, z}; }
  void set_damping(float d) { global_damping = d; }
  void set_sub_steps(int steps) { sub_steps = std::max(1, steps); }

  void set_mass(float m) {
    m = std::max(0.1f, m);
    for (auto &p : particles) {
      p.mass = m;
    }
  }

  void set_spring_params(float k, float damp) {
    for (auto &s : springs) {
      s.k = k;
      s.damp = damp;
    }
  }

  void add_particle(float x, float y, float z, float m, bool pin) {
    particles.push_back(
        {{x, y, z}, {x, y, z}, {0, 0, 0}, m, pin ? 1.0f : 0.0f});
  }

  //   void create_cloth(float sx, float sy, float sz, int w, int h, float sep,
  //                     float k, float damp) {
  //     int start = particles.size();
  //     for (int y = 0; y < h; ++y) {
  //       for (int x = 0; x < w; ++x) {
  //         bool pin = (y == 0); // Pin top row
  //         add_particle(sx + x * sep, sy + y * sep, sz, 1.0f, pin);
  //       }
  //     }
  //     for (int y = 0; y < h; ++y) {
  //       for (int x = 0; x < w; ++x) {
  //         int i = start + y * w + x;
  //         if (x > 0)
  //           springs.push_back({i, i - 1, sep, k, damp});
  //         if (y > 0)
  //           springs.push_back({i, i - w, sep, k, damp});
  //       }
  //     }
  //   }

  void create_cloth(float sx, float sy, float sz, int w, int h, float sep,
                    float k, float damp) {
    particles.clear();
    springs.clear();

    for (int y = 0; y < h; ++y) {
      for (int x = 0; x < w; ++x) {
        bool is_anchor = (y == 0 && (x == 0 || x == w - 1));

        Particle p;
        p.pos = {sx + x * sep, sy - y * sep, sz};
        p.old_pos = p.pos;
        p.acc = {0, 0, 0};
        p.vel = {0, 0, 0};
        p.mass = 1.0f;
        p.is_pinned = is_anchor ? 1.0f : 0.0f;

        particles.push_back(p);
      }
    }

    int start = 0;
    for (int y = 0; y < h; ++y) {
      for (int x = 0; x < w; ++x) {
        int i = y * w + x;
        if (x > 0)
          springs.push_back({i, i - 1, sep, k, damp});
        if (y > 0)
          springs.push_back({i, i - w, sep, k, damp});
        if (x > 0 && y > 0)
          springs.push_back({i, i - w - 1, std::sqrt(2.0f) * sep, k, damp});
        if (x < w - 1 && y > 0)
          springs.push_back({i, i - w + 1, std::sqrt(2.0f) * sep, k, damp});
      }
    }
  }

  auto get_p_ptr() const -> uintptr_t { return (uintptr_t)particles.data(); }
  auto get_s_ptr() const -> uintptr_t { return (uintptr_t)springs.data(); }
  auto get_p_count() const -> int { return particles.size(); }
  auto get_s_count() const -> int { return springs.size(); }

  void set_particle_pos(int i, float x, float y, float z) {
    if (i < particles.size()) {
      particles[i].pos = {x, y, z};
      particles[i].old_pos = {x, y, z};
    }
  }

  bool is_pinned(int i) {
    if (i >= 0 && i < particles.size())
      return particles[i].is_pinned > 0.5f;
    return false;
  }

private:
  void apply_forces() {
    for (auto &p : particles) {
      if (p.is_pinned > 0.5f)
        continue;
      p.acc = p.acc + gravity + wind;
    }
  }

  void solve_springs(float dt) {
    for (const auto &s : springs) {
      auto &p1 = particles[s.p1];
      auto &p2 = particles[s.p2];
      Vec3 delta = p1.pos - p2.pos;
      float len = delta.length();
      if (len < 0.001f)
        continue;

      // hooke's law
      float spring_force = (len - s.rest_len) * s.k;

      // damping
      Vec3 dir = delta * (1.0f / len);

      Vec3 v1 = (p1.pos - p1.old_pos) * (1.0f / dt);
      Vec3 v2 = (p2.pos - p2.old_pos) * (1.0f / dt);
      Vec3 rel_vel = v1 - v2;

      float vel_along_spring =
          rel_vel.x * dir.x + rel_vel.y * dir.y + rel_vel.z * dir.z;
      float damp_force = vel_along_spring * s.damp;

      float total_f_mag = spring_force + damp_force;
      Vec3 total_force = dir * total_f_mag;

      if (p1.is_pinned < 0.5f)
        p1.acc = p1.acc - total_force * (1.0f / p1.mass);
      if (p2.is_pinned < 0.5f)
        p2.acc = p2.acc + total_force * (1.0f / p2.mass);
    }
  }

  void integrate_verlet(float dt) {
    float dt_sq = dt * dt;
    for (auto &p : particles) {
      if (p.is_pinned > 0.5f)
        continue;

      Vec3 temp_pos = p.pos;
      Vec3 vel_vec = (p.pos - p.old_pos) * global_damping;

      p.pos = p.pos + vel_vec + p.acc * dt_sq;
      p.old_pos = temp_pos;

      p.vel = (p.pos - p.old_pos) * (1.0f / dt);
      p.acc = {0, 0, 0};
    }
  }

  void integrate_tc_verlet(float dt) {
    for (auto &p : particles) {
      if (p.is_pinned > 0.5f)
        continue;

      float dt_prev = p.prev_dt;
      Vec3 vel = (p.pos - p.old_pos) * (dt / dt_prev) * global_damping;

      Vec3 new_pos = p.pos + vel + p.acc * (dt * (dt + dt_prev) * 0.5f);

      p.old_pos = p.pos;
      p.pos = new_pos;
      p.vel = vel * (1.0f / dt);
      p.prev_dt = dt;
      p.acc = {0, 0, 0};
    }
  }
  void integrate_rk2(float dt) {
    for (auto &p : particles) {
      if (p.is_pinned > 0.5f)
        continue;

      Vec3 v0 = p.vel;
      Vec3 a0 = p.acc;

      Vec3 v_mid = v0 + a0 * (dt * 0.5f);
      Vec3 x_mid = p.pos + v0 * (dt * 0.5f);

      p.pos = p.pos + v_mid * dt;
      p.vel = v0 + a0 * dt;
      p.vel = p.vel * global_damping;

      p.old_pos = p.pos - p.vel * dt;
      p.acc = {0, 0, 0};
    }
  }
  void integrate_rk4(float dt) {
    for (auto &p : particles) {
      if (p.is_pinned > 0.5f)
        continue;

      Vec3 x0 = p.pos;
      Vec3 v0 = p.vel;
      Vec3 a0 = p.acc;

      Vec3 k1x = v0;
      Vec3 k1v = a0;

      Vec3 k2x = v0 + k1v * (dt * 0.5f);
      Vec3 k2v = a0;

      Vec3 k3x = v0 + k2v * (dt * 0.5f);
      Vec3 k3v = a0;

      Vec3 k4x = v0 + k3v * dt;
      Vec3 k4v = a0;

      p.pos = x0 + (k1x + k2x * 2 + k3x * 2 + k4x) * (dt / 6.0f);
      p.vel = v0 + (k1v + k2v * 2 + k3v * 2 + k4v) * (dt / 6.0f);
      p.vel = p.vel * global_damping;

      p.old_pos = p.pos - p.vel * dt;
      p.acc = {0, 0, 0};
    }
  }
  void integrate_implicit_euler(float dt) {
    for (auto &p : particles) {
      if (p.is_pinned > 0.5f)
        continue;

      // implicit velocity update
      p.vel = (p.vel + p.acc * dt) * (1.0f / (1.0f + dt));
      p.pos = p.pos + p.vel * dt;

      p.old_pos = p.pos - p.vel * dt;
      p.acc = {0, 0, 0};
    }
  }

  void integrate_explicit_euler(float dt) {
    for (auto &p : particles) {
      if (p.is_pinned > 0.5f)
        continue;

      p.pos = p.pos + p.vel * dt;
      p.vel = p.vel + p.acc * dt;
      p.vel = p.vel * global_damping;

      p.old_pos = p.pos;
      p.acc = {0, 0, 0};
    }
  }

  void integrate_symplectic_euler(float dt) {
    for (auto &p : particles) {
      if (p.is_pinned > 0.5f)
        continue;

      p.vel = p.vel + p.acc * dt;
      p.vel = p.vel * global_damping;
      p.pos = p.pos + p.vel * dt;

      p.old_pos = p.pos;
      p.acc = {0, 0, 0};
    }
  }

  void integrate(float dt) { // old
    float dt_sq = dt * dt;
    for (auto &p : particles) {
      if (p.is_pinned > 0.5f)
        continue;

      // verlet
      // x(t+1) = x(t) + (x(t) - x(t-1)) + a(t) * dt^2

      Vec3 vel = (p.pos - p.old_pos) * global_damping;
      p.old_pos = p.pos;
      p.pos = p.pos + vel + p.acc * dt_sq;

      p.acc = {0, 0, 0};
    }
  }

  void solve_constraints() {
    for (auto &p : particles) {
      if (p.pos.y > 900) {
        p.pos.y = 900;
        p.old_pos.y = 900;
      }
    }
  }
};

EMSCRIPTEN_BINDINGS(my_module) {
  emscripten::class_<PhysicsWorld>("PhysicsWorld")
      .constructor()
      .function("update", &PhysicsWorld::update)
      .function("createCloth", &PhysicsWorld::create_cloth)
      .function("setSolver", &PhysicsWorld::set_solver)
      .function("isPinned", &PhysicsWorld::is_pinned)
      .function("getPPtr", &PhysicsWorld::get_p_ptr)
      .function("getSPtr", &PhysicsWorld::get_s_ptr)
      .function("getPCount", &PhysicsWorld::get_p_count)
      .function("getSCount", &PhysicsWorld::get_s_count)
      .function("setParticlePos", &PhysicsWorld::set_particle_pos)
      .function("setGravity", &PhysicsWorld::set_gravity)
      .function("setWind", &PhysicsWorld::set_wind)
      .function("setDamping", &PhysicsWorld::set_damping)
      .function("setSubSteps", &PhysicsWorld::set_sub_steps)
      .function("setSpringParams", &PhysicsWorld::set_spring_params)
      .function("setPinned", &PhysicsWorld::set_pinned)
      .function("setMass", &PhysicsWorld::set_mass)
      .function("setFixedDt", &PhysicsWorld::set_fixed_dt)
      .function("setSimDt", &PhysicsWorld::set_sim_dt)
      .function("set_use_substeps",&PhysicsWorld::set_use_substeps);
}