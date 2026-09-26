# Ticky Track

Run `npm start`, then open http://localhost:3000. Requires Node.js 18+; no dependencies to install.

Color-coded notes, editable text, whole-note strikethrough, bulleted lists, interactive checklists, pinning, search, color filters, sorting, clipboard copying, and restorable trash. Starter notes are examples and can be edited or deleted.

Regular notes are stored as plain text in this browser's local storage. Use the private vault for sensitive information. Its contents are encrypted using Web Crypto AES-256-GCM with a random IV per save and a PBKDF2-SHA-256 key derived with 600,000 iterations and a random salt. The key stays in memory while unlocked. Lock manually or wait five minutes without keyboard/pointer activity. Reloading also locks it.

This is a local app, with no account, cloud sync, password recovery, or backup service. Clearing browser data deletes notes. Keep important information backed up elsewhere. Vault encryption protects stored contents, not an unlocked browser, compromised device, or text copied to the system clipboard. This implementation has not undergone an independent security audit.

`npm run check` checks JavaScript syntax.
