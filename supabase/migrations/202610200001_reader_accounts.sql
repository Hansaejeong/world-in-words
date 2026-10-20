-- Username-only accounts; credentials and libraries are not exposed by the Data API.
create extension if not exists pgcrypto with schema extensions;
create schema if not exists wiw;
revoke all on schema wiw from public, anon, authenticated;

create table wiw.users (
 id uuid primary key default gen_random_uuid(),
 username text not null unique check (username ~ '^[a-z0-9_]{3,24}$'),
 password_hash text not null,
 created_at timestamptz not null default now()
);
create table wiw.sessions (
 token_hash text primary key,
 user_id uuid not null references wiw.users(id) on delete cascade,
 expires_at timestamptz not null default now() + interval '30 days'
);
create index on wiw.sessions(user_id);
create table wiw.auth_attempts (
 username text primary key,
 attempts integer not null default 0,
 started_at timestamptz not null default now()
);
create table wiw.articles (
 id text primary key,
 metadata jsonb not null,
 view_count bigint not null default 0
);
create table wiw.view_events (
 article_id text not null references wiw.articles(id),
 viewer_hash text not null,
 viewed_day date not null default (now() at time zone 'Asia/Seoul')::date,
 primary key(article_id,viewer_hash,viewed_day)
);
create table wiw.history (
 user_id uuid not null references wiw.users(id) on delete cascade,
 article_id text not null references wiw.articles(id),
 year integer not null,
 first_viewed_at timestamptz not null default now(),
 last_viewed_at timestamptz not null default now(),
 open_count bigint not null default 1,
 primary key(user_id,article_id,year)
);
create index on wiw.history(user_id,year,last_viewed_at desc);
create table wiw.scraps (
 user_id uuid not null references wiw.users(id) on delete cascade,
 article_id text not null references wiw.articles(id),
 saved_at timestamptz not null default now(),
 primary key(user_id,article_id)
);
create index on wiw.scraps(user_id,saved_at desc);

alter table wiw.users enable row level security;
alter table wiw.sessions enable row level security;
alter table wiw.auth_attempts enable row level security;
alter table wiw.articles enable row level security;
alter table wiw.view_events enable row level security;
alter table wiw.history enable row level security;
alter table wiw.scraps enable row level security;
revoke all on all tables in schema wiw from public, anon, authenticated;

