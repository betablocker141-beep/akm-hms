-- ═══════════════════════════════════════════════════════════════════════════
-- ALIM KHATOON MEDICARE HMS — Supabase PostgreSQL Schema
-- Run this in your Supabase SQL editor (Settings → SQL Editor → New Query)
-- ═══════════════════════════════════════════════════════════════════════════

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- ─── PATIENTS ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS patients (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mrn            TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  dob            DATE,
  gender         TEXT NOT NULL CHECK (gender IN ('Male','Female','Other')),
  phone          TEXT NOT NULL,
  address        TEXT,
  blood_group    TEXT CHECK (blood_group IN ('A+','A-','B+','B-','AB+','AB-','O+','O-','Unknown')),
  guardian_name  TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
-- Run this if adding to an existing database:
-- ALTER TABLE patients ADD COLUMN IF NOT EXISTS guardian_name TEXT;
CREATE INDEX IF NOT EXISTS idx_patients_phone ON patients(phone);
CREATE INDEX IF NOT EXISTS idx_patients_mrn   ON patients(mrn);
CREATE INDEX IF NOT EXISTS idx_patients_name  ON patients USING gin(to_tsvector('english', name));


-- ─── DOCTORS ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS doctors (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name             TEXT NOT NULL,
  specialty        TEXT NOT NULL,
  phone            TEXT NOT NULL,
  whatsapp_number  TEXT,
  share_percent    NUMERIC(5,2) NOT NULL DEFAULT 40,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS idx_doctors_active ON doctors(is_active);


-- ─── USERS ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT NOT NULL UNIQUE,
  role       TEXT NOT NULL CHECK (role IN ('admin','receptionist','doctor','radiologist','accountant')),
  doctor_id  UUID REFERENCES doctors(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ─── OPD TOKENS ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS opd_tokens (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token_number   TEXT NOT NULL,
  patient_id     UUID NOT NULL REFERENCES patients(id),
  doctor_id      UUID NOT NULL REFERENCES doctors(id),
  date           DATE NOT NULL,
  time_slot      TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending','confirmed','seen','cancelled')),
  type           TEXT NOT NULL DEFAULT 'walk_in' CHECK (type IN ('walk_in','online','whatsapp')),
  booking_source TEXT,
  notes          TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_opd_date       ON opd_tokens(date);
CREATE INDEX IF NOT EXISTS idx_opd_patient    ON opd_tokens(patient_id);
CREATE INDEX IF NOT EXISTS idx_opd_doctor     ON opd_tokens(doctor_id);
CREATE INDEX IF NOT EXISTS idx_opd_status     ON opd_tokens(status);


-- ─── ER VISITS ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS er_visits (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id       UUID NOT NULL REFERENCES patients(id),
  token_number     TEXT NOT NULL,
  visit_date       DATE NOT NULL,
  chief_complaint  TEXT NOT NULL,
  triage_level     SMALLINT NOT NULL CHECK (triage_level BETWEEN 1 AND 5),
  bp               TEXT,
  pulse            SMALLINT,
  temp             NUMERIC(4,1),
  spo2             SMALLINT,
  rr               SMALLINT,
  doctor_id        UUID REFERENCES doctors(id),
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','treated','admitted','discharged','deceased')),
  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_er_date    ON er_visits(visit_date);
CREATE INDEX IF NOT EXISTS idx_er_patient ON er_visits(patient_id);


-- ─── IPD ADMISSIONS ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ipd_admissions (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id           UUID NOT NULL REFERENCES patients(id),
  admit_date           DATE NOT NULL,
  discharge_date       DATE,
  ward                 TEXT NOT NULL,
  bed_number           TEXT NOT NULL,
  admitting_doctor_id  UUID NOT NULL REFERENCES doctors(id),
  diagnosis            TEXT,
  status               TEXT NOT NULL DEFAULT 'admitted' CHECK (status IN ('admitted','discharged')),
  created_at           TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ipd_patient ON ipd_admissions(patient_id);
CREATE INDEX IF NOT EXISTS idx_ipd_status  ON ipd_admissions(status);


-- ─── IPD PROCEDURES ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ipd_procedures (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admission_id    UUID NOT NULL REFERENCES ipd_admissions(id) ON DELETE CASCADE,
  procedure_name  TEXT NOT NULL,
  procedure_date  DATE NOT NULL,
  doctor_id       UUID NOT NULL REFERENCES doctors(id),
  fee             NUMERIC(10,2) NOT NULL DEFAULT 0,
  notes           TEXT
);
CREATE INDEX IF NOT EXISTS idx_proc_admission ON ipd_procedures(admission_id);


-- ─── ULTRASOUND REPORTS ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ultrasound_reports (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id        UUID NOT NULL REFERENCES patients(id),
  study_type        TEXT NOT NULL,
  study_date        DATE NOT NULL,
  referring_doctor  TEXT,
  radiologist_id    UUID REFERENCES doctors(id),
  findings          TEXT NOT NULL DEFAULT '',
  impression        TEXT NOT NULL DEFAULT '',
  recommendations   TEXT,
  images_urls       TEXT[] DEFAULT '{}',
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','final')),
  obstetric_data         JSONB,
  history                TEXT,
  presenting_complaints  TEXT,
  prescription           TEXT,
  husbands_father_name   TEXT,
  created_at             TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_us_patient ON ultrasound_reports(patient_id);
CREATE INDEX IF NOT EXISTS idx_us_date    ON ultrasound_reports(study_date);
CREATE INDEX IF NOT EXISTS idx_us_status  ON ultrasound_reports(status);


-- ─── INVOICES ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id      UUID NOT NULL REFERENCES patients(id),
  visit_type      TEXT NOT NULL CHECK (visit_type IN ('opd','er','ipd','us')),
  visit_ref_id    UUID,
  items           JSONB NOT NULL DEFAULT '[]',
  subtotal        NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount        NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_type   TEXT NOT NULL DEFAULT 'amount' CHECK (discount_type IN ('amount','percent')),
  tax             NUMERIC(12,2) NOT NULL DEFAULT 0,
  total           NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid_amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_method  TEXT CHECK (payment_method IN ('cash','card','bank_transfer','jazzcash','easypaisa')),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','partial','paid')),
  doctor_id       UUID REFERENCES doctors(id),
  invoice_number  TEXT NOT NULL UNIQUE,
  receipt_no      TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  created_by_id   UUID,
  created_by_name TEXT
);
CREATE INDEX IF NOT EXISTS idx_inv_patient ON invoices(patient_id);
CREATE INDEX IF NOT EXISTS idx_inv_status  ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_inv_date    ON invoices(created_at);


-- ─── INVOICE ITEMS ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoice_items (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id  UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity    SMALLINT NOT NULL DEFAULT 1,
  unit_price  NUMERIC(10,2) NOT NULL,
  total       NUMERIC(10,2) NOT NULL
);


-- ─── BIRTH CERTIFICATES ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS birth_certificates (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  serial_number  TEXT NOT NULL UNIQUE,
  patient_id     UUID REFERENCES patients(id),
  baby_name      TEXT NOT NULL,
  dob            DATE NOT NULL,
  time_of_birth  TIME NOT NULL,
  gender         TEXT NOT NULL CHECK (gender IN ('Male','Female')),
  weight_kg      NUMERIC(4,2),
  mother_name    TEXT NOT NULL,
  mother_cnic    TEXT,
  father_name    TEXT NOT NULL,
  father_cnic    TEXT,
  doctor_id      UUID NOT NULL REFERENCES doctors(id),
  ward           TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);


-- ─── DEATH CERTIFICATES ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS death_certificates (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  serial_number               TEXT NOT NULL UNIQUE,
  patient_id                  UUID REFERENCES patients(id),
  patient_name                TEXT NOT NULL,
  patient_cnic                TEXT,
  dod                         DATE NOT NULL,
  time_of_death               TIME NOT NULL,
  cause_of_death_primary      TEXT NOT NULL,
  cause_of_death_contributing TEXT,
  doctor_id                   UUID NOT NULL REFERENCES doctors(id),
  created_at                  TIMESTAMPTZ DEFAULT NOW()
);


-- ─── DOCTOR EARNINGS ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS doctor_earnings (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  doctor_id        UUID NOT NULL REFERENCES doctors(id),
  month            SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
  year             SMALLINT NOT NULL,
  total_opd        NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_er         NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_ipd        NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_procedures NUMERIC(12,2) NOT NULL DEFAULT 0,
  gross_earnings   NUMERIC(12,2) NOT NULL DEFAULT 0,
  share_amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid             BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (doctor_id, month, year)
);


-- ─── ONLINE BOOKINGS ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS online_bookings (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_name         TEXT NOT NULL,
  phone                TEXT NOT NULL,
  doctor_id            UUID REFERENCES doctors(id),
  department           TEXT NOT NULL CHECK (department IN ('opd','ultrasound')),
  preferred_date       DATE NOT NULL,
  preferred_time_slot  TEXT NOT NULL,
  chief_complaint      TEXT,
  is_new_patient       BOOLEAN NOT NULL DEFAULT FALSE,
  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected')),
  rejection_reason     TEXT,
  token_id             UUID REFERENCES opd_tokens(id),
  created_at           TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON online_bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_date   ON online_bookings(preferred_date);


-- ─── NOTIFICATIONS LOG ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications_log (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id UUID REFERENCES patients(id),
  channel    TEXT NOT NULL CHECK (channel IN ('whatsapp','sms')),
  message    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','failed','pending')),
  sent_at    TIMESTAMPTZ DEFAULT NOW()
);


-- ═══════════════════════════════════════════════════════════════════════════
-- HELPER FUNCTIONS
-- ═══════════════════════════════════════════════════════════════════════════

-- Auto-increment OPD token per day: OPD-001, OPD-002 ...
CREATE OR REPLACE FUNCTION get_next_opd_token(token_date DATE)
RETURNS TEXT AS $$
DECLARE
  next_num INTEGER;
BEGIN
  SELECT COUNT(*) + 1 INTO next_num
  FROM opd_tokens
  WHERE date = token_date;
  RETURN 'OPD-' || LPAD(next_num::TEXT, 3, '0');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Auto-increment ER token per day: ER-001, ER-002 ...
CREATE OR REPLACE FUNCTION get_next_er_token(token_date DATE)
RETURNS TEXT AS $$
DECLARE
  next_num INTEGER;
BEGIN
  SELECT COUNT(*) + 1 INTO next_num
  FROM er_visits
  WHERE visit_date = token_date;
  RETURN 'ER-' || LPAD(next_num::TEXT, 3, '0');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Invoice number: INV-YYYY-NNNN
CREATE OR REPLACE FUNCTION get_next_invoice_number()
RETURNS TEXT AS $$
DECLARE
  next_num INTEGER;
  yr TEXT;
BEGIN
  yr := TO_CHAR(NOW(), 'YYYY');
  SELECT COUNT(*) + 1 INTO next_num
  FROM invoices
  WHERE invoice_number LIKE 'INV-' || yr || '-%';
  RETURN 'INV-' || yr || '-' || LPAD(next_num::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ═══════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════════════════════

-- Enable RLS on all tables
ALTER TABLE patients             ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctors              ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE opd_tokens           ENABLE ROW LEVEL SECURITY;
ALTER TABLE er_visits            ENABLE ROW LEVEL SECURITY;
ALTER TABLE ipd_admissions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE ipd_procedures       ENABLE ROW LEVEL SECURITY;
ALTER TABLE ultrasound_reports   ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices             ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE birth_certificates   ENABLE ROW LEVEL SECURITY;
ALTER TABLE death_certificates   ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_earnings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE online_bookings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications_log    ENABLE ROW LEVEL SECURITY;

-- Helper: get current user's role
CREATE OR REPLACE FUNCTION current_user_role()
RETURNS TEXT AS $$
  SELECT role FROM users WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ─── PATIENTS: authenticated users can read; admin/receptionist/doctor can write
CREATE POLICY "patients_select" ON patients FOR SELECT
  TO authenticated USING (TRUE);

CREATE POLICY "patients_insert" ON patients FOR INSERT
  TO authenticated
  WITH CHECK (current_user_role() IN ('admin','receptionist','doctor'));

CREATE POLICY "patients_update" ON patients FOR UPDATE
  TO authenticated
  USING (current_user_role() IN ('admin','receptionist','doctor'));

-- ─── DOCTORS: all authenticated can read; admin manages
CREATE POLICY "doctors_select" ON doctors FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "doctors_write"  ON doctors FOR ALL    TO authenticated
  USING (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');

-- ─── USERS: admin full access; users can read own record
CREATE POLICY "users_own"   ON users FOR SELECT TO authenticated USING (id = auth.uid() OR current_user_role() = 'admin');
CREATE POLICY "users_admin" ON users FOR ALL    TO authenticated USING (current_user_role() = 'admin') WITH CHECK (current_user_role() = 'admin');

-- ─── OPD TOKENS: receptionist/admin/doctor read+write
CREATE POLICY "opd_select" ON opd_tokens FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "opd_write"  ON opd_tokens FOR ALL    TO authenticated
  USING (current_user_role() IN ('admin','receptionist','doctor'))
  WITH CHECK (current_user_role() IN ('admin','receptionist','doctor'));

-- ─── ER VISITS
CREATE POLICY "er_select" ON er_visits FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "er_write"  ON er_visits FOR ALL    TO authenticated
  USING (current_user_role() IN ('admin','receptionist','doctor'))
  WITH CHECK (current_user_role() IN ('admin','receptionist','doctor'));

-- ─── IPD
CREATE POLICY "ipd_adm_select" ON ipd_admissions FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "ipd_adm_write"  ON ipd_admissions FOR ALL    TO authenticated
  USING (current_user_role() IN ('admin','receptionist','doctor'))
  WITH CHECK (current_user_role() IN ('admin','receptionist','doctor'));

CREATE POLICY "ipd_proc_select" ON ipd_procedures FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "ipd_proc_write"  ON ipd_procedures FOR ALL    TO authenticated
  USING (current_user_role() IN ('admin','receptionist','doctor'))
  WITH CHECK (current_user_role() IN ('admin','receptionist','doctor'));

-- ─── ULTRASOUND
CREATE POLICY "us_select" ON ultrasound_reports FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "us_insert" ON ultrasound_reports FOR INSERT TO authenticated
  WITH CHECK (current_user_role() IN ('admin','radiologist','receptionist','doctor'));
CREATE POLICY "us_update" ON ultrasound_reports FOR UPDATE TO authenticated
  USING (current_user_role() IN ('admin','radiologist','receptionist','doctor'));
CREATE POLICY "us_delete" ON ultrasound_reports FOR DELETE TO authenticated
  USING (current_user_role() IN ('admin','radiologist','receptionist','doctor'));

-- ─── INVOICES
CREATE POLICY "inv_select" ON invoices FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "inv_write"  ON invoices FOR ALL    TO authenticated
  USING (current_user_role() IN ('admin','receptionist','accountant'))
  WITH CHECK (current_user_role() IN ('admin','receptionist','accountant'));

CREATE POLICY "inv_items_select" ON invoice_items FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "inv_items_write"  ON invoice_items FOR ALL    TO authenticated
  USING (current_user_role() IN ('admin','receptionist','accountant'))
  WITH CHECK (current_user_role() IN ('admin','receptionist','accountant'));

-- ─── CERTIFICATES
CREATE POLICY "birth_select" ON birth_certificates FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "birth_write"  ON birth_certificates FOR ALL    TO authenticated
  USING (current_user_role() IN ('admin','receptionist','doctor'))
  WITH CHECK (current_user_role() IN ('admin','receptionist','doctor'));

CREATE POLICY "death_select" ON death_certificates FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "death_write"  ON death_certificates FOR ALL    TO authenticated
  USING (current_user_role() IN ('admin','receptionist','doctor'))
  WITH CHECK (current_user_role() IN ('admin','receptionist','doctor'));

-- ─── DOCTOR EARNINGS
CREATE POLICY "earn_select" ON doctor_earnings FOR SELECT TO authenticated USING (
  current_user_role() IN ('admin','accountant') OR
  (current_user_role() = 'doctor' AND doctor_id = (SELECT doctor_id FROM users WHERE id = auth.uid()))
);
CREATE POLICY "earn_write" ON doctor_earnings FOR ALL TO authenticated
  USING (current_user_role() IN ('admin','accountant'))
  WITH CHECK (current_user_role() IN ('admin','accountant'));

-- ─── ONLINE BOOKINGS: public insert allowed, authenticated can read/update
CREATE POLICY "bookings_public_insert" ON online_bookings FOR INSERT TO anon WITH CHECK (TRUE);
CREATE POLICY "bookings_auth_insert"   ON online_bookings FOR INSERT TO authenticated WITH CHECK (TRUE);
CREATE POLICY "bookings_select"        ON online_bookings FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "bookings_update"        ON online_bookings FOR UPDATE TO authenticated
  USING (current_user_role() IN ('admin','receptionist'))
  WITH CHECK (current_user_role() IN ('admin','receptionist'));

-- ─── NOTIFICATIONS LOG
CREATE POLICY "notif_select" ON notifications_log FOR SELECT TO authenticated USING (current_user_role() IN ('admin','receptionist'));
CREATE POLICY "notif_insert" ON notifications_log FOR INSERT TO authenticated WITH CHECK (TRUE);


-- ─── HR EMPLOYEES ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr_employees (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name               TEXT NOT NULL,
  cnic               TEXT,
  phone              TEXT NOT NULL,
  designation        TEXT NOT NULL,
  department         TEXT NOT NULL,
  join_date          DATE NOT NULL,
  salary             NUMERIC(10,2) NOT NULL DEFAULT 0,
  address            TEXT,
  emergency_contact  TEXT,
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hr_dept   ON hr_employees(department);
CREATE INDEX IF NOT EXISTS idx_hr_status ON hr_employees(status);

ALTER TABLE hr_employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hr_admin_all"   ON hr_employees FOR ALL  TO authenticated USING (current_user_role() = 'admin') WITH CHECK (current_user_role() = 'admin');
CREATE POLICY "hr_select_auth" ON hr_employees FOR SELECT TO authenticated USING (current_user_role() IN ('admin'));


-- ═══════════════════════════════════════════════════════════════════════════
-- SAMPLE DATA (optional — comment out in production)
-- ═══════════════════════════════════════════════════════════════════════════

/*
-- Insert sample doctors
INSERT INTO doctors (name, specialty, phone, whatsapp_number, share_percent) VALUES
  ('Dr. Amjad Ali',      'General Medicine',    '03001234567', '923001234567', 40),
  ('Dr. Fatima Malik',   'Gynecology & OB',     '03009876543', '923009876543', 45),
  ('Dr. Tariq Hussain',  'Pediatrics',          '03335551234', '923335551234', 40),
  ('Dr. Sana Baig',      'Radiology / US',      '03456789012', '923456789012', 50);
*/

-- ═══════════════════════════════════════════════════════════════════════════
-- DONE
-- ═══════════════════════════════════════════════════════════════════════════
