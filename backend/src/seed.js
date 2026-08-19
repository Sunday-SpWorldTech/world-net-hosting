require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');

async function seedAdmin() {
  const [, , emailArg, passwordArg, nameArg] = process.argv;
  const email = String(emailArg || '').trim().toLowerCase();
  const password = String(passwordArg || '');
  const name = String(nameArg || 'World Net Hosting Admin').trim();
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is missing');
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Usage: npm run seed -- admin@example.com StrongPassword "Admin Name"');
  if (password.length < 12) throw new Error('Admin password must contain at least 12 characters');
  await mongoose.connect(process.env.MONGODB_URI, { maxPoolSize: 5, serverSelectionTimeoutMS: 10000 });
  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await User.findOne({ email });
  if (existing) { existing.name = name; existing.passwordHash = passwordHash; existing.role = 'admin'; await existing.save(); console.log(`Admin updated: ${email}`); }
  else { await User.create({ name, email, passwordHash, role: 'admin' }); console.log(`Admin created: ${email}`); }
  await mongoose.disconnect();
}
seedAdmin().catch((error) => { console.error(error.message); process.exit(1); });
