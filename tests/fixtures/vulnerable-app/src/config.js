// Deliberately insecure configuration (fake values for tests).
const API_KEY = 'Zx81Kq0pLmW73vTr5YbN2cHd';
const dbUrl = 'mongodb://admin:Wk3Rm9Tq2LxZ@localhost:27017/app';

module.exports = { API_KEY, dbUrl, jwtSecret: process.env.JWT_SECRET };
