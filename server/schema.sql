CREATE SCHEMA IF NOT EXISTS winter_arc;
CREATE TABLE IF NOT EXISTS winter_arc.users (
 id uuid PRIMARY KEY, username text UNIQUE NOT NULL CHECK(username ~ '^[a-z0-9_]{3,20}$'),
 password_hash text NOT NULL, goal text NOT NULL DEFAULT '' CHECK(length(goal)<=60),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS winter_arc.sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES winter_arc.users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS wa_sessions_user ON winter_arc.sessions(user_id);
CREATE INDEX IF NOT EXISTS wa_sessions_expiry ON winter_arc.sessions(expires_at);
CREATE TABLE IF NOT EXISTS winter_arc.targets (
 user_id uuid PRIMARY KEY REFERENCES winter_arc.users(id) ON DELETE CASCADE,
 weekly_goal integer NOT NULL DEFAULT 0 CHECK(weekly_goal BETWEEN 0 AND 7),
 cal_target integer NOT NULL DEFAULT 0 CHECK(cal_target=0 OR cal_target BETWEEN 500 AND 10000),
 pro_target integer NOT NULL DEFAULT 0 CHECK(pro_target=0 OR pro_target BETWEEN 10 AND 500)
);
CREATE TABLE IF NOT EXISTS winter_arc.workouts (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES winter_arc.users(id) ON DELETE CASCADE,
 date date NOT NULL, type text NOT NULL CHECK(type IN ('Gym','Run','Walk','Yoga','Sports','Cycling','Home workout')),
 minutes integer NOT NULL CHECK(minutes BETWEEN 1 AND 600), weight double precision CHECK(weight BETWEEN 20 AND 400),
 note text NOT NULL DEFAULT '' CHECK(length(note)<=80), created_at timestamptz NOT NULL DEFAULT now(),
 import_key text, UNIQUE(user_id, import_key)
);
CREATE INDEX IF NOT EXISTS wa_workouts_user_date ON winter_arc.workouts(user_id,date);
CREATE TABLE IF NOT EXISTS winter_arc.meals (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES winter_arc.users(id) ON DELETE CASCADE, date date NOT NULL,
 label text NOT NULL DEFAULT '' CHECK(length(label)<=40), calories integer NOT NULL CHECK(calories BETWEEN 0 AND 5000),
 protein integer NOT NULL CHECK(protein BETWEEN 0 AND 300), created_at timestamptz NOT NULL DEFAULT now(),
 import_key text, UNIQUE(user_id, import_key)
);
CREATE INDEX IF NOT EXISTS wa_meals_user_date ON winter_arc.meals(user_id,date);
CREATE TABLE IF NOT EXISTS winter_arc.personal_records (
 user_id uuid NOT NULL REFERENCES winter_arc.users(id) ON DELETE CASCADE,
 lift text NOT NULL CHECK(lift IN ('Bench press','Squat','Deadlift','Overhead press','Pull-up (+kg)')),
 kg double precision NOT NULL CHECK(kg BETWEEN 1 AND 700), date date NOT NULL, PRIMARY KEY(user_id,lift)
);
CREATE TABLE IF NOT EXISTS winter_arc.rate_limits (key text PRIMARY KEY, hits integer NOT NULL, expires_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS wa_rate_expiry ON winter_arc.rate_limits(expires_at);
