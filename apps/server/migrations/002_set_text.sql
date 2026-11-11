-- Rooms now hold one shared text value. The earlier kinds stay allowed so
-- operations stored before this change remain valid rows.
ALTER TABLE operations DROP CONSTRAINT IF EXISTS operations_kind_check;
ALTER TABLE operations ADD CONSTRAINT operations_kind_check
    CHECK (kind IN ('set_text', 'set_title', 'set_status', 'set_severity'));
