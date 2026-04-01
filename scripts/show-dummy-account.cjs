const fs = require('node:fs');
const path = require('node:path');

const fixturePath = path.join(__dirname, '..', 'src', 'database', 'seeds', 'dummy-users.json');

if (!fs.existsSync(fixturePath)) {
  console.error('Dummy fixture file not found:', fixturePath);
  process.exit(1);
}

const fixtureRaw = fs.readFileSync(fixturePath, 'utf8');
const fixture = JSON.parse(fixtureRaw);

console.log('Dummy account fixture for manual testing');
console.log('----------------------------------------');
console.log(JSON.stringify(fixture, null, 2));

console.log('\nSuggested login payload (password not logged):');
console.log(
  JSON.stringify(
    {
      email: fixture.users[0]?.email,
      // Intentionally do not log the actual password to avoid exposing sensitive data
      password: '<redacted>',
    },
    null,
    2,
  ),
);