-- Only the Site's backend service key may call this function. Each private
-- operation resolves its user from a hashed, unexpired session, never a user ID.
create or replace function public.wiw_api(p_action text, p_session text default null, p_input jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 u wiw.users%rowtype;
 attempt wiw.auth_attempts%rowtype;
 uname text := lower(trim(p_input->>'username'));
 pw text := p_input->>'password';
 article jsonb := p_input->'article';
 aid text := p_input->>'id';
 mode text := coalesce(p_input->>'kind','history');
 chosen_year integer;
 page_no integer := greatest(0,least(coalesce((p_input->>'page')::integer,0),10000));
 needle text := lower(left(coalesce(p_input->>'q',''),200));
 country text := coalesce(p_input->>'country','all');
 current_year integer := extract(year from now() at time zone 'Asia/Seoul');
 result jsonb;
 n integer;
begin
 if p_action in ('signup','login') then
  if uname is null or uname !~ '^[a-z0-9_]{3,24}$' or pw is null or octet_length(pw) < 8 or octet_length(pw) > 64 then
   return jsonb_build_object('error','invalid_credentials');
  end if;
  if p_session is null or p_session !~ '^[a-f0-9]{64}$' then raise exception 'Invalid session hash'; end if;
  insert into wiw.auth_attempts(username) values(uname) on conflict do nothing;
  select * into attempt from wiw.auth_attempts where username=uname for update;
  if attempt.started_at < now()-interval '15 minutes' then
   update wiw.auth_attempts set attempts=0,started_at=now() where username=uname;
   attempt.attempts := 0;
  end if;
  if attempt.attempts >= 8 then return jsonb_build_object('error','rate_limited'); end if;
  update wiw.auth_attempts set attempts=attempts+1 where username=uname;
  if p_action='signup' then
   if exists(select 1 from wiw.users where username=uname) then return jsonb_build_object('error','username_taken'); end if;
   insert into wiw.users(username,password_hash) values(uname,extensions.crypt(pw,extensions.gen_salt('bf',12))) returning * into u;
  else
   select * into u from wiw.users where username=uname;
   if u.id is null then
    perform extensions.crypt(pw,extensions.gen_salt('bf',12));
    return jsonb_build_object('error','invalid_credentials');
   end if;
   if u.password_hash <> extensions.crypt(pw,u.password_hash) then return jsonb_build_object('error','invalid_credentials'); end if;
  end if;
  update wiw.auth_attempts set attempts=0,started_at=now() where username=uname;
  delete from wiw.sessions where expires_at < now();
  insert into wiw.sessions(token_hash,user_id) values(p_session,u.id);
  return jsonb_build_object('user',jsonb_build_object('username',u.username));
 end if;

 select a.* into u from wiw.users a join wiw.sessions s on s.user_id=a.id
  where s.token_hash=p_session and s.expires_at > now();
 if p_action='logout' then
  delete from wiw.sessions where token_hash=p_session;
  return jsonb_build_object('ok',true);
 elsif p_action='session' then
  return jsonb_build_object('user',case when u.id is null then null else jsonb_build_object('username',u.username) end);
 elsif p_action='counts' then
  select coalesce(jsonb_object_agg(a.id,a.view_count),'{}'::jsonb) into result from wiw.articles a
   where a.id in (select jsonb_array_elements_text(p_input->'ids'));
  return jsonb_build_object('counts',result,'savedIds',coalesce((select jsonb_agg(s.article_id) from wiw.scraps s where s.user_id=u.id),'[]'::jsonb));
 end if;

 if p_action='view' then
  aid := article->>'id';
  if aid is null or length(aid)>128 or length(article->>'title')>2000 then raise exception 'Invalid article'; end if;
  insert into wiw.articles(id,metadata) values(aid,article)
   on conflict(id) do update set metadata=excluded.metadata;
  insert into wiw.view_events(article_id,viewer_hash) values(aid,p_input->>'viewer') on conflict do nothing;
  get diagnostics n = row_count;
  if n=1 then update wiw.articles set view_count=view_count+1 where id=aid; end if;
  if u.id is not null then
   insert into wiw.history(user_id,article_id,year) values(u.id,aid,current_year)
    on conflict(user_id,article_id,year) do update set last_viewed_at=now(),open_count=wiw.history.open_count+1;
  end if;
  -- Dedupe data is temporary; annual personal history is retained.
  delete from wiw.view_events where viewed_day < (now() at time zone 'Asia/Seoul')::date-2;
  return jsonb_build_object('recorded',true,'historySaved',u.id is not null);
 end if;

 if u.id is null then return jsonb_build_object('error','unauthorized'); end if;
 if p_action='scrap' then
  aid := coalesce(aid,article->>'id');
  if p_input->>'saved'='false' then
   delete from wiw.scraps where user_id=u.id and article_id=aid;
   return jsonb_build_object('saved',false);
  end if;
  if article is null or aid is null then raise exception 'Invalid article'; end if;
  insert into wiw.articles(id,metadata) values(aid,article) on conflict(id) do update set metadata=excluded.metadata;
  insert into wiw.scraps(user_id,article_id) values(u.id,aid) on conflict do nothing;
  return jsonb_build_object('saved',true);
 elsif p_action='article' then
  select a.metadata || jsonb_build_object('viewCount',a.view_count) into result from wiw.articles a where a.id=aid and
   (exists(select 1 from wiw.history h where h.user_id=u.id and h.article_id=a.id)
    or exists(select 1 from wiw.scraps s where s.user_id=u.id and s.article_id=a.id));
  return jsonb_build_object('article',result);
 elsif p_action='library' then
  if mode not in ('history','scraps') then raise exception 'Invalid category'; end if;
  chosen_year := nullif(p_input->>'year','')::integer;
  with entries as (
   select h.article_id,h.year,h.last_viewed_at as touched,h.open_count from wiw.history h where h.user_id=u.id and mode='history'
   union all
   select s.article_id,extract(year from s.saved_at at time zone 'Asia/Seoul')::integer,s.saved_at,0::bigint from wiw.scraps s where s.user_id=u.id and mode='scraps'
  ), filtered as (
   select a.*,e.year,e.touched,e.open_count,exists(select 1 from wiw.scraps s where s.user_id=u.id and s.article_id=a.id) as saved
   from entries e join wiw.articles a on a.id=e.article_id
   where (chosen_year is null or e.year=chosen_year) and (country='all' or a.metadata->>'country'=country)
    and (needle='' or position(needle in lower(concat_ws(' ',a.metadata->>'title',a.metadata->>'source',a.metadata->>'country'))) > 0)
  ), paged as (
   select * from filtered order by
    case when p_input->>'sort'='views' then view_count end desc nulls last,touched desc,id
    limit 50 offset page_no*50
  ) select jsonb_build_object(
   'articles',coalesce((select jsonb_agg(metadata || jsonb_build_object('viewCount',view_count,'saved',saved,'year',year,'lastViewedAt',touched,'openCount',open_count)
    order by case when p_input->>'sort'='views' then view_count end desc nulls last,touched desc,id) from paged),'[]'::jsonb),
   'total',(select count(*) from filtered),
   'years',coalesce((select jsonb_agg(y.year order by y.year desc) from (select distinct year from entries) y),'[]'::jsonb)
  ) into result;
  return result;
 end if;
 raise exception 'Unknown action';
end $$;
revoke all on function public.wiw_api(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.wiw_api(text,text,jsonb) to service_role;
