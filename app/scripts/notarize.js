const { notarize } = require('@electron/notarize');

module.exports = async function notarizeApp(appOutDir, appName) {
    await notarize({
        appPath: "dist/mac-arm64/peekaview.app", //dist/mac-arm64/peekaview.app was `${appOutDir}/${appName}.app`
        appleId: process.env.APPLEID,
        appleIdPassword: process.env.APPLEIDPASS,
        teamId: process.env.TEAMID, // Team ID for your developer team
    });
};
