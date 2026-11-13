-- Books Phase E: aged receivables and payables.
--
-- Built from the general ledger, so the totals always agree with the balance sheet:
--   receivables = what customers owe, per order or repair (receivables less deposits held on that order/repair);
--   payables    = what the business owes suppliers, per supplier (the payables account).
-- Payments and credits are applied to the oldest charges first, so what's still owed is made up of the newest
-- charges. Entries not linked to an order, repair or supplier (opening balances, manual journals) are grouped
-- in one "not linked" row. A journal and its reversal both drop out once the reversal is dated on or before the
-- "as at" date.

create or replace function public.aged_balances(p_business_id uuid, p_kind text, p_as_at date)
returns table (
  ref_type text, ref_id uuid, party text, reference text, oldest_date date,
  total_minor bigint, current_minor bigint, d31_60_minor bigint, d61_90_minor bigint, over_90_minor bigint
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_owner(p_business_id) then
    raise exception 'Only owners can see the books.' using errcode = '42501';
  end if;
  if p_kind not in ('receivables', 'payables') then
    raise exception 'Choose receivables or payables.' using errcode = '22023';
  end if;
  if p_as_at is null then
    raise exception 'Choose the date to age balances at.' using errcode = '22023';
  end if;

  return query
  with entries as (
    -- One amount per journal and party; positive = owed (to the business for receivables, by it for payables).
    select
      case when p_kind = 'receivables' and j.ref_type in ('order', 'repair') then j.ref_type
           when p_kind = 'payables' and j.ref_type = 'supplier' then j.ref_type end as rtype,
      case when (p_kind = 'receivables' and j.ref_type in ('order', 'repair')) or (p_kind = 'payables' and j.ref_type = 'supplier')
           then j.ref_id end as rid,
      j.effective_date as d,
      sum(case when p_kind = 'receivables' then l.debit_minor - l.credit_minor else l.credit_minor - l.debit_minor end) as amt
    from public.journal_lines l
    join public.journals j on j.id = l.journal_id
    join public.accounts a on a.id = l.account_id
    left join public.journals rev on rev.id = j.reversed_by_id
    where l.business_id = p_business_id
      and j.effective_date <= p_as_at
      and a.system_key in (select unnest(case when p_kind = 'receivables' then array['receivables', 'customer_deposits'] else array['payables'] end))
      and not (j.reverses_id is not null)
      and not (rev.id is not null and rev.effective_date <= p_as_at)
    group by 1, 2, j.id, j.effective_date
  ),
  -- A reversal dated after the as-at date leaves its original in; reversals dated on or before it remove both.
  parties as (
    select e.rtype, e.rid, sum(e.amt) as total from entries e group by e.rtype, e.rid having sum(e.amt) > 0
  ),
  charges as (
    select e.rtype, e.rid, e.d, e.amt, p.total,
      sum(e.amt) over (partition by e.rtype, e.rid order by e.d desc rows between unbounded preceding and current row) as cum
    from entries e
    join parties p on p.rtype is not distinct from e.rtype and p.rid is not distinct from e.rid
    where e.amt > 0
  ),
  allocated as (
    -- Newest charges first until the amount still owed is used up.
    select c.rtype, c.rid, c.d, greatest(0, least(c.amt, c.total - (c.cum - c.amt))) as owed
    from charges c
  ),
  aged as (
    select a.rtype, a.rid,
      min(a.d) filter (where a.owed > 0) as oldest,
      sum(a.owed) as total,
      sum(a.owed) filter (where p_as_at - a.d <= 30) as b0,
      sum(a.owed) filter (where p_as_at - a.d between 31 and 60) as b1,
      sum(a.owed) filter (where p_as_at - a.d between 61 and 90) as b2,
      sum(a.owed) filter (where p_as_at - a.d > 90) as b3
    from allocated a
    group by a.rtype, a.rid
  )
  select g.rtype, g.rid,
    case g.rtype
      when 'order' then (select c.full_name from public.orders o join public.customers c on c.id = o.customer_id where o.id = g.rid)
      when 'repair' then (select c.full_name from public.repairs r join public.customers c on c.id = r.customer_id where r.id = g.rid)
      when 'supplier' then (select s.name from public.suppliers s where s.id = g.rid)
      else 'Not linked to ' || case when p_kind = 'receivables' then 'an order or repair' else 'a supplier' end
        || ' (opening balances, manual journals)'
    end,
    case g.rtype
      when 'order' then (select o.order_number from public.orders o where o.id = g.rid)
      when 'repair' then (select r.number from public.repairs r where r.id = g.rid)
    end,
    g.oldest,
    coalesce(g.total, 0)::bigint, coalesce(g.b0, 0)::bigint, coalesce(g.b1, 0)::bigint, coalesce(g.b2, 0)::bigint, coalesce(g.b3, 0)::bigint
  from aged g
  where coalesce(g.total, 0) > 0
  order by g.oldest, 3;
end;
$$;

revoke all on function public.aged_balances(uuid, text, date) from public, anon;
grant execute on function public.aged_balances(uuid, text, date) to authenticated;
