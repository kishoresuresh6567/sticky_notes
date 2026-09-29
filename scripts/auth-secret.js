// Run locally and copy the generated value into AUTH_SESSION_SECRET. Never commit it.
process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url')+'\n');
