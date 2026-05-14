-- sprint3-triggers.sql
-- Fix H3: trigger change_log per le tabelle mancanti
-- Eseguire manualmente sul DB opimappa prima del deploy Sprint 3
-- Tabelle coperte: floor_plans, sals, typology_prices, dropdown_options, products

-- ============================================================
-- Rimuovi trigger esistenti (idempotente)
-- ============================================================
DROP TRIGGER IF EXISTS floor_plans_changelog ON floor_plans;
DROP TRIGGER IF EXISTS sals_changelog ON sals;
DROP TRIGGER IF EXISTS typology_prices_changelog ON typology_prices;
DROP TRIGGER IF EXISTS dropdown_options_changelog ON dropdown_options;
DROP TRIGGER IF EXISTS products_changelog ON products;

-- ============================================================
-- floor_plans: project_id diretto
-- ============================================================
CREATE OR REPLACE FUNCTION log_change_floor_plans() RETURNS trigger AS $$
DECLARE originator text; new_seq bigint;
BEGIN
  BEGIN originator := current_setting('opimappa.originator_session', true); EXCEPTION WHEN OTHERS THEN originator := NULL; END;
  INSERT INTO change_log (table_name, row_id, op, project_id, originator)
  VALUES ('floor_plans', COALESCE(NEW.id, OLD.id)::text, TG_OP, COALESCE(NEW.project_id, OLD.project_id), originator)
  RETURNING seq INTO new_seq;
  PERFORM pg_notify('opimappa_changes', new_seq::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER floor_plans_changelog
  AFTER INSERT OR UPDATE OR DELETE ON floor_plans
  FOR EACH ROW EXECUTE FUNCTION log_change_floor_plans();

-- ============================================================
-- sals: project_id diretto
-- ============================================================
CREATE OR REPLACE FUNCTION log_change_sals() RETURNS trigger AS $$
DECLARE originator text; new_seq bigint;
BEGIN
  BEGIN originator := current_setting('opimappa.originator_session', true); EXCEPTION WHEN OTHERS THEN originator := NULL; END;
  INSERT INTO change_log (table_name, row_id, op, project_id, originator)
  VALUES ('sals', COALESCE(NEW.id, OLD.id)::text, TG_OP, COALESCE(NEW.project_id, OLD.project_id), originator)
  RETURNING seq INTO new_seq;
  PERFORM pg_notify('opimappa_changes', new_seq::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sals_changelog
  AFTER INSERT OR UPDATE OR DELETE ON sals
  FOR EACH ROW EXECUTE FUNCTION log_change_sals();

-- ============================================================
-- typology_prices: project_id diretto
-- ============================================================
CREATE OR REPLACE FUNCTION log_change_typology_prices() RETURNS trigger AS $$
DECLARE originator text; new_seq bigint;
BEGIN
  BEGIN originator := current_setting('opimappa.originator_session', true); EXCEPTION WHEN OTHERS THEN originator := NULL; END;
  INSERT INTO change_log (table_name, row_id, op, project_id, originator)
  VALUES ('typology_prices', COALESCE(NEW.id, OLD.id)::text, TG_OP, COALESCE(NEW.project_id, OLD.project_id), originator)
  RETURNING seq INTO new_seq;
  PERFORM pg_notify('opimappa_changes', new_seq::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER typology_prices_changelog
  AFTER INSERT OR UPDATE OR DELETE ON typology_prices
  FOR EACH ROW EXECUTE FUNCTION log_change_typology_prices();

-- ============================================================
-- dropdown_options e products: globali (project_id=NULL)
-- canSee ritorna true a tutti per queste tabelle
-- ============================================================
CREATE OR REPLACE FUNCTION log_change_global() RETURNS trigger AS $$
DECLARE originator text; new_seq bigint;
BEGIN
  BEGIN originator := current_setting('opimappa.originator_session', true); EXCEPTION WHEN OTHERS THEN originator := NULL; END;
  INSERT INTO change_log (table_name, row_id, op, originator)
  VALUES (TG_TABLE_NAME, COALESCE(NEW.id, OLD.id)::text, TG_OP, originator)
  RETURNING seq INTO new_seq;
  PERFORM pg_notify('opimappa_changes', new_seq::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER dropdown_options_changelog
  AFTER INSERT OR UPDATE OR DELETE ON dropdown_options
  FOR EACH ROW EXECUTE FUNCTION log_change_global();

CREATE TRIGGER products_changelog
  AFTER INSERT OR UPDATE OR DELETE ON products
  FOR EACH ROW EXECUTE FUNCTION log_change_global();
