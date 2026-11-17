-- Le journal des pièces est en ajout seul : aucune modification ni suppression d'écriture.
-- Une correction passe par une nouvelle écriture (reason = 'undo' ou 'adjustment').
CREATE TRIGGER `ledger_entries_no_update` BEFORE UPDATE ON `ledger_entries`
BEGIN
	SELECT RAISE(ABORT, 'ledger_entries est en ajout seul');
END;
--> statement-breakpoint
CREATE TRIGGER `ledger_entries_no_delete` BEFORE DELETE ON `ledger_entries`
BEGIN
	SELECT RAISE(ABORT, 'ledger_entries est en ajout seul');
END;
