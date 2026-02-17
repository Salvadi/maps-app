-- ============================================
-- Create dropdown_options and products tables
-- Run this in Supabase SQL Editor
-- ============================================

-- Dropdown options table (supporto, tipo_supporto, attraversamento)
CREATE TABLE IF NOT EXISTS dropdown_options (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  category text NOT NULL,
  value text NOT NULL,
  label text NOT NULL,
  sort_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dropdown_options_category ON dropdown_options(category);

-- Products table (brand + product name)
CREATE TABLE IF NOT EXISTS products (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  brand text NOT NULL,
  name text NOT NULL,
  sort_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand);

-- RLS policies
ALTER TABLE dropdown_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read dropdown_options"
  ON dropdown_options FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can read products"
  ON products FOR SELECT TO authenticated USING (true);

-- ============================================
-- Populate dropdown_options
-- ============================================

-- Supporto
INSERT INTO dropdown_options (category, value, label, sort_order) VALUES
  ('supporto', 'Parete', 'Parete', 1),
  ('supporto', 'Solaio', 'Solaio', 2);

-- Tipo Supporto
INSERT INTO dropdown_options (category, value, label, sort_order) VALUES
  ('tipo_supporto', 'Cartongesso', 'Cartongesso', 1),
  ('tipo_supporto', 'Cemento', 'Cemento', 2),
  ('tipo_supporto', 'Laterizio intonacato', 'Laterizio intonacato', 3),
  ('tipo_supporto', 'Laterizio NON intonacato', 'Laterizio NON intonacato', 4),
  ('tipo_supporto', 'Legno', 'Legno', 5);

-- Attraversamento
INSERT INTO dropdown_options (category, value, label, sort_order) VALUES
  ('attraversamento', 'Cavi/Corrugati', 'Cavi/Corrugati', 1),
  ('attraversamento', 'Fascio di cavi', 'Fascio di cavi', 2),
  ('attraversamento', 'Canalina passacavi', 'Canalina passacavi', 3),
  ('attraversamento', 'Tubo combustibile', 'Tubo combustibile', 4),
  ('attraversamento', 'Tubo multistrato', 'Tubo multistrato', 5),
  ('attraversamento', 'Tubo metallico NUDO', 'Tubo metallico NUDO', 6),
  ('attraversamento', 'Tubo metallico ISOLATO Armaflex', 'Tubo metallico ISOLATO Armaflex', 7),
  ('attraversamento', 'Tubo metallico ISOLATO lana', 'Tubo metallico ISOLATO lana', 8),
  ('attraversamento', 'Tubo RAME isolato Armaflex', 'Tubo RAME isolato Armaflex', 9),
  ('attraversamento', 'Tubo RAME nudo', 'Tubo RAME nudo', 10),
  ('attraversamento', 'Tubo areazione in lamiera', 'Tubo areazione in lamiera', 11),
  ('attraversamento', 'Tubo areazione spiralato', 'Tubo areazione spiralato', 12),
  ('attraversamento', 'Serranda', 'Serranda', 13),
  ('attraversamento', 'Serranda fuori asse', 'Serranda fuori asse', 14),
  ('attraversamento', 'Canala areazione', 'Canala areazione', 15),
  ('attraversamento', 'Asola', 'Asola', 16),
  ('attraversamento', 'Scatola di derivazione', 'Scatola di derivazione', 17),
  ('attraversamento', 'Fori Cassero', 'Fori Cassero', 18),
  ('attraversamento', 'Altro', 'Altro', 19);

-- ============================================
-- Populate products
-- ============================================

-- Promat
INSERT INTO products (brand, name, sort_order) VALUES
  ('Promat', 'Promat PROMASEAL-A', 1),
  ('Promat', 'Promat PROMASEAL-AG', 2),
  ('Promat', 'Promat PROMASTOP-CC', 3),
  ('Promat', 'Promat PROMASTOP-W', 4),
  ('Promat', 'Promat LANA DI ROCCIA', 5),
  ('Promat', 'Promat PROMASTOP-FC MD', 6),
  ('Promat', 'Promat PROMASEAL-A Spray', 7),
  ('Promat', 'Promat PROMASTOP-FB', 8),
  ('Promat', 'Promat PROMATECT-L500', 9);

-- AF Systems
INSERT INTO products (brand, name, sort_order) VALUES
  ('AF Systems', 'AF Seal W', 1),
  ('AF Systems', 'AF Panel', 2),
  ('AF Systems', 'AF Pipeguard', 3),
  ('AF Systems', 'AF Sleeves', 4),
  ('AF Systems', 'AF Sleeve B3', 5),
  ('AF Systems', 'AF Brick', 6),
  ('AF Systems', 'AF Multicollar', 7),
  ('AF Systems', 'AF Collar', 8),
  ('AF Systems', 'AF Collar C', 9),
  ('AF Systems', 'AF Fireguard 3', 10),
  ('AF Systems', 'AF Safeguard', 11),
  ('AF Systems', 'AF Bags', 12),
  ('AF Systems', 'AF Junction Box', 13);

-- Global Building
INSERT INTO products (brand, name, sort_order) VALUES
  ('Global Building', 'Global Building FireSeal', 1),
  ('Global Building', 'Global Building FireStop', 2),
  ('Global Building', 'Global Building FireProtect', 3);

-- Hilti
INSERT INTO products (brand, name, sort_order) VALUES
  ('Hilti', 'Hilti CFS-IS', 1);
