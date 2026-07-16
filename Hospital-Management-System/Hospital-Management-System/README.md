# MedCare — Hospital Management System (Single-File Frontend)

A hospital management web app where:

- **Frontend = one file:** `public/index.html` contains ALL of the HTML, CSS (`<style>`), and JavaScript (`<script>`) — nothing else to open.
- **Backend = one file:** `server.js`, a Node.js server using only built-in modules (`http`, `fs`, `crypto`) — **zero npm installs required**.
- **Storage:** a JSON file (`data/db.json`) acting as a lightweight database.

## Features

- Login / session authentication (token-based)
- Dashboard with live stats
- Patients: add, edit, delete, search
- Doctors: add, edit, delete, search
- Appointments: book, edit, delete, filter by status, search
- Single-page app: all views (login, dashboard, patients, doctors, appointments) live inside one HTML file and switch instantly with JavaScript — no page reloads

## Requirements

Just [Node.js](https://nodejs.org/) v14+. No `npm install` needed.

## Run it

```bash
node server.js
```

Then open **http://localhost:3000** and sign in with:

- **Username:** `admin`
- **Password:** `admin123`

To use a different port:

```bash
PORT=4000 node server.js
```

## Project structure

```
hospital-single/
├── server.js          # backend — Node.js, no dependencies
├── package.json
├── data/
│   └── db.json         # data store, updates as you use the app
└── public/
    └── index.html       # the ENTIRE frontend — HTML + CSS + JS in one file
```

## API reference

All `/api` routes except `/api/auth/login` need `Authorization: Bearer <token>` (from the login response).

| Method | Endpoint                | Description             |
|--------|--------------------------|--------------------------|
| POST   | `/api/auth/login`         | Log in, returns a token  |
| POST   | `/api/auth/logout`        | Invalidate current token |
| GET    | `/api/stats`               | Dashboard counters        |
| GET/POST/PUT/DELETE | `/api/patients[/:id]` | Patient CRUD |
| GET/POST/PUT/DELETE | `/api/doctors[/:id]` | Doctor CRUD |
| GET/POST/PUT/DELETE | `/api/appointments[/:id]` | Appointment CRUD |

## Notes

- Passwords are hashed (SHA-256 + salt) before comparison.
- This is a learning/demo-grade auth setup. For production, use a real database, bcrypt/argon2, HTTPS, and rate limiting.
