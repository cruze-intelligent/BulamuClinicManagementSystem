import { FastifyInstance } from 'fastify';
import { google } from 'googleapis';
import { sendMail, newAccessRequestEmail, ADMIN_NOTIFY_EMAIL } from '../lib/mailer';

export async function leadsRoutes(fastify: FastifyInstance) {

  // An evaluation access request: recorded in the Google Sheet and emailed to
  // the operator. Either is enough - a Sheets outage (or missing Sheets
  // credentials) must not lose the request or keep it from the operator.
  fastify.post('/leads', async (request, reply) => {
    const { facilityName, clinicName, facilityType, contactPerson, phone, email, preferredPlan, message } = request.body as any;
    const name = facilityName || clinicName;

    const [sheet, mail] = await Promise.allSettled([
      (async () => {
        const auth = new google.auth.GoogleAuth({
          credentials: {
            client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
          },
          scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        const sheets = google.sheets({ version: 'v4', auth });
        await sheets.spreadsheets.values.append({
          spreadsheetId: process.env.GOOGLE_SHEET_ID,
          range: 'Sheet1!A:H',
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [[
              new Date().toISOString(),
              name,
              facilityType || 'Clinic',
              contactPerson,
              phone,
              email,
              preferredPlan,
              message || ''
            ]]
          }
        });
      })(),
      sendMail({
        to: ADMIN_NOTIFY_EMAIL,
        subject: `[Bulamu] New access request - ${name}`,
        html: newAccessRequestEmail(name, contactPerson, phone, email),
      }),
    ]);

    const sheetOk = sheet.status === 'fulfilled';
    const mailOk = mail.status === 'fulfilled' && mail.value.sent;
    if (!sheetOk) fastify.log.error((sheet as PromiseRejectedResult).reason, 'Access request not saved to Google Sheets');

    if (!sheetOk && !mailOk) {
      return reply.status(500).send({ error: 'Failed to save lead' });
    }
    return { success: true, message: 'Lead saved successfully' };
  });
}
