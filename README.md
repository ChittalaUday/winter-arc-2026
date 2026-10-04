# Winter Arc Tracker

A static HTML fitness tracker. Deploy the repository root to Vercel with the framework set to Other; `index.html` is the entry page. No backend or build step is required.

## Browser storage

Signup and login use local accounts with salted PBKDF2 password hashes. Accounts, goals, workouts, meals, personal records, targets, the current login, and theme are saved in local storage. The leaderboard and comparisons include accounts created on the same browser and site origin.

This is a personal browser tracker, not server-backed authentication. Data does not sync between devices, browsers, or different deployment domains. Clearing site storage removes local accounts and progress. Private browsing may discard data when closed. Existing data from the original Claude-hosted version cannot be accessed by this static site.

Workout history can be downloaded with Export CSV using the browser's native download support. Storage failures show errors rather than reporting a successful save.

## Development and checks

Serve the folder with a static HTTP server, for example `python3 -m http.server 8765`, then open `http://localhost:8765`. Use HTTPS in production for Web Crypto password hashing.

Run regression checks with Node.js 22 or newer:

```bash
node --test tests/tracker.test.cjs
```

The dependency-free tests execute the page script with browser API stubs and exercise authentication, persistence, account isolation, tracker forms, comparisons, CSV downloads, invalid input, and storage failures. They do not replace visual browser testing.
