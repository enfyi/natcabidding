begin;
alter table public.round_announcements
  drop constraint round_announcements_title_check,
  drop constraint round_announcements_public_link_label_check,
  drop constraint round_announcements_member_link_label_check,
  drop constraint round_announcements_public_link_url_check,
  drop constraint round_announcements_member_link_url_check,
  alter column title set default '',
  alter column public_link_label set default '',
  alter column member_link_label set default '',
  add constraint round_announcements_title_check check (length(trim(title)) <= 300),
  add constraint round_announcements_public_link_label_check check (length(trim(public_link_label)) <= 100),
  add constraint round_announcements_member_link_label_check check (length(trim(member_link_label)) <= 100),
  add constraint round_announcements_public_link_url_check check (length(public_link_url) <= 2000 and (trim(public_link_label) = '' or length(public_link_url) > 0)),
  add constraint round_announcements_member_link_url_check check (length(member_link_url) <= 2000 and (trim(member_link_label) = '' or length(member_link_url) > 0));
commit;
