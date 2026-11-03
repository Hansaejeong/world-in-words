create or replace function public.wiw_library_search(p_action text, p_session text default null, p_input jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 account_id uuid;
 mode text := coalesce(p_input->>'kind','history');
 from_date date;
 to_date date;
 page_no integer := greatest(0,least(coalesce((p_input->>'page')::integer,0),10000));
 needle text := lower(left(coalesce(p_input->>'title',''),200));
 country_code text := coalesce(p_input->>'country','all');
 publisher_name text := left(coalesce(p_input->>'publisher',''),300);
 result jsonb;
begin
 if p_action<>'library' then raise exception 'Unknown action'; end if;
 if coalesce(p_input->>'from','') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(p_input->>'to','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid date range'; end if;
 from_date := (p_input->>'from')::date;to_date := (p_input->>'to')::date;
 if from_date>to_date or to_date>from_date+interval '1 year' then raise exception 'Invalid date range'; end if;
 if mode not in ('history','scraps') then raise exception 'Invalid category'; end if;
 select s.user_id into account_id from wiw.sessions s where s.token_hash=p_session and s.expires_at>now();
 if account_id is null then return jsonb_build_object('error','unauthorized'); end if;

 with entries as (
  select h.article_id,max(h.year) as year,max(h.last_viewed_at) as touched,sum(h.open_count) as open_count from wiw.history h where h.user_id=account_id and mode='history' group by h.article_id
  union all
  select s.article_id,extract(year from s.saved_at at time zone 'Asia/Seoul')::integer,s.saved_at,0::bigint from wiw.scraps s where s.user_id=account_id and mode='scraps'
 ), eligible as (
  select a.*,e.year,e.touched,e.open_count,exists(select 1 from wiw.scraps s where s.user_id=account_id and s.article_id=a.id) as saved
  from entries e join wiw.articles a on a.id=e.article_id
  where left(a.metadata->>'date',10) between from_date::text and to_date::text
   and (country_code='all' or a.metadata->>'country'=country_code)
   and (needle='' or position(needle in lower(a.metadata->>'title'))>0)
 ), filtered as (
  select * from eligible where publisher_name='' or metadata->>'source'=publisher_name
 ), paged as (
  select * from filtered order by
   case when p_input->>'sort'='country' then metadata->>'country' end asc nulls last,
   case when p_input->>'sort'='views' then view_count end desc nulls last,touched desc,id
  limit 50 offset page_no*50
 ) select jsonb_build_object(
  'articles',coalesce((select jsonb_agg(metadata || jsonb_build_object('viewCount',view_count,'saved',saved,'year',year,'lastViewedAt',touched,'openCount',open_count)
   order by case when p_input->>'sort'='country' then metadata->>'country' end asc nulls last,
   case when p_input->>'sort'='views' then view_count end desc nulls last,touched desc,id) from paged),'[]'::jsonb),
  'total',(select count(*) from filtered),
  'publishers',coalesce((select jsonb_agg(source order by source) from (select distinct metadata->>'source' as source from eligible where metadata->>'source'<>'' ) p),'[]'::jsonb)
 ) into result;
 return result;
end $$;
revoke all on function public.wiw_library_search(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.wiw_library_search(text,text,jsonb) to service_role;
