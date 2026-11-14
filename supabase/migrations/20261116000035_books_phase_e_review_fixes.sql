-- Books Phase E review fixes: aged_balances totals agree with the ledger. Suppliers paid ahead (and unlinked
-- credits) are listed as credit rows instead of being dropped, and balances not linked to an order or repair use
-- the receivables account only (a deposit with no order isn't netted against money owed). Orders paid in advance
-- are deposits held, not receivables, so they aren't listed.

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
      and (case when p_kind = 'payables' then a.system_key = 'payables'
                when j.ref_type in ('order', 'repair') then a.system_key in ('receivables', 'customer_deposits')
                else a.system_key = 'receivables' end)
      and not (j.reverses_id is not null)
      and not (rev.id is not null and rev.effective_date <= p_as_at)
    group by 1, 2, j.id, j.effective_date
  ),
  -- A reversal dated after the as-at date leaves its original in; reversals dated on or before it remove both.
  parties as (
    -- Credit balances are listed too (a supplier paid ahead, an unlinked credit), except orders paid in advance:
    -- those are deposits held, not receivables.
    select e.rtype, e.rid, sum(e.amt) as total from entries e group by e.rtype, e.rid
    having sum(e.amt) > 0 or (sum(e.amt) < 0 and not (p_kind = 'receivables' and e.rtype is not null))
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
      sum(a.owed) filter (where p_as_at - a.d <= 30) as b0,
      sum(a.owed) filter (where p_as_at - a.d between 31 and 60) as b1,
      sum(a.owed) filter (where p_as_at - a.d between 61 and 90) as b2,
      sum(a.owed) filter (where p_as_at - a.d > 90) as b3
    from allocated a
    group by a.rtype, a.rid
  )
  select p.rtype, p.rid,
    case p.rtype
      when 'order' then (select c.full_name from public.orders o join public.customers c on c.id = o.customer_id where o.id = p.rid)
      when 'repair' then (select c.full_name from public.repairs r join public.customers c on c.id = r.customer_id where r.id = p.rid)
      when 'supplier' then (select s.name from public.suppliers s where s.id = p.rid)
      else 'Not linked to ' || case when p_kind = 'receivables' then 'an order or repair' else 'a supplier' end
        || ' (opening balances, manual journals)'
    end,
    case p.rtype
      when 'order' then (select o.order_number from public.orders o where o.id = p.rid)
      when 'repair' then (select r.number from public.repairs r where r.id = p.rid)
    end,
    g.oldest,
    p.total::bigint, coalesce(g.b0, 0)::bigint, coalesce(g.b1, 0)::bigint, coalesce(g.b2, 0)::bigint, coalesce(g.b3, 0)::bigint
  from parties p
  left join aged g on g.rtype is not distinct from p.rtype and g.rid is not distinct from p.rid
  order by p.total < 0, g.oldest nulls last, 3;
end;
$$;

revoke all on function public.aged_balances(uuid, text, date) from public, anon;
grant execute on function public.aged_balances(uuid, text, date) to authenticated;
