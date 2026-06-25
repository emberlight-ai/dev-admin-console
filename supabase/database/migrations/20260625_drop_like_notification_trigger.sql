-- The old "New Like Insert" webhook fired the retired like-notification function
-- on every match_requests INSERT ("New Like! · X liked you"). Now that the nearby
-- dispatcher creates match_requests and sends its own invitation push, this trigger
-- produced a duplicate notification. Drop it.
drop trigger if exists "New Like Insert" on public.match_requests;
