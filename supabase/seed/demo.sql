-- SEED DÉMO v2 — « SOUFFLET décoration (démo) », Carouge GE. Éditeur WallScan : NLPGenerator.
-- Éditeurs et dimensions réels ; PRIX INDICATIFS relevés publiquement (CHF, revendeurs suisses) — remplacés par le flux XML.
-- Tarifs de pose SIMULÉS calibrés marché genevois. Ne jamais utiliser en production.
insert into organizations (id, name, country, locale_default, crm_provider, quote_settings) values (
  '00000000-0000-0000-0000-000000000001', 'SOUFFLET décoration (démo)', 'CH', 'fr', 'internal',
  '{"legalForm":"entreprise individuelle","city":"Carouge GE","cutMarginTopCm":5,"cutMarginBottomCm":5,
    "openingsRule":{"kind":"subtract_above_m2","thresholdM2":2},"roundTotalToFiveCents":true,"defaultValidityDays":30,
    "organizationInstalls":true,"safetyRollIfPattern":true,"travelFlatFeeCents":0,"travelOutsideCantonCents":8000,
    "laborMinimumM2":8,"discountMaxPct":15,"discountAppliesTo":["wallpaper"],"vatRegistered":"À CONFIRMER (seuil CHF 100 000)"}'::jsonb
);
insert into suppliers (id, org_id, name, lead_time_days) values
  ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-000000000001', 'Casamance', 14),
  ('00000000-0000-0000-0000-00000000a002', '00000000-0000-0000-0000-000000000001', 'Élitis', 14),
  ('00000000-0000-0000-0000-00000000a003', '00000000-0000-0000-0000-000000000001', 'Les Dominotiers', 21);
