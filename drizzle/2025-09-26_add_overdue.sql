-- Add last_reminder_at column to defects
ALTER TABLE defects ADD COLUMN IF NOT EXISTS last_reminder_at timestamptz;

-- Index for fast overdue lookups by status and due_date
CREATE INDEX IF NOT EXISTS idx_defects_due_status ON defects (status, due_date);


