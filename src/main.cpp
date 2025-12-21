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
	SOLVER_IMPLICIT_EULER = 6,
	SOLVER_VEOLCITY_VERLET = 7
};

struct Vec3 {
	float x, y, z;
	constexpr Vec3 operator+(Vec3 o) const {
		return {x + o.x, y + o.y, z + o.z};
	}
	constexpr Vec3 operator-(Vec3 o) const {
		return {x - o.x, y - o.y, z - o.z};
	}
	constexpr Vec3 operator*(float s) const {
		return {x * s, y * s, z * s};
	}
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
	float padding;
};

struct Spring {
	int p1, p2;
	float rest_len, k, damp;
};

class PhysicsWorld {
	std::vector<Particle> particles;
	std::vector<Spring> springs;

	// maybe
	std::vector<std::vector<int>> adjacency_list;

	Vec3 gravity{0.0f, -9.81f, 0.0f};
	Vec3 wind{0.0f, 0.0f, 0.0f};

	float global_damping = 0.99f;
	int sub_steps = 8;

	SolverType current_solver = SOLVER_VERLET;

	float fixed_dt = 1.0f / 60.0f;
	float accumulator = 0.0f;

	float sim_dt = 1.0f / 60.0f;
	bool use_ticks = false;

public:
	PhysicsWorld() {
		particles.reserve(1000);
		springs.reserve(3000);
		adjacency_list.reserve(1000);
	}
	void set_sim_dt(float dt) {
		sim_dt = std::max(1e-5f, dt);
	}

	void set_fixed_dt(float dt) {
		fixed_dt = std::max(1e-4f, dt);
	}

	void set_solver(int type) {
		current_solver = static_cast<SolverType>(type);
	}

	void set_pinned(int i, bool pin) {
		if (i >= 0 && i < particles.size()) {
			particles[i].is_pinned = pin ? 1.0f : 0.0f;
			particles[i].old_pos = particles[i].pos;
		}
	}

	void set_use_substeps(bool v) {
		use_ticks = v;
	}

