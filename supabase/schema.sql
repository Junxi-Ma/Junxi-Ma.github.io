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

-- ############################################################
-- 七、外出名额分配：在线房间（房间码即凭证，知道码即可共同编辑）
-- ############################################################

-- 1) 房间表：日期范围、每日名额、理由权重、是否允许调剂、已发布结果
create table if not exists public.outing_rooms (
  code        text primary key,
  start_date  date not null,
  end_date    date not null,
  daily_cap   int  not null default 3,
  weights     jsonb not null default '[5,3,2,1]',
  allow_fill  boolean not null default true,
  result      jsonb,
  result_at   timestamptz,
  created_at  timestamptz not null default now()
);

-- 2) 报名条目：房间内所有人可增删改（房间码即信任凭证）
create table if not exists public.outing_entries (
  id          uuid primary key default gen_random_uuid(),
  room_code   text not null references public.outing_rooms(code) on delete cascade,
  name        text not null,
  days        int  not null default 1,
  past        int  not null default 0,
  reason_idx  int  not null default 0,
  reason_text text not null default '',
  accepts     jsonb not null default '[]',
  client_id   text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists outing_entries_room_idx on public.outing_entries (room_code);

-- 3) 行级安全：房间码就是唯一的准入凭证
alter table public.outing_rooms  enable row level security;
alter table public.outing_entries enable row level security;

drop policy if exists "outing rooms readable" on public.outing_rooms;
create policy "outing rooms readable" on public.outing_rooms
  for select to anon, authenticated using (true);
drop policy if exists "outing rooms creatable" on public.outing_rooms;
create policy "outing rooms creatable" on public.outing_rooms
  for insert to anon, authenticated with check (true);
drop policy if exists "outing rooms editable with code" on public.outing_rooms;
create policy "outing rooms editable with code" on public.outing_rooms
  for update to anon, authenticated using (true) with check (true);

-- 报名条目只允许挂在真实存在的房间下（函数见下）
create or replace function public.outing_room_exists(p_code text)
returns boolean
language sql stable
security definer set search_path = public
as $$
  select exists (select 1 from public.outing_rooms where code = p_code);
$$;

drop policy if exists "outing entries readable" on public.outing_entries;
create policy "outing entries readable" on public.outing_entries
  for select to anon, authenticated using (true);
drop policy if exists "outing entries insertable" on public.outing_entries;
create policy "outing entries insertable" on public.outing_entries
  for insert to anon, authenticated
  with check (public.outing_room_exists(room_code));
drop policy if exists "outing entries editable" on public.outing_entries;
create policy "outing entries editable" on public.outing_entries
  for update to anon, authenticated
  using (public.outing_room_exists(room_code))
  with check (public.outing_room_exists(room_code));
drop policy if exists "outing entries deletable" on public.outing_entries;
create policy "outing entries deletable" on public.outing_entries
  for delete to anon, authenticated
  using (public.outing_room_exists(room_code));

-- 4) 实时推送：把两张表加入 realtime 发布（幂等）
do $$
begin
  alter publication supabase_realtime add table public.outing_entries;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.outing_rooms;
exception when duplicate_object then null;
end $$;

-- ============================================================
--  留言板（branches/junxun/ 军训专属祝福页）
-- ------------------------------------------------------------
--  这几张表本来就存在于本项目里（留言板一直用的就是它们），
--  整段是幂等的：字段和表都在就什么都不做，**不会动任何一行数据**。
--  放在这里只是为了「这个项目的完整结构有据可查」——
--  万一哪天要重建项目，跑一遍本文件就能恢复出同样的表结构。
--  表里已有的留言不受影响；全新项目跑完后留言墙从零开始。
-- ============================================================

-- 1) 留言表
create table if not exists public.wall_posts (
  id          bigint generated by default as identity primary key,
  name        text,
  content     text not null,
  photo       text,
  likes       int not null default 0,
  has_photo   boolean generated always as (photo is not null) stored,
  created_at  timestamptz not null default now()
);

-- 2) 评论表
create table if not exists public.wall_replies (
  id          bigint generated by default as identity primary key,
  post_id     bigint not null references public.wall_posts(id) on delete cascade,
  name        text,
  content     text not null,
  created_at  timestamptz not null default now()
);

-- 3) 管理员改过的「寄语 / 信件」键值表
create table if not exists public.site_data (
  k          text primary key,
  v          text,
  updated_at timestamptz default now()
);

