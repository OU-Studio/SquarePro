import nodemailer from "nodemailer";

export function getMailer() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || "587");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error("SMTP env vars missing (SMTP_HOST/SMTP_USER/SMTP_PASS).");
  }

  return nodemailer.createTransport({
  host,
  port,
  secure: port === 587,
  auth: { user, pass },

  // Prevent hanging forever
  connectionTimeout: 10_000, // 10s to connect
  greetingTimeout: 10_000,   // 10s for server greeting
  socketTimeout: 15_000,     // 15s per socket inactivity
});
}

export async function sendOtpEmail(to: string, code: string) {
  const from = process.env.SMTP_FROM || "SquarePro <no-reply@squarepro.co.uk>";
  const transporter = getMailer();

  await transporter.sendMail({
    from,
    to,
    subject: "Your SquarePro verification code",
    text: `Your SquarePro code is: ${code}\n\nIt expires in 10 minutes.`,
  });
}

export async function sendLicenseKeyEmail(params: {
  to: string;
  licenseKey: string;
}) {
  const { to, licenseKey } = params;

  const from = process.env.SMTP_FROM || "SquarePro <no-reply@squarepro.co.uk>";
  const transporter = getMailer();

  const snippet = `<script src="https://cdn.squarepro.co.uk/squarepro.min.js" data-squarepro-key="${licenseKey}"></script>`;

  await transporter.sendMail({
    from,
    to,
    subject: "Your SquarePro license key",
    text:
      `Here’s your SquarePro license key:\n\n` +
      `${licenseKey}\n\n` +
      `Install (Squarespace → Settings → Advanced → Code Injection → HEADER):\n\n` +
      `${snippet}\n\n` +
      `Activation:\n` +
      `1) Load once on yoursite.squarespace.com (preview domain)\n` +
      `2) Load once on your live domain\n` +
      `Your license will bind to those two domains.\n`,
  });
}