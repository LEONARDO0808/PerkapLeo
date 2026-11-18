// Logout: token JWT bersifat stateless, cukup dihapus di browser.
export default function handler(req, res) {
  return res.status(200).json({ ok: true });
}
