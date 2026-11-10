const express = require('express');
const cors = require('cors');
const usersRouter = require('./routes/users');

const app = express();
app.use(express.json());
app.use(cors({ origin: '*', credentials: true }));
app.use('/api/users', usersRouter);

app.get('/debug/env', (req, res) => {
  res.json(process.env);
});

app.listen(3000, () => console.log('listening'));
