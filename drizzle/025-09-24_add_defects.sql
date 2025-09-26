-- Enums
DO $$ BEGIN
  CREATE TYPE defect_category AS ENUM ('architecture','structural','electrical','plumbing','finishing','landscaping');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE defect_severity AS ENUM ('critical','medium','low');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE defect_status AS ENUM ('discovered','on_control','fixed','awaiting_review');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE defect_photo_type AS ENUM ('initial','before','after','generic');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Sequence for human_id: D-000001
DO $$ BEGIN
  CREATE SEQUENCE defects_human_id_seq START WITH 1 INCREMENT BY 1 MINVALUE 1;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Table: defects
CREATE TABLE IF NOT EXISTS defects (
  id                varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  human_id          varchar UNIQUE NOT NULL DEFAULT ('D-' || lpad(nextval('defects_human_id_seq')::text, 6, '0')),
  object            varchar NOT NULL,
  floor             varchar,
  category          defect_category NOT NULL,
  severity          defect_severity NOT NULL,
  description       text,
  status            defect_status NOT NULL DEFAULT 'discovered',
  created_by_user_id varchar NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assignee_user_id   varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamp DEFAULT now(),
  updated_at        timestamp DEFAULT now(),
  closed_at         timestamp
);

-- Indexes for defects
CREATE INDEX IF NOT EXISTS defects_status_idx   ON defects(status);
CREATE INDEX IF NOT EXISTS defects_category_idx ON defects(category);
CREATE INDEX IF NOT EXISTS defects_severity_idx ON defects(severity);
CREATE INDEX IF NOT EXISTS defects_object_idx   ON defects(object);
CREATE INDEX IF NOT EXISTS defects_assignee_idx ON defects(assignee_user_id);
CREATE INDEX IF NOT EXISTS defects_created_at_idx ON defects(created_at);

-- Table: defect_photos
CREATE TABLE IF NOT EXISTS defect_photos (
  id                 varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  defect_id          varchar NOT NULL REFERENCES defects(id) ON DELETE CASCADE,
  type               defect_photo_type NOT NULL,
  telegram_file_id   varchar NOT NULL,
  created_by_user_id varchar NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at         timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS defect_photos_defect_idx ON defect_photos(defect_id);

-- Table: defect_actions (audit)
CREATE TABLE IF NOT EXISTS defect_actions (
  id            varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  defect_id     varchar NOT NULL REFERENCES defects(id) ON DELETE CASCADE,
  actor_user_id varchar NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action        varchar NOT NULL, -- create|update|status_change|assign|add_photo|comment
  payload       jsonb,
  created_at    timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS defect_actions_defect_idx ON defect_actions(defect_id);
