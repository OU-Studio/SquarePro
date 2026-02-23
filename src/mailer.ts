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
    secure: port === 465,
    auth: { user, pass },
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