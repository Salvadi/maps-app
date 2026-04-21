-- Aggiunge colonna ei_rating alla tabella floor_plan_points
-- Valori ammessi: 30, 60, 90, 120, 180, 240 (minuti di resistenza al fuoco EI)
ALTER TABLE floor_plan_points
ADD COLUMN IF NOT EXISTS ei_rating smallint DEFAULT NULL;
