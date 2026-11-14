-- Reversa de 20261115230000_studio_invite_links.sql. Las membresías que se
-- crearon con un enlace quedan como están (son vínculos reales del estudio);
-- solo se pierde el registro de qué enlace usó cada artista.

begin;

drop function if exists public.redeem_studio_invite_link(text, uuid);
drop function if exists public.issue_studio_invite_link(uuid, uuid, text, uuid, text, boolean, integer, integer, text, text, text);
drop table if exists public.studio_invite_link_uses;
drop table if exists public.studio_invite_links;
drop function if exists private.release_studio_invite_link_use();

commit;
