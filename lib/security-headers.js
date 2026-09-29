// Match these headers in vercel.json so local development and deployment behave alike.
// Google Identity Services injects button CSS and inline sizing styles.
// Allow inline styles only; scripts still require an explicitly allowed source.
module.exports={
  'Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style; script-src 'self' https://accounts.google.com/gsi/client; connect-src 'self' https://accounts.google.com/gsi/; frame-src https://accounts.google.com/gsi/; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  'Cross-Origin-Opener-Policy':'same-origin-allow-popups',
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'strict-origin-when-cross-origin'
};
