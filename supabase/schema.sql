-- ============================================================
-- 云站 Supabase 初始化脚本 v2（访客统计 + 登录注册 + 管理后台）
-- 使用方法：Supabase 控制台 → SQL Editor → 粘贴本文件全部内容 → Run
-- 幂等：可重复运行；在 v1 基础上追加管理后台相关对象。
-- 顺序：先建表 → 再建函数 → 再建策略（策略表达式依赖函数）。
-- ============================================================

-- ############################################################
-- 一、表
-- ############################################################

-- 1) 访问记录表：每次页面加载写入一行（匿名，仅访客随机 id + 路径）
create table if not exists public.visits (
  id         uuid primary key default gen_random_uuid(),
  visitor_id text not null,
  path       text not null default '/',
  created_at timestamptz not null default now()
);
create index if not exists visits_created_at_idx on public.visits (created_at);
create index if not exists visits_visitor_idx   on public.visits (visitor_id);

-- 2) 管理员名单（白名单）：拥有管理后台全部权限
create table if not exists public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- 3) 账号资料表：注册触发器自动写入，管理员可见可封禁
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  display_name text,
  banned       boolean not null default false,
  created_at   timestamptz not null default now()
);

-- 4) 访客黑名单：封匿名访客（按浏览器随机访客 id）
create table if not exists public.banned_visitors (
  visitor_id text primary key,
  reason     text not null default '',
  created_at timestamptz not null default now()
);

-- ############################################################
-- 二、函数（security definer：策略与前端共用，不受 RLS 干扰）
-- ############################################################

create or replace function public.is_admin()
returns boolean
language sql stable
security definer set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

create or replace function public.is_banned()
returns boolean
language sql stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and banned
  );
$$;

create or replace function public.is_banned_visitor(v text)
returns boolean
language sql stable
security definer set search_path = public
as $$
  select exists (select 1 from public.banned_visitors where visitor_id = v);
$$;

-- 首个账号认领管理员（仅当管理员名单为空时生效；认领过即失效）
create or replace function public.claim_admin_if_first()
returns boolean
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    return false;
  end if;
  if (select count(*) from public.admins) > 0 then
    return false;
  end if;
  insert into public.admins (user_id) values (auth.uid()) on conflict do nothing;
  return exists (select 1 from public.admins where user_id = auth.uid());
end;
$$;

-- 页脚聚合统计（匿名可调用，只暴露计数）
create or replace function public.get_site_stats()
returns table (
  total_views     bigint,
  today_views     bigint,
  unique_visitors bigint
)
language sql
security definer
set search_path = public
as $$
  select
    (select count(*) from public.visits)::bigint,
    (select count(*) from public.visits
      where created_at >= date_trunc('day', now()))::bigint,
    (select count(distinct visitor_id) from public.visits)::bigint;
$$;

-- 访客行为总览（仅管理员；非管理员返回空集）
create or replace function public.get_visitor_overview(max_rows int default 100)
returns table (
  visitor_id  text,
  visit_count bigint,
  first_seen  timestamptz,
  last_seen   timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    v.visitor_id,
    count(*)::bigint,
    min(v.created_at),
    max(v.created_at)
  from public.visits v
  where (select public.is_admin())
  group by v.visitor_id
  order by max(v.created_at) desc
  limit least(greatest(max_rows, 1), 500);
$$;

-- 注册触发器函数：新用户自动建立资料
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ############################################################
-- 三、函数授权
-- ############################################################
revoke all on function public.get_site_stats() from public;
grant execute on function public.get_site_stats() to anon, authenticated;

revoke all on function public.get_visitor_overview(int) from public;
grant execute on function public.get_visitor_overview(int) to authenticated;

grant execute on function public.claim_admin_if_first() to authenticated;

-- ############################################################
-- 四、行级安全（RLS）
-- ############################################################
alter table public.visits          enable row level security;
alter table public.admins          enable row level security;
alter table public.profiles        enable row level security;
alter table public.banned_visitors enable row level security;

-- 访问写入：被封账号 / 被拉黑访客静默拒绝（服务端强制）
drop policy if exists "anyone can insert visits" on public.visits;
drop policy if exists "not banned can insert visits" on public.visits;
create policy "not banned can insert visits"
  on public.visits
  for insert
  to anon, authenticated
  with check (
    not coalesce(public.is_banned(), false)
    and not public.is_banned_visitor(visitor_id)
  );

-- 访问读取：仅管理员可读原始行为记录
drop policy if exists "admin reads all visits" on public.visits;
create policy "admin reads all visits"
  on public.visits
  for select
  to authenticated
  using (public.is_admin());

-- 管理员名单：仅管理员可读改（前端用它渲染白名单页签）
drop policy if exists "admins manage admins" on public.admins;
create policy "admins manage admins"
  on public.admins
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 账号资料：本人可读自己；管理员可读全部、可封禁/解封
drop policy if exists "read own profile or admin reads all" on public.profiles;
create policy "read own profile or admin reads all"
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists "admin manages profiles" on public.profiles;
create policy "admin manages profiles"
  on public.profiles
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 访客黑名单：仅管理员可读写
drop policy if exists "admin manages banned visitors" on public.banned_visitors;
create policy "admin manages banned visitors"
  on public.banned_visitors
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ############################################################
-- 五、注册触发器与历史数据补录
-- ############################################################
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 补录：脚本运行前就已注册的账号（一次性回填，可重复运行）
insert into public.profiles (id, email, display_name)
select
  u.id,
  u.email,
  coalesce(u.raw_user_meta_data ->> 'display_name', split_part(u.email, '@', 1))
from auth.users u
on conflict (id) do nothing;

-- ############################################################
-- 六、说明
-- ############################################################
-- · 登录注册：Supabase Auth 托管，无需建表。
--   「Confirm email」开关（Authentication → Sign In / Up）决定注册后
--   是否需要邮箱验证；关闭后注册即登录，适合个人站快速使用。
-- · 认领管理员：登录后在账号弹窗点「认领管理员」，仅第一个账号能成功。
-- · 手动提拔/更换管理员：
--     insert into public.admins (user_id)
--       select id from auth.users where email = '某人邮箱';
-- ############################################################
