-- Rollback 0001_init (ordre inverse des dépendances)
drop view if exists wallpaper_prices_public;
drop table if exists quote_lines, quotes, quote_counters, renders, photos, walls, rooms, projects, customers,
  discount_rules, tax_rates, consumables, labor_rates, wallpaper_prices, price_lists, wallpapers, collections,
  suppliers, audit_log, users, organizations cascade;
drop function if exists next_quote_number(uuid), quotes_immutable(), quote_lines_immutable(), current_org_id(), current_role_name();
