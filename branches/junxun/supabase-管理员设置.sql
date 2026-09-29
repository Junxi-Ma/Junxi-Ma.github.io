-- ============================================================
--  军训留言墙 · 管理员功能设置（v2）
--  用法：Supabase 后台 → 左侧 SQL Editor → New query → 整段粘贴 → Run
--  运行成功后，页面上的 置顶 / 改 / 删 / 保存寄语信件 就能用了。
-- ============================================================

-- ① 留言表增加「置顶」列
alter table wall_posts add column if not exists pinned boolean not null default false;

-- ② 存管理员改过的「寄语」和「信」（键值表）
create table if not exists site_data (
  k text primary key,
  v text,
  updated_at timestamptz default now()
);
alter table site_data enable row level security;

drop policy if exists site_data_read on site_data;
create policy site_data_read on site_data for select using (true);
drop policy if exists site_data_insert on site_data;
create policy site_data_insert on site_data for insert with check (true);
drop policy if exists site_data_update on site_data;
create policy site_data_update on site_data for update using (true);

-- ③ 直接改 / 删留言的权限（应用层的兜底通道）
alter table wall_posts   enable row level security;
alter table wall_replies enable row level security;

drop policy if exists wall_posts_update on wall_posts;
create policy wall_posts_update on wall_posts for update using (true) with check (true);
drop policy if exists wall_posts_delete on wall_posts;
create policy wall_posts_delete on wall_posts for delete using (true);
drop policy if exists wall_replies_delete on wall_replies;
create policy wall_replies_delete on wall_replies for delete using (true);

-- ④ 管理员操作函数（SECURITY DEFINER：绕过 RLS）
--    如果你的 wall_posts.id 是 uuid 类型，把下面三处的 bigint 改成 uuid。
create or replace function admin_set_pinned(p_id bigint, p_on boolean)
returns void language sql security definer set search_path = public as $$
  update wall_posts set pinned = p_on where id = p_id;
$$;

create or replace function admin_delete_post(p_id bigint)
returns void language sql security definer set search_path = public as $$
  delete from wall_replies where post_id = p_id;
  delete from wall_posts  where id = p_id;
$$;

create or replace function admin_edit_post(p_id bigint, p_content text)
returns void language sql security definer set search_path = public as $$
  update wall_posts set content = p_content where id = p_id;
$$;

grant execute on function admin_set_pinned(bigint, boolean) to anon, authenticated;
grant execute on function admin_delete_post(bigint)          to anon, authenticated;
grant execute on function admin_edit_post(bigint, text)      to anon, authenticated;

-- ⑤ 让 PostgREST 立刻刷新接口缓存（这一步很关键，
--    否则刚建好的函数会报 PGRST202「找不到函数」）
notify pgrst, 'reload schema';

-- ============================================================
--  跑完请看到最后一行提示 Success，然后回到网页刷新一次再试。
--
--  安全提醒：网页里的密钥是公开的，所以严格来说懂技术的人也能调用
--  这些管理接口。对班级留言墙通常够用；要真正防住需接 Supabase 登录。
-- ============================================================
