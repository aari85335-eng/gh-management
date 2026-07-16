/**
 * Hospital Management System - Backend Server
 * ---------------------------------------------
 * Pure Node.js (no external dependencies) HTTP server that:
 *   1. Serves the static frontend from /public
 *   2. Exposes a JSON REST API under /api for patients, doctors,
 *      appointments and authentication.
 *   3. Persists data to data/db.json (a tiny file-based "database").
 *
 * Run with:  node server.js   (or  npm start)
 * Default:   http://localhost:3000
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'data', 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// In-memory session store: token -> { username, role, expires }
const sessions = new Map();
const SESSION_TTL_MS = 1000 * 60 * 60 * 4; // 4 hours

// ---------------------------------------------------------------------------
// Small "database" helpers (JSON file on disk)
// ---------------------------------------------------------------------------
function readDB() {
  const raw = fs.readFileSync(DB_PATH, 'utf-8');
  return JSON.parse(raw);
}

function writeDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
}

function genId(prefix) {
  return `${prefix}-${crypto.randomBytes(6).toString('hex')}`;
}

function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(password + salt).digest('hex');
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------
function sendJSON(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 5 * 1024 * 1024) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function getToken(req) {
  const header = req.headers['authorization'] || '';
  const [type, token] = header.split(' ');
  if (type === 'Bearer' && token) return token;
  return null;
}

function requireAuth(req, res) {
  const token = getToken(req);
  const session = token && sessions.get(token);
  if (!session || session.expires < Date.now()) {
    sendJSON(res, 401, { error: 'Unauthorized. Please log in.' });
    return null;
  }
  // refresh sliding expiry
  session.expires = Date.now() + SESSION_TTL_MS;
  return session;
}

// ---------------------------------------------------------------------------
// Static file serving
// ---------------------------------------------------------------------------
const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, pathname) {
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(PUBLIC_DIR, decodeURIComponent(filePath));

  // Prevent path traversal outside of the public directory
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        return res.end('<h1>404 - Page Not Found</h1><a href="/">Go home</a>');
      }
      res.writeHead(500);
      return res.end('Server error');
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

// ---------------------------------------------------------------------------
// Generic CRUD helpers for a collection (patients / doctors / appointments)
// ---------------------------------------------------------------------------
function handleCollection(req, res, { collection, idParam, validate }) {
  const session = requireAuth(req, res);
  if (!session) return;

  const db = readDB();
  const list = db[collection];

  if (req.method === 'GET' && !idParam) {
    return sendJSON(res, 200, list);
  }

  if (req.method === 'GET' && idParam) {
    const item = list.find((x) => x.id === idParam);
    if (!item) return sendJSON(res, 404, { error: `${collection.slice(0, -1)} not found` });
    return sendJSON(res, 200, item);
  }

  if (req.method === 'POST') {
    return parseBody(req).then((body) => {
      const errorMsg = validate(body);
      if (errorMsg) return sendJSON(res, 400, { error: errorMsg });
      const newItem = { id: genId(collection[0]), ...body, createdAt: new Date().toISOString() };
      list.push(newItem);
      writeDB(db);
      sendJSON(res, 201, newItem);
    }).catch((err) => sendJSON(res, 400, { error: err.message }));
  }

  if (req.method === 'PUT' && idParam) {
    return parseBody(req).then((body) => {
      const index = list.findIndex((x) => x.id === idParam);
      if (index === -1) return sendJSON(res, 404, { error: `${collection.slice(0, -1)} not found` });
      const errorMsg = validate(body, true);
      if (errorMsg) return sendJSON(res, 400, { error: errorMsg });
      list[index] = { ...list[index], ...body, id: idParam };
      writeDB(db);
      sendJSON(res, 200, list[index]);
    }).catch((err) => sendJSON(res, 400, { error: err.message }));
  }

  if (req.method === 'DELETE' && idParam) {
    const index = list.findIndex((x) => x.id === idParam);
    if (index === -1) return sendJSON(res, 404, { error: `${collection.slice(0, -1)} not found` });
    const [removed] = list.splice(index, 1);
    writeDB(db);
    return sendJSON(res, 200, { message: 'Deleted successfully', removed });
  }

  sendJSON(res, 405, { error: 'Method not allowed' });
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------
function validatePatient(body, isUpdate) {
  if (!isUpdate) {
    if (!body.name || !body.age || !body.gender) {
      return 'name, age and gender are required';
    }
  }
  return null;
}

function validateDoctor(body, isUpdate) {
  if (!isUpdate) {
    if (!body.name || !body.specialization) {
      return 'name and specialization are required';
    }
  }
  return null;
}

function validateAppointment(body, isUpdate) {
  if (!isUpdate) {
    if (!body.patientId || !body.doctorId || !body.date || !body.time) {
      return 'patientId, doctorId, date and time are required';
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Route table
// ---------------------------------------------------------------------------
async function handleApi(req, res, pathname) {
  const parts = pathname.split('/').filter(Boolean); // ['api','patients','p-1']
  const resource = parts[1];
  const id = parts[2];

  // ---- Auth ----
  if (resource === 'auth' && parts[2] === 'login' && req.method === 'POST') {
    const body = await parseBody(req).catch(() => ({}));
    const db = readDB();
    const user = db.users.find((u) => u.username === body.username);
    if (!user || hashPassword(body.password || '', user.salt) !== user.password) {
      return sendJSON(res, 401, { error: 'Invalid username or password' });
    }
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, { username: user.username, role: user.role, expires: Date.now() + SESSION_TTL_MS });
    return sendJSON(res, 200, { token, user: { username: user.username, name: user.name, role: user.role } });
  }

  if (resource === 'auth' && parts[2] === 'logout' && req.method === 'POST') {
    const token = getToken(req);
    if (token) sessions.delete(token);
    return sendJSON(res, 200, { message: 'Logged out' });
  }

  if (resource === 'auth' && parts[2] === 'me' && req.method === 'GET') {
    const session = requireAuth(req, res);
    if (!session) return;
    return sendJSON(res, 200, { username: session.username, role: session.role });
  }

  // ---- Dashboard stats ----
  if (resource === 'stats' && req.method === 'GET') {
    const session = requireAuth(req, res);
    if (!session) return;
    const db = readDB();
    const today = new Date().toISOString().slice(0, 10);
    return sendJSON(res, 200, {
      totalPatients: db.patients.length,
      totalDoctors: db.doctors.length,
      totalAppointments: db.appointments.length,
      appointmentsToday: db.appointments.filter((a) => a.date === today).length,
      admitted: db.patients.filter((p) => p.admissionStatus === 'Admitted').length,
    });
  }

  // ---- Patients ----
  if (resource === 'patients') {
    return handleCollection(req, res, { collection: 'patients', idParam: id, validate: validatePatient });
  }

  // ---- Doctors ----
  if (resource === 'doctors') {
    return handleCollection(req, res, { collection: 'doctors', idParam: id, validate: validateDoctor });
  }

  // ---- Appointments ----
  if (resource === 'appointments') {
    return handleCollection(req, res, { collection: 'appointments', idParam: id, validate: validateAppointment });
  }

  sendJSON(res, 404, { error: 'API route not found' });
}

// ---------------------------------------------------------------------------
// Server bootstrap
// ---------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // Basic CORS / preflight support
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    return res.end();
  }

  if (pathname.startsWith('/api/')) {
    handleApi(req, res, pathname).catch((err) => {
      console.error(err);
      sendJSON(res, 500, { error: 'Internal server error' });
    });
  } else {
    serveStatic(req, res, pathname);
  }
});

server.listen(PORT, () => {
  console.log(`\nHospital Management System running at http://localhost:${PORT}`);
  console.log('Default login -> username: admin | password: admin123\n');
});
