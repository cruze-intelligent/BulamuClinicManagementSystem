import { FastifyInstance } from 'fastify';
import { google } from 'googleapis';
import { sendMail, newAccessRequestEmail, ADMIN_NOTIFY_EMAIL } from '../lib/mailer';

export async function leadsRoutes(fastify: FastifyInstance) {
  
  // Submit access request to Google Sheets
  fastify.post('/leads', async (request, reply) => {
    const { facilityName, clinicName, facilityType, contactPerson, phone, email, preferredPlan, message } = request.body as any;

    try {
      // Set up Google Sheets auth
      const auth = new google.auth.GoogleAuth({
        credentials: {
          client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
          private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        },
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });

      const sheets = google.sheets({ version: 'v4', auth });

      // Append row to sheet
      await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: 'Sheet1!A:H',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [[
            new Date().toISOString(),
            facilityName || clinicName,
            facilityType || 'Clinic',
            contactPerson,
            phone,
            email,
            preferredPlan,
            message || ''
          ]]
        }
      });

      await sendMail({
        to: ADMIN_NOTIFY_EMAIL,
        subject: `New Bulamu access request - ${facilityName || clinicName}`,
        html: newAccessRequestEmail(facilityName || clinicName, contactPerson, phone, email),
      });

      return { success: true, message: 'Lead saved successfully' };
    } catch (error: any) {
      console.error('Google Sheets Error:', error);
      return reply.status(500).send({ error: 'Failed to save lead' });
    }
  });
}
