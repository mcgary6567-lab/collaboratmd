-- Extra intake on the contact form.
--
-- Investor submissions carry qualifying detail the generic form has no place
-- for, and every submission carries where it came from so an outbound campaign
-- can be measured. All nullable: a support request fills none of them.
ALTER TABLE contact_messages ADD COLUMN IF NOT EXISTS fund text;
ALTER TABLE contact_messages ADD COLUMN IF NOT EXISTS stage text;
ALTER TABLE contact_messages ADD COLUMN IF NOT EXISTS check_size text;
ALTER TABLE contact_messages ADD COLUMN IF NOT EXISTS source jsonb;

CREATE INDEX IF NOT EXISTS contact_messages_source_campaign_idx
  ON contact_messages ((source ->> 'utm_campaign'));
