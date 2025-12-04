/**
 * Diagnostic script to check Supabase configuration
 * Run with: node check-supabase.js
 */

// For local testing, you can set these here temporarily
const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY || '';

console.log('🔍 Checking Supabase Configuration...\n');

console.log('1. Environment Variables:');
console.log(`   REACT_APP_SUPABASE_URL: ${SUPABASE_URL ? '✅ Set' : '❌ Not set'}`);
console.log(`   REACT_APP_SUPABASE_ANON_KEY: ${SUPABASE_ANON_KEY ? '✅ Set' : '❌ Not set'}`);

if (SUPABASE_URL) {
  console.log(`   URL: ${SUPABASE_URL}`);
}

console.log('\n2. What to check in Supabase Dashboard:');
console.log('   □ Authentication → Providers → Email → "Enable Email provider" is ON');
console.log('   □ Authentication → Providers → Email → "Confirm email" is CHECKED');
console.log('   □ Authentication → Email Templates → "Confirm signup" is configured');
console.log('   □ Authentication → URL Configuration → Redirect URLs include your domain');
console.log('   □ Settings → API → Check URL and anon key match your .env.local');

console.log('\n3. Common Issues:');
console.log('   • Email in spam folder (check junk mail)');
console.log('   • Rate limiting (wait 60 seconds between attempts)');
console.log('   • Wrong email address (must be @opifiresafe.com)');
console.log('   • Redirect URLs not configured');
console.log('   • Email provider not enabled in Supabase');

console.log('\n4. Quick Tests:');
console.log('   a) Check Supabase Dashboard → Authentication → Users');
console.log('      - See if your user was created (will show "email not confirmed")');
console.log('   b) If user exists, you can manually confirm via dashboard');
console.log('      - Click on user → Send magic link (alternative to confirmation)');
console.log('   c) Or temporarily disable email confirmation for testing');
console.log('      - Authentication → Providers → Email → Uncheck "Confirm email"');
console.log('      - (Remember to re-enable for production!)');

console.log('\n5. Alternative Solution:');
console.log('   If emails consistently fail, you can:');
console.log('   • Use Magic Link authentication instead');
console.log('   • Disable email confirmation temporarily for testing');
console.log('   • Check Supabase logs for email delivery errors');

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.log('\n⚠️  Supabase is not configured!');
  console.log('   Either:');
  console.log('   1. Copy .env.local.example to .env.local and add your credentials');
  console.log('   2. Or use the deployed app which has credentials in Vercel');
}

console.log('\n📞 Need Help?');
console.log('   Check the full guide in AUTH_FIXES.md');
console.log('   Or visit: https://supabase.com/docs/guides/auth/auth-email\n');
