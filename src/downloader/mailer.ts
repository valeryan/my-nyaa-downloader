import nodemailer from "nodemailer";
import { getAppConfig } from "./configuration.ts";
import { TrackerGroup } from "./types.ts";

const appConfig = getAppConfig();

/**
 * Function to send email report with the collected information.
 * @param trackerGroups the tracker groups to send in the email
 */
export const sendEmailReport = async (trackerGroups: TrackerGroup) => {
  const transporter = nodemailer.createTransport({
    host: appConfig.smtp.host,
    port: appConfig.smtp.port,
    secure: appConfig.smtp.secure,
    auth: {
      user: appConfig.smtp.user,
      pass: appConfig.smtp.password,
    },
  });

  let totalEpisodes = 0;
  const emailBody = `
    <h1>Nyaa Downloader Report</h1>
    ${Object.entries(trackerGroups)
      .map(([group, seriesData]) => {
        const seriesList = seriesData
          .map(({ title, newEpisodes }) => {
            totalEpisodes += newEpisodes;
            return `<li>${title}: ${newEpisodes} new episode(s)</li>`;
          })
          .join("");

        return `
          <h2>${group}</h2>
          ${
            seriesData.length > 0
              ? `<p>The following series have new episodes:</p>
                <ul>${seriesList}</ul>`
              : "<p>No new episodes found.</p>"
          }`;
      })
      .join("")}`;

  const mailOptions = {
    from: appConfig.fromEmail,
    to: appConfig.reportEmail,
    subject: `Nyaa Downloader Report - ${totalEpisodes} new episode(s)`,
    html: emailBody,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log("Email report sent successfully.");
  } catch (error) {
    console.error("Error sending email report:", error);
  }
};