-- 4) 留言表增加「置顶」列（老项目升级用；已有该列则跳过）
alter table public.wall_posts add column if not exists pinned boolean not null default false;

-- 5) 点赞自增：多人同时点赞也不会互相覆盖
create or replace function public.bump_likes(p_id bigint, p_delta int)
returns int
language sql
security definer
set search_path = public
as $$
  update public.wall_posts
     set likes = greatest(0, likes + p_delta)
   where id = p_id
  returning likes;
$$;

-- 6) 管理员操作函数（SECURITY DEFINER：绕过 RLS）
create or replace function public.admin_set_pinned(p_id bigint, p_on boolean)
returns void language sql security definer set search_path = public as $$
  update public.wall_posts set pinned = p_on where id = p_id;
$$;

create or replace function public.admin_delete_post(p_id bigint)
returns void language sql security definer set search_path = public as $$
  delete from public.wall_replies where post_id = p_id;
  delete from public.wall_posts  where id = p_id;
$$;

create or replace function public.admin_edit_post(p_id bigint, p_content text)
returns void language sql security definer set search_path = public as $$
  update public.wall_posts set content = p_content where id = p_id;
$$;

-- 7) 开放读写权限（留言墙是公开墙，与站内其它匿名表同一策略风格）
alter table public.wall_posts   enable row level security;
alter table public.wall_replies enable row level security;
alter table public.site_data    enable row level security;

drop policy if exists "read posts"   on public.wall_posts;
create policy "read posts"   on public.wall_posts   for select using (true);
drop policy if exists "write posts"  on public.wall_posts;
create policy "write posts"  on public.wall_posts   for insert with check (true);
drop policy if exists "update posts" on public.wall_posts;
create policy "update posts" on public.wall_posts   for update using (true);
drop policy if exists "delete posts" on public.wall_posts;
create policy "delete posts" on public.wall_posts   for delete using (true);

drop policy if exists "read replies"  on public.wall_replies;
create policy "read replies"  on public.wall_replies for select using (true);
drop policy if exists "write replies" on public.wall_replies;
create policy "write replies" on public.wall_replies for insert with check (true);
drop policy if exists "delete replies" on public.wall_replies;
create policy "delete replies" on public.wall_replies for delete using (true);

drop policy if exists site_data_read   on public.site_data;
create policy site_data_read   on public.site_data for select using (true);
drop policy if exists site_data_insert on public.site_data;
create policy site_data_insert on public.site_data for insert with check (true);
drop policy if exists site_data_update on public.site_data;
create policy site_data_update on public.site_data for update using (true);

grant execute on function public.bump_likes(bigint, int)         to anon, authenticated;
grant execute on function public.admin_set_pinned(bigint, boolean) to anon, authenticated;
grant execute on function public.admin_delete_post(bigint)        to anon, authenticated;
grant execute on function public.admin_edit_post(bigint, text)    to anon, authenticated;

-- 8) 让 PostgREST 立刻刷新接口缓存，否则刚建的函数会报 PGRST202「找不到函数」
notify pgrst, 'reload schema';

-- ############################################################
-- 八、扫雷排行榜（经典扫雷工具 /tools/minesweeper/）
-- ############################################################

-- 1) 成绩表：每次通关写入一行；登录用户带 user_id（游客为 NULL）
create table if not exists public.minesweeper_records (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete cascade,
  name       text not null default '匿名',
  difficulty text not null check (difficulty in ('b','i','e')),
  seconds    int  not null check (seconds >= 0 and seconds <= 999),
  created_at timestamptz not null default now()
);
create index if not exists ms_records_lb_idx   on public.minesweeper_records (difficulty, seconds);
create index if not exists ms_records_user_idx on public.minesweeper_records (user_id);

-- 2) 登录用户的署名以账号资料为准（防冒名）：插入前改写 name
create or replace function public.ms_resolve_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare pname text;
begin
  if new.user_id is not null then
    select coalesce(p.display_name, split_part(p.email, '@', 1))
      into pname
      from public.profiles p
      where p.id = new.user_id;
    if pname is not null then
      new.name := pname;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists ms_resolve_name_trg on public.minesweeper_records;
create trigger ms_resolve_name_trg
  before insert on public.minesweeper_records
  for each row execute function public.ms_resolve_name();

