create or replace function public.lookup_auth_user_ids_by_phone(p_phone text)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with requested_phone as (
    select case
      when length(digits) = 12 and left(digits, 2) = '57' then substring(digits from 3)
      else digits
    end as normalized
    from (
      select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as digits
    ) input
  )
  select profile.id
  from public.profiles as profile
  cross join lateral (
    select case
      when length(digits) = 12 and left(digits, 2) = '57' then substring(digits from 3)
      else digits
    end as normalized
    from (
      select regexp_replace(coalesce(profile.phone, ''), '[^0-9]', '', 'g') as digits
    ) stored
  ) as stored_phone
  where stored_phone.normalized <> ''
    and stored_phone.normalized = (select normalized from requested_phone);
$$;

revoke all on function public.lookup_auth_user_ids_by_phone(text) from public, anon, authenticated;
grant execute on function public.lookup_auth_user_ids_by_phone(text) to service_role;
