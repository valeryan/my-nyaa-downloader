import dotenv from "dotenv";
import { AppConfig, SmtpConfig } from "./types.ts";

dotenv.config(); // Load environment variables from .env file

const getSmtpConfig = (): SmtpConfig => {
  return {
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_SECURE === "true" || false,
    user: process.env.SMTP_USER || "",
    password: process.env.SMTP_PASSWORD || "",
  };
};

const getReportEmail = (): string => {
  return process.env.RECIPIENT_EMAIL || "";
};

const getFromEmail = (): string => {
  const from = process.env.FROM_EMAIL || "";
  return `"Nyaa Downloader" <${from}>`;
};

export const getAppConfig = (): AppConfig => {
  return {
    smtp: getSmtpConfig(),
    reportEmail: getReportEmail(),
    fromEmail: getFromEmail(),
  };
};