	void update(float frame_dt) {
    if(!use_ticks){
		int ticks = static_cast<int>(frame_dt / sim_dt);
		ticks = std::max(1, ticks);

		for (int i = 0; i < ticks; ++i) {
			step(sim_dt);
		}
      
    }else{
      step(sim_dt);
    }
	}
	void step(float dt) {
		dt = std::min(dt, 0.05f);
		float sub_dt = dt / sub_steps;

		for (int i = 0; i < sub_steps; ++i) {

			if (current_solver == SOLVER_VEOLCITY_VERLET) {
				integrate_velocity_verlet_pass1(sub_dt);

				solve_constraints();

				apply_forces();
				solve_springs(sub_dt);

				integrate_velocity_verlet_pass2(sub_dt);

				continue;
			}

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
				integrate_symplectic_euler(sub_dt);
				break;
			}

			if (current_solver != SOLVER_RK2 && current_solver != SOLVER_RK4) {
				solve_constraints();
			}
		}
	}

	void set_gravity(float x, float y, float z) {
		gravity = {x, y, z};
	}
	void set_wind(float x, float y, float z) {
		wind = {x, y, z};
	}
	void set_damping(float d) {
		global_damping = d;
	}
	void set_sub_steps(int steps) {
		sub_steps = std::max(1, steps);
	}

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

	void create_cloth(float sx, float sy, float sz, int w, int h, float sep,
	                  float k, float damp) {
		particles.clear();
		springs.clear();
		adjacency_list.clear();

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
				p.prev_dt = 1.0f / 60.0f;

				particles.push_back(p);
			}
		}
		adjacency_list.resize(particles.size());

		for (int y = 0; y < h; ++y) {
			for (int x = 0; x < w; ++x) {
				int i = y * w + x;

				auto add_spring = [&](int p1, int p2, float len) {
					springs.push_back({p1, p2, len, k, damp});
					int s_idx = springs.size() - 1;

					adjacency_list[p1].push_back(s_idx);
					adjacency_list[p2].push_back(s_idx);
				};

				if (x > 0)
					add_spring(i, i - 1, sep);
				if (y > 0)
					add_spring(i, i - w, sep);
				if (x > 0 && y > 0)
					add_spring(i, i - w - 1, std::sqrt(2.0f) * sep);
				if (x < w - 1 && y > 0)
					add_spring(i, i - w + 1, std::sqrt(2.0f) * sep);
			}
		}
	}

	auto get_p_ptr() const -> uintptr_t {
		return (uintptr_t)particles.data();
	}
	auto get_s_ptr() const -> uintptr_t {
		return (uintptr_t)springs.data();
	}
	auto get_p_count() const -> int {
		return particles.size();
	}
	auto get_s_count() const -> int {
		return springs.size();
	}

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

			if (len < 0.0001f)
				continue;

			// hooke
			float spring_force = (len - s.rest_len) * s.k;

			Vec3 dir = delta * (1.0f / len);

			Vec3 v1 = p1.vel;
			Vec3 v2 = p2.vel;
			Vec3 rel_vel = v1 - v2;

			float vel_along_spring =
			    rel_vel.x * dir.x + rel_vel.y * dir.y + rel_vel.z * dir.z;

			float damp_force = vel_along_spring * s.damp;

			// float max_force = 5000.0f; // arbitrary safety
			// if (damp_force > max_force)
			//   damp_force = max_force;
			// if (damp_force < -max_force)
			//   damp_force = -max_force;

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
		#pragma omp parallel for
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
		#pragma omp parallel for
		for (auto &p : particles) {
			if (p.is_pinned > 0.5f)
				continue;

			float dt_prev = p.prev_dt;

			if (dt_prev < 1e-5f) {
				dt_prev = dt;
			}

			Vec3 expansion = (p.pos - p.old_pos) * (dt / dt_prev) * global_damping;

			Vec3 new_pos = p.pos + expansion + p.acc * (dt * (dt + dt_prev) * 0.5f);

			p.old_pos = p.pos;
			p.pos = new_pos;

			p.vel = (p.pos - p.old_pos) * (1.0f / dt);

			p.prev_dt = dt;
			p.acc = {0, 0, 0};
		}
	}
	void integrate_velocity_verlet_pass1(float dt) {
		#pragma omp parallel for
		for (auto &p : particles) {
			if (p.is_pinned > 0.5f)
				continue;

			p.vel = p.vel + p.acc * (dt * 0.5f);

			p.pos = p.pos + p.vel * dt;

			p.old_pos = p.pos;
		}
	}
	Vec3 calculate_acceleration(const Vec3 &pos, const Vec3 &vel, float mass) {
		Vec3 total_force = {0, 0, 0};

		total_force = total_force + Vec3(0, -9.81f, 0) * mass;

		total_force = total_force - vel * 0.5f;

		return total_force * (1.0f / mass);
	}

	void integrate_velocity_verlet_pass2(float dt) {
		#pragma omp parallel for
		for (auto &p : particles) {
			if (p.is_pinned > 0.5f)
				continue;

			p.vel = p.vel + p.acc * (dt * 0.5f);

			p.vel = p.vel * global_damping;

			p.acc = {0, 0, 0};
		}
	}

	Vec3 get_acceleration(int p_idx, Vec3 pos, Vec3 vel, float dt) {
		const auto &p = particles[p_idx];
		Vec3 total_force = gravity + wind;

		total_force = total_force - vel * global_damping;

		const auto &my_springs = adjacency_list[p_idx];

		for (int s_idx : my_springs) {
			const auto &s = springs[s_idx];

			int other_idx = (s.p1 == p_idx) ? s.p2 : s.p1;
			const auto &other_p = particles[other_idx];

			Vec3 delta = pos - other_p.pos;

			float dist = delta.length();
			if (dist < 0.0001f)
				continue;

			Vec3 dir = delta * (1.0f / dist);
			float displacement = dist - s.rest_len;

			// hooke 2
			float spring_force = displacement * s.k;

			Vec3 rel_vel = vel - other_p.vel;
			float vel_along_spring =
			    rel_vel.x * dir.x + rel_vel.y * dir.y + rel_vel.z * dir.z;
			float damp_force = vel_along_spring * s.damp;

			Vec3 force = dir * -(spring_force + damp_force);
			total_force = total_force + force;
		}

		return total_force * (1.0f / p.mass);
	}

	void integrate_rk2(float dt) {
		#pragma omp parallel for
		for (int i = 0; i < particles.size(); ++i) {
			auto &p = particles[i];
			if (p.is_pinned > 0.5f)
				continue;

			Vec3 x0 = p.pos;
			Vec3 v0 = p.vel;

			Vec3 a1 = get_acceleration(i, x0, v0, dt);

			Vec3 x_mid = x0 + v0 * (dt * 0.5f);
			Vec3 v_mid = v0 + a1 * (dt * 0.5f);

			Vec3 a2 = get_acceleration(i, x_mid, v_mid, dt);

			p.pos = x0 + v_mid * dt;
			p.vel = v0 + a2 * dt;

			// verlet compatibility
			p.old_pos = p.pos - p.vel * dt;
			p.acc = {0, 0, 0};
		}
	}
	void integrate_rk4(float dt) {
		#pragma omp parallel for
		for (int i = 0; i < particles.size(); ++i) {
			auto &p = particles[i];
			if (p.is_pinned > 0.5f)
				continue;

			Vec3 x = p.pos;
			Vec3 v = p.vel;

			Vec3 a1 = get_acceleration(i, x, v, dt);
			Vec3 v1 = v;

			Vec3 x2 = x + v1 * (dt * 0.5f);
			Vec3 v2 = v + a1 * (dt * 0.5f);
			Vec3 a2 = get_acceleration(i, x2, v2, dt);

			Vec3 x3 = x + v2 * (dt * 0.5f);
			Vec3 v3 = v + a2 * (dt * 0.5f);
			Vec3 a3 = get_acceleration(i, x3, v3, dt);

			Vec3 x4 = x + v3 * dt;
			Vec3 v4 = v + a3 * dt;
			Vec3 a4 = get_acceleration(i, x4, v4, dt);

			p.pos = x + (v1 + v2 * 2.0f + v3 * 2.0f + v4) * (dt / 6.0f);

			p.vel = v + (a1 + a2 * 2.0f + a3 * 2.0f + a4) * (dt / 6.0f);

			p.old_pos = p.pos - p.vel * dt;
			p.acc = {0, 0, 0};
		}
	}
	void integrate_implicit_euler(float dt) {
		#pragma omp parallel for
		for (auto &p : particles) {
			if (p.is_pinned > 0.5f)
				continue;

			p.vel = p.vel + p.acc * dt;

			// p.vel = p.vel * 0.99f;

			p.pos = p.pos + p.vel * dt;

			// verlet compatibility
			p.old_pos = p.pos - p.vel * dt;
			p.acc = {0, 0, 0};
		}
	}

	void integrate_explicit_euler(float dt) {
		#pragma omp parallel for
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
		#pragma omp parallel for
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

	void integrate(float dt) { // old & useless
		float dt_sq = dt * dt;
		#pragma omp parallel for
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
		#pragma omp parallel for
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
	.function("set_use_substeps", &PhysicsWorld::set_use_substeps);
}