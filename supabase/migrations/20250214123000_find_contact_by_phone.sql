create or replace function public.find_contact_by_phone(p_phone text)
returns setof contacts
language sql
security definer
set search_path = public
as $$
  select *
  from contacts
  where exists (
    select 1
    from jsonb_array_elements(coalesce(phone_jsonb, '[]'::jsonb)) as phone
    where regexp_replace(phone ->> 'number', '[^0-9]', '', 'g') =
      regexp_replace(p_phone, '[^0-9]', '', 'g')
  );
$$;

grant execute on function public.find_contact_by_phone(text) to authenticated;

