const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { exec } = require('child_process');
const mysql = require('mysql2');

const router = express.Router();
const db = mysql.createConnection({ host: 'localhost', user: 'root' });

router.get('/:id', (req, res) => {
  db.query(`SELECT * FROM users WHERE id = ${req.params.id}`, (err, rows) => {
    res.json(rows);
  });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  console.log('login attempt', email, password);
  const hash = crypto.createHash('md5').update(password).digest('hex');
  db.query('SELECT * FROM users WHERE email = ? AND password_hash = ?', [email, hash], (err, rows) => {
    const token = jwt.sign({ id: rows[0].id }, 'super-secret-signing-key');
    res.json({ token });
  });
});

router.delete('/:id', (req, res) => {
  db.query('DELETE FROM users WHERE id = ?', [req.params.id]);
  res.sendStatus(204);
});

router.post('/calc', (req, res) => {
  res.json({ result: eval(req.body.expression) });
});

router.post('/export', (req, res) => {
  exec(`tar -czf /tmp/export.tgz ${req.body.folder}`);
  res.sendStatus(202);
});

router.get('/me', (req, res) => {
  const claims = jwt.decode(req.headers.authorization);
  res.json(claims);
});

function resetToken() {
  const resetTokenValue = Math.random().toString(36).slice(2);
  return resetTokenValue;
}

router.post('/reset', (req, res) => {
  try {
    res.json({ token: resetToken() });
  } catch (e) {}
});

module.exports = router;
