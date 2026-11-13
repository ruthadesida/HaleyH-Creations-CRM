-- Books: start from the owner's own chart of accounts (e.g. exported from Zoho) instead of the template.
-- The owner maps their accounts to the roles the app posts to; any role left unmapped gets the template
-- account, with a code that doesn't clash. Codes may now have sub-codes like "1001-1".

alter table public.accounts drop constraint accounts_code_check;
alter table public.accounts add constraint accounts_code_check check (code ~ '^[0-9][0-9A-Za-z-]{0,15}$');

-- The template: one row per account; system_key marks accounts the app posts to automatically.
create or replace function app.chart_template()
returns table (code text, name text, grp text, sk text) language sql immutable set search_path = '' as $$
  select * from (values
    ('1000', 'Cash in hand', 'current_assets', 'cash'),
    ('1010', 'Business bank account', 'current_assets', 'bank_main'),
    ('1050', 'POS and transfer clearing', 'current_assets', 'clearing'),
    ('1100', 'Trade receivables', 'current_assets', 'receivables'),
    ('1150', 'Staff advances', 'current_assets', null),
    ('1160', 'Prepayments', 'current_assets', 'prepayments'),
    ('1170', 'VAT receivable (input VAT)', 'current_assets', 'vat_input'),
    ('1180', 'Due from directors', 'current_assets', 'due_from_directors'),
    ('1190', 'Share capital unpaid', 'current_assets', 'share_capital_unpaid'),
    ('1200', 'Inventory: raw materials', 'current_assets', 'inv_raw'),
    ('1210', 'Inventory: work in progress', 'current_assets', 'inv_wip'),
    ('1220', 'Inventory: finished goods', 'current_assets', 'inv_finished'),
    ('1230', 'Inventory: in quarantine', 'current_assets', 'inv_quarantine'),
    ('1500', 'Plant and machinery', 'non_current_assets', 'ppe_machinery'),
    ('1505', 'Plant and machinery: accumulated depreciation', 'non_current_assets', 'ppe_machinery_dep'),
    ('1510', 'Furniture and fittings', 'non_current_assets', 'ppe_furniture'),
    ('1515', 'Furniture and fittings: accumulated depreciation', 'non_current_assets', 'ppe_furniture_dep'),
    ('1520', 'Computers and phones', 'non_current_assets', 'ppe_computers'),
    ('1525', 'Computers and phones: accumulated depreciation', 'non_current_assets', 'ppe_computers_dep'),
    ('1530', 'Generators and equipment', 'non_current_assets', 'ppe_equipment'),
    ('1535', 'Generators and equipment: accumulated depreciation', 'non_current_assets', 'ppe_equipment_dep'),
    ('1540', 'Motor vehicles', 'non_current_assets', 'ppe_vehicles'),
    ('1545', 'Motor vehicles: accumulated depreciation', 'non_current_assets', 'ppe_vehicles_dep'),
    ('2000', 'Trade payables', 'current_liabilities', 'payables'),
    ('2010', 'Goods received not invoiced', 'current_liabilities', 'grni'),
    ('2020', 'Maker fees payable', 'current_liabilities', 'maker_payables'),
    ('2030', 'Customer deposits', 'current_liabilities', 'customer_deposits'),
    ('2100', 'VAT payable (output VAT)', 'current_liabilities', 'vat_output'),
    ('2110', 'PAYE payable', 'current_liabilities', 'paye'),
    ('2120', 'Withholding tax payable', 'current_liabilities', 'wht'),
    ('2130', 'Pension payable', 'current_liabilities', 'pension'),
    ('2140', 'Company income tax payable', 'current_liabilities', 'cit'),
    ('2150', 'Accruals', 'current_liabilities', 'accruals'),
    ('2160', 'Net pay payable', 'current_liabilities', 'net_pay'),
    ('2200', 'Director''s current account 1', 'current_liabilities', 'director_1'),
    ('2210', 'Director''s current account 2', 'current_liabilities', 'director_2'),
    ('2300', 'Short-term loans', 'current_liabilities', 'loans_short'),
    ('2500', 'Long-term loans', 'non_current_liabilities', 'loans_long'),
    ('3000', 'Share capital', 'equity', 'share_capital'),
    ('3100', 'Business-name capital taken over', 'equity', 'bn_capital'),
    ('3200', 'Retained earnings', 'equity', 'retained_earnings'),
    ('3300', 'Opening balance equity', 'equity', 'opening_equity'),
    ('3400', 'Dividends', 'equity', 'dividends'),
    ('4000', 'Sales: clothing', 'income', 'sales_clothing'),
    ('4010', 'Sales: shoes', 'income', 'sales_shoes'),
    ('4020', 'Sales: bags', 'income', 'sales_bags'),
    ('4030', 'Sales: other', 'income', 'sales_other'),
    ('4100', 'Repair income', 'income', 'repair_income'),
    ('4200', 'Delivery charges', 'income', 'delivery_income'),
    ('4300', 'Discounts given', 'income', 'discounts'),
    ('4310', 'Sales returns', 'income', 'sales_returns'),
    ('4900', 'Other income', 'other_income', 'other_income'),
    ('5000', 'Cost of goods sold', 'cost_of_sales', 'cogs'),
    ('5010', 'Materials and fabrics', 'cost_of_sales', 'materials'),
    ('5020', 'Production labour and maker fees', 'cost_of_sales', 'production_labour'),
    ('5030', 'Printing, labels and packaging', 'cost_of_sales', 'packaging'),
    ('5040', 'Production losses and rework', 'cost_of_sales', 'production_losses'),
    ('5050', 'Stock write-offs and count differences', 'cost_of_sales', 'stock_writeoffs'),
    ('5060', 'Inbound delivery', 'cost_of_sales', 'inbound_delivery'),
    ('5090', 'Opening and closing stock adjustment', 'cost_of_sales', 'stock_change'),
    ('6000', 'Salaries and wages', 'operating_expenses', 'salaries'),
    ('6010', 'Contract staff pay', 'operating_expenses', 'contract_pay'),
    ('6020', 'Pension (employer)', 'operating_expenses', 'pension_expense'),
    ('6030', 'Staff welfare', 'operating_expenses', null),
    ('6040', 'Rent', 'operating_expenses', 'rent'),
    ('6050', 'Electricity and diesel', 'operating_expenses', null),
    ('6060', 'Internet, data and phone', 'operating_expenses', null),
    ('6070', 'Delivery and logistics', 'operating_expenses', 'delivery_out'),
    ('6080', 'Advertising', 'operating_expenses', null),
    ('6090', 'Marketing and events', 'operating_expenses', null),
    ('6100', 'Social media management', 'operating_expenses', null),
    ('6110', 'Photography and creatives', 'operating_expenses', null),
    ('6120', 'Cleaning', 'operating_expenses', null),
    ('6130', 'Bank charges', 'operating_expenses', 'bank_charges'),
    ('6140', 'Repairs and maintenance', 'operating_expenses', null),
    ('6150', 'Professional and registration fees', 'operating_expenses', null),
    ('6160', 'IT and subscriptions', 'operating_expenses', null),
    ('6170', 'Training', 'operating_expenses', null),
    ('6180', 'Depreciation', 'operating_expenses', 'depreciation'),
    ('6190', 'PAYE and withholding tax borne by the company', 'operating_expenses', 'tax_borne'),
    ('6900', 'Office and sundry', 'operating_expenses', null),
    ('7000', 'Interest', 'finance_costs', 'interest'),
    ('7900', 'Income tax expense', 'tax', 'income_tax'),
    ('9999', 'Rounding', 'operating_expenses', 'rounding')
  ) as t(code, name, grp, sk)
