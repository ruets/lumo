-- The coin ledger is append-only: entries can never be modified or deleted.
-- A correction is a new entry (reason = 'undo' or 'adjustment').
CREATE TRIGGER `ledger_entries_no_update` BEFORE UPDATE ON `ledger_entries`
BEGIN
	SELECT RAISE(ABORT, 'ledger_entries is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `ledger_entries_no_delete` BEFORE DELETE ON `ledger_entries`
BEGIN
	SELECT RAISE(ABORT, 'ledger_entries is append-only');
END;
