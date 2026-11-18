import { SignJWT, jwtVerify } from 'jose';

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'perkap-secret-bawaan-ganti-bila-perlu-2026'
);

export async function signToken(user) {
  return await new SignJWT({ uid: String(user.id), name: user.name })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(SECRET);
}

export async function verifyToken(token) {
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return payload;
  } catch (e) {
    return null;
  }
}

// Ambil user dari header Authorization: Bearer <token>
export async function authUser(req) {
  const h = req.headers.authorization || req.headers.Authorization || '';
  const m = /^Bearer\s+(.+)$/.exec(h);
  if (!m) return null;
  const payload = await verifyToken(m[1].trim());
  if (!payload) return null;
  return { id: String(payload.uid), name: payload.name };
}
