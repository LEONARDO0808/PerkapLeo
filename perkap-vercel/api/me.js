import { authUser } from '../lib/auth.js';

export default async function handler(req, res) {
  const u = await authUser(req);
  if (!u) return res.status(401).json({ error: 'Silakan login' });
  return res.status(200).json({ user: { id: u.id, username: u.name } });
}
