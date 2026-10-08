// Reads the 6-digit sign-in code that Supabase's local Mailpit captured for EMAIL.
// Maestro exposes `http` and the flow's `env` values (EMAIL, MAILPIT_URL) to runScript.
var base = MAILPIT_URL;
var list = JSON.parse(
  http.get(base + '/api/v1/search?query=' + encodeURIComponent('to:' + EMAIL)).body,
);
if (!list.messages || list.messages.length === 0) {
  throw new Error('No email found for ' + EMAIL);
}
var message = JSON.parse(http.get(base + '/api/v1/message/' + list.messages[0].ID).body);
var match = /\b(\d{6})\b/.exec(message.Text || message.HTML || '');
if (!match) {
  throw new Error('No 6-digit code in the email for ' + EMAIL);
}
output.code = match[1];
