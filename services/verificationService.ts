
import { Company } from '../types';

const checkUrlExists = async (url: string): Promise<boolean> => {
    if (!url) return false;
    // Ensure URL has protocol for fetch
    let targetUrl = url;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        targetUrl = `https://${url}`;
    }

    try {
        const controller = new AbortController();
        // Timeout to 5000ms
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        // Using no-cors allows us to ping the server even if it doesn't explicitly allow CORS.
        await fetch(targetUrl, { 
            method: 'HEAD', 
            mode: 'no-cors', 
            signal: controller.signal 
        });
        clearTimeout(timeoutId);
        return true;
    } catch (error) {
        return false;
    }
};

const checkMxRecord = async (domain: string): Promise<boolean> => {
    try {
        // Use Google Public DNS API to check for MX records.
        const mxResponse = await fetch(`https://dns.google/resolve?name=${domain}&type=MX`);
        const mxData = await mxResponse.json();
        
        if (mxData.Status === 0 && mxData.Answer && mxData.Answer.length > 0) {
            return true;
        }
        
        return false;
    } catch (error) {
        console.warn(`DNS check failed for ${domain}`, error);
        return false;
    }
};

const checkForSaleSignatures = async (domain: string): Promise<boolean> => {
    try {
        // Check NS and CNAME records for parking indicators
        const types = ['NS', 'CNAME']; 
        const checks = types.map(type => 
            fetch(`https://dns.google/resolve?name=${domain}&type=${type}`).then(r => r.json())
        );
        
        const results = await Promise.all(checks);
        
        const strictParkingKeywords = [
            'parking', 'sedo', 'hugedomains', 'afternic', 'dan.com', 
            'bodis', 'voodoo', 'smartname', 'cashparking', 'uniregistry',
            'buythisdomain', 'forsale', 'domainmarket', 'parkpage', 'parklogic'
        ];

        for (const data of results) {
            const records = [...(data.Answer || []), ...(data.Authority || [])];
            for (const record of records) {
                if (record.data && typeof record.data === 'string') {
                    const value = record.data.toLowerCase();
                    for (const keyword of strictParkingKeywords) {
                        if (value.includes(keyword)) {
                            return true;
                        }
                    }
                }
            }
        }
        
        return false;
    } catch (e) {
        return false;
    }
};

function getHostname(url: string): string {
    let target = url;
    if (!target.startsWith('http')) {
        target = `https://${target}`;
    }
    try {
        return new URL(target).hostname;
    } catch {
        return '';
    }
}

export const filterVerifiedLeads = async (companies: Company[]): Promise<Company[]> => {
    const results = await Promise.all(companies.map(async (company) => {
        const verifiedCompany = { ...company };
        
        // 1. Verify Website
        let isWebsiteValid = false;
        if (verifiedCompany.websiteUrl) {
            const isReachable = await checkUrlExists(verifiedCompany.websiteUrl);
            if (isReachable) {
                const domain = getHostname(verifiedCompany.websiteUrl);
                if (domain) {
                     const isParked = await checkForSaleSignatures(domain);
                     if (!isParked) {
                         isWebsiteValid = true;
                     }
                } else {
                    isWebsiteValid = true;
                }
            }
        }

        if (!isWebsiteValid) {
            verifiedCompany.websiteUrl = '';
        }

        // 2. Verify Contact Email
        if (verifiedCompany.emailAddress && verifiedCompany.emailAddress.includes('@')) {
            const emailDomain = verifiedCompany.emailAddress.split('@')[1];
            const hasMx = await checkMxRecord(emailDomain);
            if (!hasMx) {
                verifiedCompany.emailAddress = '';
            }
        } else {
            verifiedCompany.emailAddress = '';
        }
        
        // 3. Verify Founder Email
        if (verifiedCompany.founderEmail && verifiedCompany.founderEmail.includes('@')) {
            const founderDomain = verifiedCompany.founderEmail.split('@')[1];
            const hasMx = await checkMxRecord(founderDomain);
            if (!hasMx) {
                verifiedCompany.founderEmail = '';
            }
        } else {
            verifiedCompany.founderEmail = '';
        }

        // 4. Verify LinkedIn URL
        if (verifiedCompany.linkedinUrl && verifiedCompany.linkedinUrl.trim() !== '') {
            const lowerUrl = verifiedCompany.linkedinUrl.toLowerCase().trim();
            if (verifiedCompany.linkedinUrl.includes('404') || ['n/a', 'none', 'unavailable', 'not found', 'null', '-'].includes(lowerUrl)) {
                verifiedCompany.linkedinUrl = '';
            } else {
                const isLinkedInWorking = await checkUrlExists(verifiedCompany.linkedinUrl);
                if (!isLinkedInWorking) {
                    verifiedCompany.linkedinUrl = '';
                }
            }
        }

        // 5. Final Decision: 
        // Must have online presence (valid Website OR valid LinkedIn page).
        // Must have at least one verified email (Contact Email OR Founder Email).
        const hasValidWebsite = verifiedCompany.websiteUrl !== '';
        const hasValidLinkedIn = verifiedCompany.linkedinUrl !== '';
        const hasValidContactEmail = verifiedCompany.emailAddress !== '';
        const hasValidFounderEmail = verifiedCompany.founderEmail !== '';

        if ((hasValidWebsite || hasValidLinkedIn) && (hasValidContactEmail || hasValidFounderEmail)) {
            return verifiedCompany;
        }

        return null;
    }));
    
    return results.filter((c): c is Company => c !== null);
};