-- 3) 行级安全：榜单全员可读；写入仅限未被封禁者，登录用户只能挂自己的 user_id
alter table public.minesweeper_records enable row level security;

drop policy if exists "ms records readable" on public.minesweeper_records;
create policy "ms records readable" on public.minesweeper_records
  for select to anon, authenticated using (true);

drop policy if exists "not banned can insert ms records" on public.minesweeper_records;
create policy "not banned can insert ms records"
  on public.minesweeper_records
  for insert
  to anon, authenticated
  with check (
    seconds between 0 and 999
    and difficulty in ('b','i','e')
    and (user_id is null or user_id = auth.uid())
    and not coalesce(public.is_banned(), false)
  );

notify pgrst, 'reload schema';

-- ############################################################
-- 九、数独排行榜（纸感数独 /tools/sudoku/）
-- ############################################################

-- 1) 成绩表：完成一局写入一行；登录用户带 user_id（游客为 NULL）
create table if not exists public.sudoku_records (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete cascade,
  name       text not null default '匿名',
  difficulty text not null check (difficulty in ('easy','medium','hard','expert')),
  seconds    int  not null check (seconds >= 0 and seconds <= 35999),
  mistakes   int  not null default 0,
  hints      int  not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists sudoku_records_lb_idx   on public.sudoku_records (difficulty, seconds);
create index if not exists sudoku_records_user_idx on public.sudoku_records (user_id);

-- 2) 登录用户的署名以账号资料为准（防冒名），与扫雷同一套路
create or replace function public.sudoku_resolve_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare pname text;
begin
  if new.user_id is not null then
    select coalesce(p.display_name, split_part(p.email, '@', 1))
      into pname
      from public.profiles p
      where p.id = new.user_id;
    if pname is not null then
      new.name := pname;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists sudoku_resolve_name_trg on public.sudoku_records;
create trigger sudoku_resolve_name_trg
  before insert on public.sudoku_records
  for each row execute function public.sudoku_resolve_name();

-- 3) 行级安全：榜单全员可读；写入仅限未被封禁者，登录用户只能挂自己的 user_id
alter table public.sudoku_records enable row level security;

drop policy if exists "sudoku records readable" on public.sudoku_records;
create policy "sudoku records readable" on public.sudoku_records
  for select to anon, authenticated using (true);

drop policy if exists "not banned can insert sudoku records" on public.sudoku_records;
create policy "not banned can insert sudoku records"
  on public.sudoku_records
  for insert
  to anon, authenticated
  with check (
    seconds between 0 and 35999
    and difficulty in ('easy','medium','hard','expert')
    and (user_id is null or user_id = auth.uid())
    and not coalesce(public.is_banned(), false)
  );

notify pgrst, 'reload schema';

-- ############################################################
-- 十、看图识天（branches/sky-watch/）：天气图/云图研判留言板
-- ############################################################

-- 1) 研判留言表：每个时次一块板。slot_key = 图片时次（北京时间 YYYYMMDDHH，如 2026100520）
create table if not exists public.sky_watch_messages (
  id         uuid primary key default gen_random_uuid(),
  slot_key   text not null check (slot_key ~ '^[0-9]{10}$'),
  user_id    uuid references auth.users(id) on delete cascade, -- 游客为 NULL
  name       text not null default '匿名',
  guess      text not null check (char_length(guess) between 1 and 120),  -- 猜测结论（快捷语或自定义）
  reason     text check (char_length(reason) <= 2000),                    -- 判断原因，可空
  likes      int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists sky_watch_msg_slot_idx on public.sky_watch_messages (slot_key, created_at desc);
create index if not exists sky_watch_msg_user_idx on public.sky_watch_messages (user_id, created_at desc);

-- 2) 登录用户署名以账号资料为准（防冒名），与扫雷/数独同一套路
create or replace function public.sky_watch_resolve_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare pname text;
begin
  if new.user_id is not null then
    select coalesce(p.display_name, split_part(p.email, '@', 1))
      into pname
      from public.profiles p
      where p.id = new.user_id;
    if pname is not null then
      new.name := pname;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists sky_watch_resolve_name_trg on public.sky_watch_messages;
create trigger sky_watch_resolve_name_trg
  before insert on public.sky_watch_messages
  for each row execute function public.sky_watch_resolve_name();

