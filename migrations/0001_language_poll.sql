-- Only an anonymous, poll-specific cookie hash and an allowed choice are kept.
-- No IP address, user agent, name, email, free text or per-vote timestamp.
CREATE TABLE language_poll_votes (
  poll_id TEXT NOT NULL CHECK (poll_id = 'anvil-next-language-v1'),
  voter_hash TEXT NOT NULL CHECK (
    length(voter_hash) = 64 AND voter_hash NOT GLOB '*[^0-9a-f]*'
  ),
  option_id TEXT NOT NULL CHECK (
    option_id IN ('de', 'fr', 'pt-br', 'pl', 'it', 'uk', 'tr', 'zh-cn', 'ja', 'ko', 'other')
  ),
  PRIMARY KEY (poll_id, voter_hash)
) WITHOUT ROWID;

-- The primary key's voter_hash is also present in this WITHOUT ROWID index,
-- covering the aggregate query without a second lookup of individual votes.
CREATE INDEX language_poll_votes_by_option
  ON language_poll_votes (poll_id, option_id);