$$;
revoke all on function app.chart_template from public, anon, authenticated;

-- Seeds the chart: the template, or the owner's chart plus any app roles it doesn't cover.
create or replace function app.seed_chart(p_business_id uuid, p_chart jsonb default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r record;
  t record;
  v_code text;
  v_n integer;
  v_sk text;
  v_grp text;
  v_tname text;
begin
  if p_chart is null then
    insert into public.accounts (business_id, code, name, account_group, system_key)
    select p_business_id, c.code, c.name, c.grp, c.sk from app.chart_template() c;
  else
    if jsonb_typeof(p_chart) <> 'array' or jsonb_array_length(p_chart) = 0 then
      raise exception 'The chart of accounts is empty.' using errcode = 'P0001';
    end if;
    if jsonb_array_length(p_chart) > 1000 then
      raise exception 'A chart can have at most 1,000 accounts.' using errcode = 'P0001';
    end if;
    for r in select value as v, ordinality as n from jsonb_array_elements(p_chart) with ordinality loop
      v_code := regexp_replace(coalesce(r.v ->> 'code', ''), '\s+', '', 'g');
      if v_code !~ '^[0-9][0-9A-Za-z-]{0,15}$' then
        raise exception 'Account %: the code must start with a digit, e.g. 1001 or 1001-1.', r.n using errcode = 'P0001';
      end if;
      if char_length(btrim(coalesce(r.v ->> 'name', ''))) not between 1 and 120 then
        raise exception 'Account % (%): give it a name of up to 120 characters.', r.n, v_code using errcode = 'P0001';
      end if;
      if exists (select 1 from public.accounts where business_id = p_business_id and code = v_code) then
        raise exception 'Code % is used twice.', v_code using errcode = 'P0001';
      end if;
      v_sk := null; v_grp := null; v_tname := null;
      select c.sk, c.grp, c.name into v_sk, v_grp, v_tname from app.chart_template() c
        where c.sk is not null and c.sk = nullif(r.v ->> 'system_key', '');
      if nullif(r.v ->> 'system_key', '') is not null and v_sk is null then
        raise exception 'Account %: unknown app role.', v_code using errcode = 'P0001';
      end if;
      if v_sk is not null and exists (select 1 from public.accounts where business_id = p_business_id and system_key = v_sk) then
        raise exception 'Two accounts are set to the same app role (%).', v_tname using errcode = 'P0001';
      end if;
      if v_sk is null and coalesce(r.v ->> 'group', '') not in ('current_assets', 'non_current_assets', 'current_liabilities',
          'non_current_liabilities', 'equity', 'income', 'other_income', 'cost_of_sales', 'operating_expenses', 'finance_costs', 'tax') then
        raise exception 'Account %: choose where it belongs.', v_code using errcode = 'P0001';
      end if;
      -- An account used for an app role sits where that role needs it (e.g. a director's account is a liability).
      insert into public.accounts (business_id, code, name, account_group, system_key)
      values (p_business_id, v_code, btrim(r.v ->> 'name'), coalesce(v_grp, r.v ->> 'group'), v_sk);
    end loop;

    -- Roles the owner's chart doesn't cover get the template account, on a free code.
    for t in select * from app.chart_template() c
             where c.sk is not null and not exists (select 1 from public.accounts a where a.business_id = p_business_id and a.system_key = c.sk)
             order by c.code loop
      v_code := t.code;
      v_n := t.code::integer;
      while exists (select 1 from public.accounts where business_id = p_business_id and code = v_code) loop
        v_n := v_n + 1;
        v_code := v_n::text;
      end loop;
      insert into public.accounts (business_id, code, name, account_group, system_key)
      values (p_business_id, v_code, t.name, t.grp, t.sk);
    end loop;
  end if;

  -- Pair each accumulated depreciation account with its asset.
  update public.accounts d set contra_of = a.id
  from public.accounts a
  where d.business_id = p_business_id and a.business_id = p_business_id
    and d.system_key like 'ppe\_%\_dep' and a.system_key = left(d.system_key, -4);
end;
$$;
revoke all on function app.seed_chart(uuid, jsonb) from public, anon, authenticated;
drop function if exists app.seed_chart(uuid);

-- Setup now takes an optional chart (null = the template).
drop function if exists public.setup_books(uuid, date, boolean, date, boolean, numeric);
create or replace function public.setup_books(
  p_business_id uuid, p_first_year_start date, p_first_year_imported boolean, p_incorporation_date date,
  p_vat_registered boolean, p_vat_rate numeric, p_chart jsonb default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone app.business_tz(p_business_id))::date;
begin
  if not app.is_owner(p_business_id) then
    raise exception 'Only owners can set up the books.' using errcode = '42501';
  end if;
  if exists (select 1 from public.books_settings where business_id = p_business_id) then
    raise exception 'The books are already set up.' using errcode = 'P0001';
  end if;
  if p_first_year_start is null or extract(day from p_first_year_start) <> 1 then
    raise exception 'The first financial year starts on the 1st of a month.' using errcode = 'P0001';
  end if;
  if p_first_year_start > v_today then
    raise exception 'The first financial year can''t start in the future.' using errcode = 'P0001';
  end if;
  if p_first_year_start < v_today - interval '6 years' then
    raise exception 'Start no more than six years back.' using errcode = 'P0001';
  end if;
  if coalesce(p_vat_registered, false) and p_vat_rate is null then
    raise exception 'Enter the VAT rate.' using errcode = 'P0001';
  end if;
  if p_vat_rate is not null and (p_vat_rate < 0 or p_vat_rate > 100) then
    raise exception 'The VAT rate must be between 0 and 100%%.' using errcode = 'P0001';
  end if;
  insert into public.books_settings (business_id, first_year_start, incorporation_date, vat_registered, vat_rate)
  values (p_business_id, p_first_year_start, p_incorporation_date, coalesce(p_vat_registered, false),
    case when coalesce(p_vat_registered, false) then p_vat_rate end);
  perform app.seed_chart(p_business_id, p_chart);
  insert into public.fiscal_years (business_id, start_date, end_date, kind)
  values (p_business_id, p_first_year_start, (p_first_year_start + interval '1 year')::date - 1,
    case when coalesce(p_first_year_imported, false) then 'imported' else 'live' end);
  perform app.ensure_fiscal_years(p_business_id, v_today);
end;
$$;
revoke all on function public.setup_books from public, anon;
grant execute on function public.setup_books to authenticated;

-- Account codes: same rule as the chart (digits first, sub-codes allowed).
create or replace function public.create_account(p_business_id uuid, p_code text, p_name text, p_group text, p_contra_of uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_code text := regexp_replace(coalesce(p_code, ''), '\s+', '', 'g');
begin
  perform app.require_owner_books(p_business_id);
  if v_code !~ '^[0-9][0-9A-Za-z-]{0,15}$' then
    raise exception 'The code starts with a digit, e.g. 6210 or 1001-1.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.accounts where business_id = p_business_id and code = v_code) then
    raise exception 'Another account already uses code %.', v_code using errcode = 'P0001';
  end if;
  if p_group is null or p_group not in ('current_assets', 'non_current_assets', 'current_liabilities', 'non_current_liabilities',
      'equity', 'income', 'other_income', 'cost_of_sales', 'operating_expenses', 'finance_costs', 'tax') then
    raise exception 'Choose where the account belongs.' using errcode = 'P0001';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 120 then
    raise exception 'Give the account a name (up to 120 characters).' using errcode = 'P0001';
  end if;
  if p_contra_of is not null and not exists (select 1 from public.accounts where id = p_contra_of and business_id = p_business_id) then
    raise exception 'Choose the asset account this one belongs to.' using errcode = 'P0001';
  end if;
  insert into public.accounts (business_id, code, name, account_group, contra_of)
  values (p_business_id, v_code, btrim(p_name), p_group, p_contra_of)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.update_account(p_account_id uuid, p_code text, p_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_business uuid;
  a public.accounts;
  v_code text := regexp_replace(coalesce(p_code, ''), '\s+', '', 'g');
begin
  select business_id into v_business from public.accounts where id = p_account_id;
  if v_business is null or not app.is_owner(v_business) then
    raise exception 'Only owners can work with the books.' using errcode = '42501';
  end if;
  perform app.require_owner_books(v_business);
  select * into a from public.accounts where id = p_account_id for update;
  if p_name is null or char_length(btrim(p_name)) = 0 or char_length(btrim(p_name)) > 120 then
    raise exception 'Give the account a name (up to 120 characters).' using errcode = 'P0001';
  end if;
  if v_code is distinct from a.code then
    if a.system_key is not null then
      raise exception 'The app posts to this account automatically, so its code stays %. You can rename it.', a.code using errcode = 'P0001';
    end if;
    if v_code !~ '^[0-9][0-9A-Za-z-]{0,15}$' then
      raise exception 'The code starts with a digit, e.g. 6210 or 1001-1.' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.accounts where business_id = a.business_id and code = v_code) then
      raise exception 'Another account already uses code %.', v_code using errcode = 'P0001';
    end if;
  end if;
  update public.accounts set code = v_code, name = btrim(p_name) where id = p_account_id;
end;
$$;
