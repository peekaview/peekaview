import { notarize } from '@electron/notarize';

await notarize({
    appPath: `${appOutDir}/${appName}.app`,
    appleId: process.env.APPLEID,
    appleIdPassword: process.env.APPLEIDPASS,
    teamId: process.env.TEAMID, // Team ID for your developer team
});
