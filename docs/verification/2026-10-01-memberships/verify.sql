begin;
set local role anon;
select jsonb_build_object('states', (select jsonb_agg(jsonb_build_object('state',s,'memberships',fuel_memberships_for_state(s))) from unnest(array['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY']) s), 'raw_table_access', has_table_privilege('anon','public.fuel_station_latest','select'), 'invalid_state', fuel_memberships_for_state('ZZ')) result;
rollback;