insert into collections (id, org_id, supplier_id, name, year) values
  ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a001', 'Casamance — unis & rayures', 2026),
  ('00000000-0000-0000-0000-00000000c002', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a001', 'Casamance — motifs', 2026),
  ('00000000-0000-0000-0000-00000000c003', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a002', 'Élitis — matières', 2026),
  ('00000000-0000-0000-0000-00000000c004', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a003', 'Les Dominotiers — panoramiques', 2026);
-- unité de vente : roll (rouleau) ou m2 (panoramique sur mesure, lés de 70 cm)
alter table wallpapers add column if not exists sale_unit text not null default 'roll' check (sale_unit in ('roll','m2'));
insert into wallpapers (org_id, collection_id, sku, name, color_name, roll_width_cm, roll_length_cm, pattern_repeat_cm, match_type, offset_cm, material, fire_class, sale_unit, tags)
select '00000000-0000-0000-0000-000000000001', c, sku, n, col, w, l, r, mt, off, mat, fire, su, string_to_array(tg, ',') from (values
  ('00000000-0000-0000-0000-00000000c001'::uuid,'CAS-LINA','Lina','lin naturel',70,1005,0,'free',0,'vinyle sur intissé 330 g/m²','B s2 d0','roll','uni,texturé'),
  ('00000000-0000-0000-0000-00000000c001','CAS-ARGILE','Argile','terre cuite',70,1005,0,'free',0,'intissé effet chaux','B s2 d0','roll','uni'),
  ('00000000-0000-0000-0000-00000000c001','CAS-OCCITAN','Occitan','sable',70,1005,0,'free',0,'intissé 135 g/m² effet soie sauvage','B s1 d0','roll','uni'),
  ('00000000-0000-0000-0000-00000000c001','CAS-BEAUSOLEIL','Beausoleil','rayure ocre',70,1005,0,'free',0,'vinyle effet lin 330 g/m²','B s2 d0','roll','rayure'),
  ('00000000-0000-0000-0000-00000000c002','CAS-DESIRADE','Désirade','vert',70,1005,64,'half_drop',32,'vinyle sur intissé 330 g/m²','B s2 d0','roll','végétal,raccord'),
  ('00000000-0000-0000-0000-00000000c002','CAS-LEGENDES','Légendes','bleu',70,1005,70,'straight',0,'intissé gaufré 400 g/m²','B s2 d0','roll','botanique,raccord'),
  ('00000000-0000-0000-0000-00000000c002','CAS-MADHUCA','Madhuca','jungle',70,1005,70,'straight',0,'intissé peint main','B s2 d0','roll','végétal,raccord'),
  ('00000000-0000-0000-0000-00000000c002','CAS-ANNEES30','Années 30','or',70,1005,53,'straight',0,'intissé laque métallisée','B s2 d0','roll','art déco,raccord'),
  ('00000000-0000-0000-0000-00000000c003','ELI-KARI','Kari','ivoire',100,1000,0,'free',0,'intissé tissé','B s1 d0','roll','uni,texturé'),
  ('00000000-0000-0000-0000-00000000c003','ELI-YUZEN','Yuzen','indigo',100,1000,0,'free',0,'intissé effet papier japonais','B s1 d0','roll','uni'),
  ('00000000-0000-0000-0000-00000000c003','ELI-MOKO','Moko','anthracite',100,1000,0,'free',0,'vinyle effet cuir','B s1 d0','roll','uni,relief'),
  ('00000000-0000-0000-0000-00000000c003','ELI-CASAPAJA','La Casa de Paja','paille',70,1000,0,'free',0,'fibres naturelles tissées','B s1 d0','roll','naturel'),
  ('00000000-0000-0000-0000-00000000c004','DOM-MISTY','Misty Forest','brume',70,0,0,'free',0,'intissé 195 g/m², FSC, France','C s1 d0','m2','panoramique,paysage'),
  ('00000000-0000-0000-0000-00000000c004','DOM-COLLINES','Cent Collines','aube',70,0,0,'free',0,'intissé 195 g/m², FSC, France','C s1 d0','m2','panoramique,paysage'),
  ('00000000-0000-0000-0000-00000000c004','DOM-PINS','Entre les Pins','turquoise',70,0,0,'free',0,'intissé 195 g/m², FSC, France','C s1 d0','m2','panoramique,paysage')
) as v(c, sku, n, col, w, l, r, mt, off, mat, fire, su, tg);

insert into price_lists (id, org_id, name, currency, valid_from, is_default) values
  ('00000000-0000-0000-0000-00000000p001', '00000000-0000-0000-0000-000000000001', 'Tarif indicatif 2026 (avant XML)', 'CHF', '2026-01-01', true);
-- prix de vente indicatifs (centimes) : par rouleau, ou par m² pour les panoramiques ; achat = indicatif coefficient ≈ 1/1.9
insert into wallpaper_prices (price_list_id, wallpaper_id, purchase_price, sale_price_per_roll, min_order_rolls, stock_status)
select '00000000-0000-0000-0000-00000000p001', w.id, p.pp, p.sp, p.mo, 'sur commande'
from wallpapers w join (values
  ('CAS-LINA',8400,15900,1),('CAS-ARGILE',8400,15900,1),('CAS-OCCITAN',7900,14900,1),('CAS-BEAUSOLEIL',8900,16900,1),
  ('CAS-DESIRADE',9400,17900,1),('CAS-LEGENDES',10500,19900,1),('CAS-MADHUCA',8900,16900,1),('CAS-ANNEES30',8900,16900,1),
  ('ELI-KARI',10900,20800,1),('ELI-YUZEN',9900,18900,1),('ELI-MOKO',14200,27000,1),('ELI-CASAPAJA',19300,36700,1),
  ('DOM-MISTY',4100,7800,1),('DOM-COLLINES',4100,7800,1),('DOM-PINS',4100,7800,1)
) as p(sku, pp, sp, mo) on p.sku = w.sku;

insert into labor_rates (org_id, type, unit, price, valid_from) values
  ('00000000-0000-0000-0000-000000000001', 'pose_standard', 'm2', 5500, '2026-01-01'),
  ('00000000-0000-0000-0000-000000000001', 'pose_raccord',  'm2', 7000, '2026-01-01'),
  ('00000000-0000-0000-0000-000000000001', 'preparation',   'm2', 1800, '2026-01-01'),
  ('00000000-0000-0000-0000-000000000001', 'depose',        'm2', 1400, '2026-01-01');
-- pose panoramique : type dédié ajouté par migration 0002 (Phase 1) ; en attendant stocké dans quote_settings.laborPanoramicM2Cents = 9500
insert into consumables (org_id, name, unit, price, coverage_m2_per_unit) values
  ('00000000-0000-0000-0000-000000000001', 'Colle intissé (Quelyd ou équiv.) 1 kg', 'pot', 2400, 25),
  ('00000000-0000-0000-0000-000000000001', 'Apprêt / primaire 2,5 l', 'bidon', 3900, 30);
insert into discount_rules (org_id, type, max_value, requires_role, description) values
  ('00000000-0000-0000-0000-000000000001', 'pct', 15, 'admin', 'Remise marchandise décidée par le dirigeant ; au-delà, motif obligatoire');
