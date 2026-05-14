import { google } from 'googleapis';
import { ObjectId } from 'mongodb';
import { getDb } from './mongo.js';
import { decrypt } from './crypto.js';
import { config } from '../config/config.js';

function authClientFromIntegration(integration) {
  const oauth2 = new google.auth.OAuth2(config.GGLCID, config.GGLSEC, `${config.DOMAIN}/auth/google/callback`);
  oauth2.setCredentials({ refresh_token: decrypt(integration.refreshToken) });
  return oauth2;
}

/** Pull events for the family's primary Google calendar into the local events collection. */
export async function syncFamilyGoogleEvents(familyId) {
  const db = getDb();
  const integrations = await db.collection('integrations').find({ familyId, provider: 'google' }).toArray();
  if (!integrations.length) return { synced: 0, families: 0 };

  let synced = 0;
  for (const integ of integrations) {
    const auth = authClientFromIntegration(integ);
    const cal = google.calendar({ version: 'v3', auth });

    const params = { calendarId: 'primary', singleEvents: true, maxResults: 250 };
    if (integ.syncToken) params.syncToken = integ.syncToken;
    else params.timeMin = new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString();

    let pageToken;
    let nextSyncToken;
    do {
      const { data } = await cal.events.list({ ...params, pageToken });
      for (const ev of data.items || []) {
        if (ev.status === 'cancelled') {
          await db.collection('events').deleteOne({ source: 'google', externalId: ev.id, familyId });
          continue;
        }
        await db.collection('events').updateOne(
          { source: 'google', externalId: ev.id, familyId },
          {
            $set: {
              familyId,
              source: 'google',
              externalId: ev.id,
              userId: integ.userId,
              title: ev.summary || '(no title)',
              description: ev.description || '',
              start: ev.start?.dateTime || ev.start?.date,
              end: ev.end?.dateTime || ev.end?.date,
              allDay: !ev.start?.dateTime,
              location: ev.location || '',
              attendees: (ev.attendees || []).map(a => a.email).filter(Boolean),
              syncedAt: new Date(),
            },
            $setOnInsert: { createdAt: new Date() },
          },
          { upsert: true }
        );
        synced++;
      }
      pageToken = data.nextPageToken;
      if (data.nextSyncToken) nextSyncToken = data.nextSyncToken;
    } while (pageToken);

    if (nextSyncToken) {
      await db.collection('integrations').updateOne(
        { _id: integ._id },
        { $set: { syncToken: nextSyncToken, lastSyncAt: new Date() } }
      );
    }
  }

  return { synced, families: integrations.length };
}

/** Push a native event to the user's Google primary calendar. */
export async function pushEventToGoogle({ familyId, userId, event }) {
  const db = getDb();
  const integ = await db.collection('integrations').findOne({ familyId, provider: 'google', userId: new ObjectId(userId) });
  if (!integ) return null;

  const auth = authClientFromIntegration(integ);
  const cal = google.calendar({ version: 'v3', auth });
  const { data } = await cal.events.insert({
    calendarId: 'primary',
    requestBody: {
      summary: event.title,
      description: event.description,
      start: event.allDay ? { date: event.start } : { dateTime: event.start },
      end: event.allDay ? { date: event.end } : { dateTime: event.end },
      location: event.location,
    },
  });
  return data.id;
}
