-- Text is now edited character by character with insert_text and
-- delete_text. Earlier kinds stay allowed so existing rows remain valid.
ALTER TABLE operations DROP CONSTRAINT IF EXISTS operations_kind_check;
ALTER TABLE operations ADD CONSTRAINT operations_kind_check
    CHECK (kind IN (
        'insert_text', 'delete_text',
        'set_text', 'set_title', 'set_status', 'set_severity'
    ));
