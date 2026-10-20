# Site Bill Book

A billing app for small house-building contractors in Sri Lanka. Contractors make bills and running bills for labour and materials in rupees, record payments, and send PDFs or WhatsApp messages to their clients. Each contractor sees only their own records.

## Who does what

- **Administrator** logs in at `/login` and lands on `/admin`. They add each contractor with a company name (optional; the person's name is used when there is none), the contractor's name, address, phone, a login ID and a password. They can edit details, reset a password, or switch a login off. Admins see how many projects and bills each contractor has, never the bills themselves.
- **Contractor** logs in with the ID and password from the administrator and lands on `/app`, their own bill book: clients, projects, bills, quotations, payments and a running account statement. Their bill header is pre-filled from what the administrator entered, and they can change it and their password under **My business**.

## Running it

Needs Node.js 18+ and a PostgreSQL database.

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string. Tables are created on first start. |
| `ADMIN_PASSWORD` | Password for the first admin account, created on first start (8+ characters). |
| `ADMIN_USERNAME` | Login ID for that admin. Defaults to `admin`. |
| `NODE_ENV` | Set to `production` when served over HTTPS so the login cookie is marked secure. |
| `PORT` | Port to listen on. Defaults to 3000. |

```sh
npm ci
DATABASE_URL=postgres://user:pass@localhost/sitebill ADMIN_PASSWORD='choose-a-strong-one' npm start
```

## Hosting for free

1. Create a free PostgreSQL database at [Neon](https://neon.tech) and copy its connection string.
2. On [Render](https://render.com), choose **New → Blueprint** and pick this repository. `render.yaml` sets up the web service; fill in `DATABASE_URL` and `ADMIN_PASSWORD` when asked.
3. Open the Render URL, log in as `admin`, and add your first contractor.

Render's free plan sleeps when unused, so the first visit after a quiet spell takes about a minute to open. A paid plan removes that wait.

## Security notes

Passwords are stored as bcrypt hashes. Sessions are random tokens kept as SHA-256 hashes in the database, in an HTTP-only cookie. Repeated wrong logins are blocked for 15 minutes. Every data query is scoped to the logged-in contractor's account.
