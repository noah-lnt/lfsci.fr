-- Invariant tests for docs/schema/lfsci.sql. Load the schema into an empty database, then run this file
-- with psql; expected outcomes are stated in each \echo line. Uses fixed UUIDs, never run it on real data.
\set ON_ERROR_STOP off
\pset format unaligned
\pset tuples_only on
select 'tables='||count(*) from pg_tables where schemaname='public';
select 'indexes='||count(*) from pg_indexes where schemaname='public';
select 'policies='||count(*) from pg_policies;
select 'tenant_tables_missing_rls='||count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attname='organization_id' and not a.attisdropped where n.nspname='public' and c.relkind='r' and not (c.relrowsecurity and c.relforcerowsecurity);
select 'extensions='||string_agg(extname, ',' order by extname) from pg_extension;
insert into organization (id, code, name) values ('00000000-0000-0000-0000-00000000000a','A','Org A'), ('00000000-0000-0000-0000-00000000000b','B','Org B');
insert into legal_entity (id, organization_id, name) values ('10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000a','SCI A');
insert into building (id, organization_id, legal_entity_id, code, name, address_line1) values ('20000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000a','10000000-0000-0000-0000-00000000000a','A1','Building A','1 rue Test');
\echo TEST1 cross-tenant object_ref, expect ERROR foreign key
insert into object_ref (organization_id, kind, building_id) values ('00000000-0000-0000-0000-00000000000b','building','20000000-0000-0000-0000-00000000000a');
\echo TEST1b same-tenant object_ref, expect INSERT 0 1
insert into object_ref (organization_id, kind, building_id) values ('00000000-0000-0000-0000-00000000000a','building','20000000-0000-0000-0000-00000000000a');
insert into expense (id, organization_id, legal_entity_id, document_kind, total_incl_tax) values ('30000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000a','10000000-0000-0000-0000-00000000000a','receipt',100.00);
insert into expense_line (id, organization_id, expense_id, line_number, description, amount_incl_tax) values ('40000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000a','30000000-0000-0000-0000-00000000000a',1,'Materials',100.00);
\echo TEST2 unbalanced allocation, expect ERROR at COMMIT
begin;
insert into expense_allocation (organization_id, expense_line_id, target, building_id, amount) values ('00000000-0000-0000-0000-00000000000a','40000000-0000-0000-0000-00000000000a','building_common','20000000-0000-0000-0000-00000000000a',60.00);
commit;
\echo TEST2b balanced allocation, expect COMMIT
begin;
insert into expense_allocation (organization_id, expense_line_id, target, building_id, amount) values ('00000000-0000-0000-0000-00000000000a','40000000-0000-0000-0000-00000000000a','building_common','20000000-0000-0000-0000-00000000000a',60.00);
insert into expense_allocation (organization_id, expense_line_id, target, building_id, amount) values ('00000000-0000-0000-0000-00000000000a','40000000-0000-0000-0000-00000000000a','building_common','20000000-0000-0000-0000-00000000000a',40.00);
commit;
select 'allocations_after='||count(*) from expense_allocation;
\echo TEST3 RLS as lfsci_app, expect 0 / 1 / 0
set role lfsci_app;
select 'no_setting_rows='||count(*) from building;
begin; set local app.organization_id = '00000000-0000-0000-0000-00000000000a'; select 'org_a_rows='||count(*) from building; commit;
begin; set local app.organization_id = '00000000-0000-0000-0000-00000000000b'; select 'org_b_rows='||count(*) from building; commit;
reset role;
