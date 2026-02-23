import crypto from "crypto";

export function generate6DigitCode() {
  const n = crypto.randomInt(0, 1000000);
  return String(n).padStart(6, "0");
}

export function hashCode(email: string, code: string) {
  const secret = process.env.OTP_SECRET || "";
  if (!secret) throw new Error("Missing OTP_SECRET env var.");
  return crypto.createHmac("sha256", secret).update(`${email}:${code}`).digest("hex");
}