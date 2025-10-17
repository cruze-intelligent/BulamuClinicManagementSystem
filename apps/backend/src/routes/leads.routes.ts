import { FastifyInstance } from 'fastify';
import { google } from 'googleapis';

export async function leadsRoutes(fastify: FastifyInstance) {
  
  // Submit demo request to Google Sheets
  fastify.post('/leads', async (request, reply) => {
    const { clinicName, contactPerson, phone, email, preferredPlan, message } = request.body as any;

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
        range: 'Sheet1!A:G',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [[
            new Date().toISOString(),
            clinicName,
            contactPerson,
            phone,
            email,
            preferredPlan,
            message || ''
          ]]
        }
      });

      return { success: true, message: 'Lead saved successfully' };
    } catch (error: any) {
      console.error('Google Sheets Error:', error);
      return reply.status(500).send({ error: 'Failed to save lead' });
    }
  });
}