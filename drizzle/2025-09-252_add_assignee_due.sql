ALTER TABLE public.defects
  ADD COLUMN IF NOT EXISTS assigned_to varchar,
  ADD COLUMN IF NOT EXISTS due_date timestamptz;