-- 3) 原子点赞：likes 永不为负（同留言墙 bump_likes 套路），防重复靠前端本地记录
create or replace function public.sky_watch_bump_likes(p_id uuid, p_delta int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  update public.sky_watch_messages
    set likes = greatest(0, likes + coalesce(p_delta, 0))
    where id = p_id
    returning likes into n;
  return coalesce(n, 0);
end;
$$;

revoke all on function public.sky_watch_bump_likes(uuid, int) from public;
grant execute on function public.sky_watch_bump_likes(uuid, int) to anon, authenticated;

-- 4) 留言 RLS：全员可读；未封禁者可留言（登录只能挂自己的 user_id）；作者可删自己的留言
alter table public.sky_watch_messages enable row level security;

drop policy if exists "sky watch messages readable" on public.sky_watch_messages;
create policy "sky watch messages readable" on public.sky_watch_messages
  for select to anon, authenticated using (true);

drop policy if exists "not banned can post sky watch messages" on public.sky_watch_messages;
create policy "not banned can post sky watch messages"
  on public.sky_watch_messages
  for insert
  to anon, authenticated
  with check (
    char_length(guess) between 1 and 120
    and (reason is null or char_length(reason) <= 2000)
    and (user_id is null or user_id = auth.uid())
    and not coalesce(public.is_banned(), false)
  );

drop policy if exists "author can delete own sky watch message" on public.sky_watch_messages;
create policy "author can delete own sky watch message"
  on public.sky_watch_messages
  for delete
  to authenticated
  using (user_id = auth.uid());

-- 5) 收藏表：仅登录用户，把看图记录存进账户，随时翻阅。
--    NMC 老图约 5~6 天后失效，快照在收藏时由前端压缩转 dataURL 存入；
--    board_snap 为收藏时刻整块留言板的留言快照（JSON 文本）。
create table if not exists public.sky_watch_favorites (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  slot_key   text not null check (slot_key ~ '^[0-9]{10}$'),
  slot_label text not null,
  chart_snap text check (chart_snap is null or char_length(chart_snap) <= 1200000),
  cloud_snap text check (cloud_snap is null or char_length(cloud_snap) <= 1200000),
  message_id uuid references public.sky_watch_messages(id) on delete set null, -- 当时自己的研判
  my_guess   text,
  my_reason  text,
  board_snap text,                                                             -- 整板留言快照（JSON）
  created_at timestamptz not null default now(),
  unique (user_id, slot_key)
);
create index if not exists sky_watch_fav_user_idx on public.sky_watch_favorites (user_id, created_at desc);

-- 已建过旧版表的补列与约束（幂等）
alter table public.sky_watch_favorites add column if not exists board_snap text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sky_watch_favorites_board_snap_check') then
    alter table public.sky_watch_favorites
      add constraint sky_watch_favorites_board_snap_check
      check (board_snap is null or char_length(board_snap) <= 1200000);
  end if;
exception when others then null;
end $$;

-- 6) 收藏 RLS：完全私有，只有本人可读写
alter table public.sky_watch_favorites enable row level security;

drop policy if exists "sky watch favorites are private" on public.sky_watch_favorites;
create policy "sky watch favorites are private" on public.sky_watch_favorites
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "own sky watch favorites insert" on public.sky_watch_favorites;
create policy "own sky watch favorites insert" on public.sky_watch_favorites
  for insert to authenticated
  with check (user_id = auth.uid() and not coalesce(public.is_banned(), false));

drop policy if exists "own sky watch favorites delete" on public.sky_watch_favorites;
create policy "own sky watch favorites delete" on public.sky_watch_favorites
  for delete to authenticated using (user_id = auth.uid());

notify pgrst, 'reload schema';

-- ############################################################
-- 十一、站点设置（管理后台一键开关，如「游客免登录浏览」）
-- ############################################################

-- 1) 键值设置表：前台门禁启动时匿名也要能读到开关状态；写入仅限管理员
create table if not exists public.site_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

alter table public.site_settings enable row level security;

drop policy if exists "site settings readable" on public.site_settings;
create policy "site settings readable" on public.site_settings
  for select to anon, authenticated using (true);

drop policy if exists "admins can insert site settings" on public.site_settings;
create policy "admins can insert site settings" on public.site_settings
  for insert to authenticated with check (public.is_admin());

drop policy if exists "admins can update site settings" on public.site_settings;
create policy "admins can update site settings" on public.site_settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

notify pgrst, 'reload schema';
