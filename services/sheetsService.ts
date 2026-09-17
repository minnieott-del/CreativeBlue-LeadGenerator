
import { Company } from '../types';

const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';
const DISCOVERY_DOC = 'https://sheets.googleapis.com/$discovery/rest?version=v4';

// Types for global google objects
declare global {
  interface Window {
    gapi: any;
    google: any;
  }
}

let tokenClient: any;
let gapiInited = false;
let gisInited = false;

export const initializeGapiClient = async () => {
  if (gapiInited) return;
  
  await new Promise<void>((resolve, reject) => {
    window.gapi.load('client', { callback: resolve, onerror: reject });
  });
  
  await window.gapi.client.init({
    discoveryDocs: [DISCOVERY_DOC],
  });
  
  gapiInited = true;
};

export const initializeGoogleIdentityClient = (clientId: string) => {
    if (gisInited && tokenClient) return tokenClient;

    tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPES,
        callback: '', // defined at request time
    });
    
    gisInited = true;
    return tokenClient;
};

const getSheetTitleFromGid = async (spreadsheetId: string, gid: number): Promise<string> => {
    const response = await window.gapi.client.sheets.spreadsheets.get({
        spreadsheetId: spreadsheetId,
        fields: 'sheets.properties',
    });
    
    const sheets = response.result.sheets;
    const sheet = sheets.find((s: any) => s.properties.sheetId === gid);
    
    return sheet ? sheet.properties.title : '';
};

const extractSpreadsheetDetails = (url: string) => {
    const regex = /\/d\/([a-zA-Z0-9-_]+)/;
    const match = url.match(regex);
    const spreadsheetId = match ? match[1] : null;

    let gid = 0;
    const gidMatch = url.match(/[#&?]gid=(\d+)/);
    if (gidMatch) {
        gid = parseInt(gidMatch[1], 10);
    }

    return { spreadsheetId, gid };
};

const ensureAuthorized = async (clientId: string): Promise<void> => {
    await initializeGapiClient();
    initializeGoogleIdentityClient(clientId);

    if (window.gapi.client.getToken()) return;

    return new Promise<void>((resolve, reject) => {
        let isResolved = false;
        const timer = setTimeout(() => {
            if (!isResolved) {
                isResolved = true;
                reject('AUTH_TIMEOUT');
            }
        }, 60000);

        tokenClient.callback = (resp: any) => {
            if (isResolved) return;
            clearTimeout(timer);
            isResolved = true;
            if (resp.error) reject(resp);
            else resolve();
        };
        tokenClient.requestAccessToken({ prompt: '' });
    });
};

export const fetchExistingCompanyNames = async (
    sheetUrl: string,
    clientId: string
): Promise<string[]> => {
    try {
        await ensureAuthorized(clientId);
        const { spreadsheetId, gid } = extractSpreadsheetDetails(sheetUrl);
        if (!spreadsheetId) return [];

        let range = 'A:A';
        const sheetTitle = await getSheetTitleFromGid(spreadsheetId, gid);
        if (sheetTitle) {
            range = `'${sheetTitle}'!A:A`;
        }

        const response = await window.gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: spreadsheetId,
            range: range,
        });

        const rows = response.result.values;
        if (!rows || rows.length === 0) return [];
        
        // Return unique, trimmed non-empty names from the first column
        return Array.from(new Set(rows.flat().map((name: any) => String(name).trim()).filter(Boolean)));
    } catch (error) {
        console.warn("Failed to fetch existing company names:", error);
        return [];
    }
};

export const exportToGoogleSheets = async (
    companies: Company[], 
    sheetUrl: string, 
    clientId: string
): Promise<void> => {
    if (!companies || companies.length === 0) throw new Error("No data to export");
    if (!sheetUrl) throw new Error("Sheet URL is missing");
    if (!clientId) throw new Error("Google Client ID is missing");

    await ensureAuthorized(clientId);

    const { spreadsheetId, gid } = extractSpreadsheetDetails(sheetUrl);
    if (!spreadsheetId) throw new Error("Invalid Google Sheet URL");

    let range = 'A1';
    try {
        const sheetTitle = await getSheetTitleFromGid(spreadsheetId, gid);
        if (sheetTitle) {
            range = `'${sheetTitle}'!A1`;
        }
    } catch (e) {
        console.warn("Could not fetch sheet metadata, defaulting to first sheet append.", e);
    }

    const values = companies.map(c => [
        c.companyName,
        c.companyDescription,
        c.websiteUrl,
        c.industry,
        c.headquartersState,
        c.contactName,
        c.contactTitle,
        c.emailAddress,
        c.founderName,
        c.founderEmail,
        c.latestNews,
        c.linkedinUrl,
        c.emailDraft?.subject || '',
        c.emailDraft?.body || ''
    ]);

    const body = {
        values: values,
    };

    await window.gapi.client.sheets.spreadsheets.values.append({
        spreadsheetId: spreadsheetId,
        range: range,
        valueInputOption: 'USER_ENTERED',
        resource: body,
    });
};
